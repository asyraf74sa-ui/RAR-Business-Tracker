import assert from 'node:assert/strict'
import test from 'node:test'
import { loadFinancialHistoryRecords, loadMonthlyFinancialRecords } from '../src/supabase.js'

test('monthly financial loading uses paginated SELECT filters only and never calls a mutation RPC', async () => {
  const sales = Array.from({ length: 1001 }, (_, index) => ({ id: `sale-${index}` }))
  const events = [{ id: 'purchase-1' }]
  const { supabase, calls } = fakeSupabase({ rar_sales: sales, rar_inventory_events: events })
  const range = {
    startInclusive: '2026-08-31T16:00:00.000Z',
    endExclusive: '2026-09-30T16:00:00.000Z',
  }

  const result = await loadMonthlyFinancialRecords(supabase, range)
  assert.equal(result.sales.length, 1001)
  assert.equal(result.inventoryEvents.length, 1)
  assert.equal(calls.filter(([method]) => method === 'rpc').length, 0)
  assert.deepEqual(calls.filter(([method, table]) => method === 'range' && table === 'rar_sales').map((call) => call.slice(2)), [
    [0, 999],
    [1000, 1999],
  ])

  for (const table of ['rar_sales', 'rar_inventory_events']) {
    assert.ok(calls.some((call) => call[0] === 'gte' && call[1] === table && call[3] === range.startInclusive))
    assert.ok(calls.some((call) => call[0] === 'lt' && call[1] === table && call[3] === range.endExclusive))
  }
  assert.ok(calls.some((call) => call[0] === 'eq'
    && call[1] === 'rar_inventory_events'
    && call[2] === 'event_type'
    && call[3] === 'supplier_purchase'))
  assert.ok(calls.some((call) => call[0] === 'not'
    && call[1] === 'rar_inventory_events'
    && call[2] === 'cash_amount'
    && call[3] === 'is'
    && call[4] === null))
})

test('financial history loading remains paginated and does not leak selected-month filters', async () => {
  const { supabase, calls } = fakeSupabase({ rar_sales: [], rar_inventory_events: [] })
  await loadFinancialHistoryRecords(supabase)
  assert.equal(calls.filter(([method]) => method === 'rpc').length, 0)
  assert.equal(calls.filter(([method]) => method === 'gte' || method === 'lt').length, 0)
  assert.equal(calls.filter(([method]) => method === 'range').length, 2)
})

function fakeSupabase(rowsByTable) {
  const calls = []
  const supabase = {
    from(table) {
      calls.push(['from', table])
      return queryBuilder(table, rowsByTable[table] || [], calls)
    },
    rpc(...args) {
      calls.push(['rpc', ...args])
      throw new Error('Read-only reporting must not invoke RPCs.')
    },
  }
  return { supabase, calls }
}

function queryBuilder(table, rows, calls) {
  const builder = {}
  for (const method of ['select', 'in', 'gte', 'lt', 'eq', 'not', 'order']) {
    builder[method] = (...args) => {
      calls.push([method, table, ...args])
      return builder
    }
  }
  builder.range = async (start, end) => {
    calls.push(['range', table, start, end])
    return { data: rows.slice(start, end + 1), error: null }
  }
  return builder
}
