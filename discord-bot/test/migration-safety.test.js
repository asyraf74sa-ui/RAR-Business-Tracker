import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const sql = readFileSync(
  new URL('../../supabase/migrations/20260902054745_discord_acquisition_operations.sql', import.meta.url),
  'utf8',
)
const manualAddSql = readFileSync(
  new URL('../../supabase/migrations/20260902064501_discord_manual_add.sql', import.meta.url),
  'utf8',
)
const hardenedTransactionsSql = readFileSync(
  new URL('../../supabase/migrations/20260901065358_harden_rar_transactions.sql', import.meta.url),
  'utf8',
)

test('acquisition RPCs preserve authenticated invoker isolation', () => {
  assert.match(sql, /rar_record_purchase_bundle[\s\S]+?security invoker[\s\S]+?auth\.uid\(\)/i)
  assert.match(sql, /rar_record_trade[\s\S]+?security invoker[\s\S]+?auth\.uid\(\)/i)
  assert.match(sql, /revoke all on function public\.rar_record_purchase_bundle[\s\S]+?from public, anon/i)
  assert.match(sql, /revoke all on function public\.rar_record_trade[\s\S]+?from public, anon/i)
})

test('bundle purchase stores its total cash amount on exactly the first event line', () => {
  assert.match(sql, /row_number\(\) over \(order by x\.item_id\) as line_number/i)
  assert.match(sql, /case when v_line\.line_number = 1 then p_cash_amount else null end/i)
  assert.match(sql, /case when v_line\.line_number = 1 then v_currency else null end/i)
})

test('trade locks all rows, checks GIVE stock, then writes negative and positive audit events', () => {
  const tradeSql = sql.slice(sql.indexOf('create or replace function public.rar_record_trade'))
  const lockPosition = tradeSql.indexOf('for update of i')
  const stockCheckPosition = tradeSql.indexOf('where i.user_id = v_uid and i.stock < x.quantity')
  const firstMutationPosition = tradeSql.indexOf('set stock = stock - v_line.quantity')

  assert.ok(lockPosition >= 0)
  assert.ok(stockCheckPosition > lockPosition)
  assert.ok(firstMutationPosition > stockCheckPosition)
  assert.match(tradeSql, /'trade', -v_line\.quantity/i)
  assert.match(tradeSql, /'trade', v_line\.quantity/i)
})

test('manual ADD validates, locks, and increments all active user items atomically', () => {
  const lockPosition = manualAddSql.indexOf('for update of i')
  const mutationPosition = manualAddSql.indexOf('set stock = stock + v_line.quantity')

  assert.match(manualAddSql, /rar_add_stock_bundle[\s\S]+?security invoker[\s\S]+?auth\.uid\(\)/i)
  assert.match(manualAddSql, /where i\.user_id = v_uid and i\.active = true/i)
  assert.ok(lockPosition >= 0)
  assert.ok(mutationPosition > lockPosition)
  assert.match(manualAddSql, /'manual_add', v_line\.quantity/i)
  assert.doesNotMatch(manualAddSql, /cash_amount|cash_currency/i)
})

test('manual ADD duplicate request IDs return without applying another increment', () => {
  assert.match(manualAddSql, /pg_advisory_xact_lock/i)
  assert.match(manualAddSql, /event_type = 'manual_add'[\s\S]+?return -v_existing_count/i)
  assert.match(manualAddSql, /revoke all on function public\.rar_add_stock_bundle[\s\S]+?from public, anon/i)
  assert.match(manualAddSql, /grant execute on function public\.rar_add_stock_bundle[\s\S]+?to authenticated/i)
})

test('existing stocktake bundle RPC is atomic and duplicate-safe', () => {
  const start = hardenedTransactionsSql.indexOf('create or replace function public.rar_reconcile_stock_batch')
  const end = hardenedTransactionsSql.indexOf('create or replace function public.rar_update_farm_settings', start)
  const stockSql = hardenedTransactionsSql.slice(start, end)
  const lockPosition = stockSql.indexOf('for update of i')
  const deltaPosition = stockSql.indexOf('v_delta := v_line.counted_stock - v_old')
  const mutationPosition = stockSql.indexOf('set stock = v_line.counted_stock')

  assert.match(stockSql, /x\.counted_stock >= 0/i)
  assert.match(stockSql, /pg_advisory_xact_lock/i)
  assert.match(stockSql, /event_type = 'stock_adjustment'[\s\S]+?return -v_existing_count/i)
  assert.ok(lockPosition >= 0)
  assert.ok(deltaPosition > lockPosition)
  assert.ok(mutationPosition > deltaPosition)
})
