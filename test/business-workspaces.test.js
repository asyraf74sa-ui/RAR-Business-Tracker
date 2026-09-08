import assert from 'node:assert/strict'
import test from 'node:test'
import { buildUnifiedFinancialOverview, expensesForWorkspace, platformPerformance, WORKSPACE_NAVIGATION } from '../src/lib/business-workspaces.js'

const now = new Date('2026-09-04T04:00:00.000Z')
const rates = { MYR: 4.7, PHP: 58, IDR: 16000 }

test('All Business calculates current, previous, and lifetime wallet credit across RAR and MR', () => {
  const rar = [
    { id: 'r1', sold_at: '2026-09-02T02:00:00Z', platform: 'PayPal', currency: 'USD', net_credit: 100, platform_fee: 10 },
    { id: 'r2', sold_at: '2026-08-02T02:00:00Z', platform: 'TNG', currency: 'PHP', net_credit: 5800, platform_fee: 580 },
  ]
  const mr = [{ id: 'm1', sold_at: '2026-09-03T02:00:00Z', platform: 'TNG', currency: 'MYR', net_credit: 470, platform_fee: 47 }]
  const overview = buildUnifiedFinancialOverview(rar, mr, [], [], rates, now)

  assert.equal(overview.current.usd.total, 200)
  assert.equal(overview.previous.usd.total, 100)
  assert.equal(overview.lifetime.usd.total, 300)
  assert.equal(overview.current.netTotals.USD, 100)
  assert.equal(overview.current.netTotals.MYR, 470)
  assert.equal(overview.games.RAR.current.usd.total, 100)
  assert.equal(overview.games.MR.current.usd.total, 100)
  assert.equal(overview.current.feeTotals.USD, 10)
  assert.equal(overview.current.grossTotals.USD, 110)
})

test('All Business monthly history remains continuous and labels current-rate conversions as approximate', () => {
  const overview = buildUnifiedFinancialOverview([
    { sold_at: '2026-06-10T02:00:00Z', currency: 'USD', net_credit: 25, platform_fee: 0 },
  ], [
    { sold_at: '2026-09-03T02:00:00Z', currency: 'IDR', net_credit: 1_600_000, platform_fee: 0 },
  ], [], [], rates, now)
  assert.deepEqual(overview.months.map((month) => month.period.key), ['2026-09', '2026-08', '2026-07', '2026-06'])
  assert.equal(overview.months[0].usd.total, 100)
  assert.equal(overview.months[0].usd.approximate, true)
  assert.equal(overview.months[1].usd.total, 0)
  assert.equal(overview.months[2].sales.length, 0)
})

test('All Business preserves FX unavailability without inventing conversions', () => {
  const overview = buildUnifiedFinancialOverview([], [
    { sold_at: '2026-09-03T02:00:00Z', currency: 'MYR', net_credit: 47, platform_fee: 0 },
  ], [], [], null, now)
  assert.equal(overview.current.usd.total, null)
  assert.deepEqual(overview.current.usd.unavailableCurrencies, ['MYR'])
  assert.equal(overview.current.netTotals.MYR, 47)
})

test('RAR, MR, and All Business expense scopes stay isolated and shared is counted once', () => {
  const expenses = [
    { id: 'r', workspace: 'RAR', incurred_at: '2026-09-02T02:00:00Z', currency: 'USD', amount: 10, voided_at: null },
    { id: 'm', workspace: 'MR', incurred_at: '2026-09-02T02:00:00Z', currency: 'USD', amount: 20, voided_at: null },
    { id: 's', workspace: 'SHARED', incurred_at: '2026-09-02T02:00:00Z', currency: 'USD', amount: 30, voided_at: null },
  ]
  const data = { businessExpenses: expenses }
  assert.deepEqual(expensesForWorkspace(data, 'rar').map(({ id }) => id), ['r'])
  assert.deepEqual(expensesForWorkspace(data, 'mr').map(({ id }) => id), ['m'])
  assert.deepEqual(expensesForWorkspace(data, 'all').map(({ id }) => id), ['r', 'm', 's'])

  const overview = buildUnifiedFinancialOverview([], [], [], [], { USD: 1 }, now, expenses)
  assert.equal(overview.games.RAR.current.expenseTotals.USD, 10)
  assert.equal(overview.games.MR.current.expenseTotals.USD, 20)
  assert.equal(overview.games.SHARED.current.expenseTotals.USD, 30)
  assert.equal(overview.current.expenseTotals.USD, 60)
  assert.equal(overview.current.profitTotals.USD, -60)
})

test('PayPal and TNG participate naturally in cross-game platform performance', () => {
  const rows = platformPerformance([
    { game: 'RAR', platform: 'PayPal', currency: 'USD', net_credit: 30, platform_fee: 2 },
    { game: 'MR', platform: 'PayPal', currency: 'USD', net_credit: 20, platform_fee: 1 },
    { game: 'MR', platform: 'TNG', currency: 'USD', net_credit: 10, platform_fee: 0 },
  ], 'USD')
  assert.deepEqual(rows.map((row) => [row.platform, row.net, row.fees, row.games]), [
    ['PayPal', 50, 3, ['MR', 'RAR']],
    ['TNG', 10, 0, ['MR']],
  ])
})

test('workspace navigation keeps RAR-only concepts out of MR and All Business', () => {
  assert.ok(WORKSPACE_NAVIGATION.rar.some((entry) => entry.id === 'gems'))
  assert.ok(WORKSPACE_NAVIGATION.rar.some((entry) => entry.id === 'farming'))
  assert.ok(!WORKSPACE_NAVIGATION.mr.some((entry) => ['gems', 'farming'].includes(entry.id)))
  assert.deepEqual(WORKSPACE_NAVIGATION.all.map((entry) => entry.id), ['dashboard', 'expenses', 'history'])
  assert.ok(WORKSPACE_NAVIGATION.rar.some((entry) => entry.id === 'expenses'))
  assert.ok(WORKSPACE_NAVIGATION.mr.some((entry) => entry.id === 'expenses'))
})
