import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BUSINESS_TIME_ZONE,
  compareUsdTotals,
  convertCurrencyTotalsToUsd,
  currentMonthFinancials,
  malaysiaMonthPeriod,
  monthlyFinancialHistory,
  walletFinancialOverview,
} from '../src/lib/dashboard-finance.js'

function sale(id, soldAt, currency, netCredit, platformFee = 0) {
  return { id, sold_at: soldAt, currency, net_credit: netCredit, platform_fee: platformFee }
}

test('uses inclusive start and exclusive end for the current Malaysia month', () => {
  const rows = [
    sale('before', '2026-08-31T15:59:59.999Z', 'USD', 1),
    sale('start', '2026-08-31T16:00:00.000Z', 'USD', 2),
    sale('end-minus', '2026-09-30T15:59:59.999Z', 'USD', 3),
    sale('end', '2026-09-30T16:00:00.000Z', 'USD', 4),
  ]

  const result = currentMonthFinancials(rows, [], new Date('2026-09-15T00:00:00.000Z'))
  assert.equal(result.period.timeZone, BUSINESS_TIME_ZONE)
  assert.equal(result.period.startInclusive.toISOString(), '2026-08-31T16:00:00.000Z')
  assert.equal(result.period.endExclusive.toISOString(), '2026-09-30T16:00:00.000Z')
  assert.deepEqual(result.sales.map(({ id }) => id), ['start', 'end-minus'])
  assert.equal(result.netTotals.USD, 5)
})

test('rolls the dashboard month at midnight in Kuala Lumpur', () => {
  const before = malaysiaMonthPeriod(new Date('2026-09-30T15:59:59.999Z'))
  const after = malaysiaMonthPeriod(new Date('2026-09-30T16:00:00.000Z'))

  assert.equal(before.key, '2026-09')
  assert.equal(after.key, '2026-10')
})

test('assigns UTC timestamps near Malaysia midnight to the correct month', () => {
  const rows = [
    sale('september', '2026-09-30T15:59:59.000Z', 'MYR', 10),
    sale('october', '2026-09-30T16:00:00.000Z', 'MYR', 20),
  ]

  assert.deepEqual(
    currentMonthFinancials(rows, [], new Date('2026-09-15T00:00:00.000Z')).sales.map(({ id }) => id),
    ['september'],
  )
  assert.deepEqual(
    currentMonthFinancials(rows, [], new Date('2026-10-15T00:00:00.000Z')).sales.map(({ id }) => id),
    ['october'],
  )
})

test('returns an exact USD-only total without requiring FX', () => {
  assert.deepEqual(convertCurrencyTotalsToUsd({ USD: 100, MYR: 0, PHP: 0, IDR: 0 }), {
    total: 100,
    approximate: false,
    unavailableCurrencies: [],
  })
})

test('converts currency totals into USD and adds them at full precision', () => {
  const result = convertCurrencyTotalsToUsd(
    { USD: 100, MYR: 400, PHP: 6_000, IDR: 1_500_000 },
    { USD: 1, MYR: 4, PHP: 60, IDR: 15_000 },
  )
  assert.equal(result.total, 400)
  assert.equal(result.approximate, true)
})

test('sums original currency amounts before conversion and display rounding', () => {
  const rows = [
    sale('a', '2026-09-10T00:00:00.000Z', 'MYR', 0.01),
    sale('b', '2026-09-11T00:00:00.000Z', 'MYR', 0.01),
  ]
  const { netTotals } = currentMonthFinancials(rows, [], new Date('2026-09-15T00:00:00.000Z'))
  const result = convertCurrencyTotalsToUsd(netTotals, { MYR: 0.03 })

  assert.equal(netTotals.MYR, 0.02)
  assert.ok(Math.abs(result.total - (2 / 3)) < Number.EPSILON)
  assert.equal(Number(result.total.toFixed(2)), 0.67)
})

test('uses net_credit directly and never subtracts platform_fee twice', () => {
  const result = currentMonthFinancials(
    [sale('paid', '2026-09-10T00:00:00.000Z', 'USD', 80, 20)],
    [],
    new Date('2026-09-15T00:00:00.000Z'),
  )
  assert.equal(result.netTotals.USD, 80)
  assert.equal(result.feeTotals.USD, 20)
  assert.equal(result.grossTotals.USD, 100)
})

test('handles a zero-sales current month', () => {
  const result = currentMonthFinancials([], [], new Date('2026-09-15T00:00:00.000Z'))
  assert.deepEqual(result.netTotals, { USD: 0, MYR: 0, PHP: 0, IDR: 0 })
  assert.equal(convertCurrencyTotalsToUsd(result.netTotals).total, 0)
})

test('converts large MYR, PHP, and IDR totals without overflow', () => {
  const result = convertCurrencyTotalsToUsd(
    { USD: 10_000, MYR: 50_000, PHP: 1_000_000, IDR: 100_000_000 },
    { MYR: 4, PHP: 50, IDR: 10_000 },
  )
  assert.equal(result.total, 52_500)
  assert.ok(Number.isFinite(result.total))
})

test('financial calculations do not mutate production-shaped input rows', () => {
  const rows = [sale('immutable', '2026-09-10T00:00:00.000Z', 'PHP', '1500.00', '30.00')]
  const snapshot = structuredClone(rows)
  const result = currentMonthFinancials(rows, [], new Date('2026-09-15T00:00:00.000Z'))
  convertCurrencyTotalsToUsd(result.netTotals, { PHP: 60 })
  assert.deepEqual(rows, snapshot)
})

test('summarizes current, previous, and lifetime net wallet credit', () => {
  const rows = [
    sale('july', '2026-07-12T02:00:00.000Z', 'USD', 25, 5),
    sale('august', '2026-08-15T02:00:00.000Z', 'MYR', 400, 20),
    sale('september', '2026-09-15T02:00:00.000Z', 'PHP', 6_000, 300),
  ]
  const result = walletFinancialOverview(
    rows,
    [],
    { USD: 1, MYR: 4, PHP: 60, IDR: 15_000 },
    new Date('2026-09-20T00:00:00.000Z'),
  )

  assert.equal(result.current.period.key, '2026-09')
  assert.equal(result.current.usd.total, 100)
  assert.equal(result.previous.period.key, '2026-08')
  assert.equal(result.previous.usd.total, 100)
  assert.deepEqual(result.lifetime.netTotals, { USD: 25, MYR: 400, PHP: 6_000, IDR: 0 })
  assert.equal(result.lifetime.usd.total, 225)
  assert.equal(result.comparison.status, 'comparable')
  assert.equal(result.comparison.percent, 0)
})

test('creates a continuous newest-first month history with empty gaps', () => {
  const rows = [
    sale('july', '2026-07-10T00:00:00.000Z', 'USD', 10),
    sale('september', '2026-09-10T00:00:00.000Z', 'USD', 30),
  ]
  const months = monthlyFinancialHistory(rows, [], new Date('2026-09-15T00:00:00.000Z'))

  assert.deepEqual(months.map(({ period }) => period.key), ['2026-09', '2026-08', '2026-07'])
  assert.deepEqual(months.map(({ netTotals }) => netTotals.USD), [30, 0, 10])
  assert.equal(months[1].sales.length, 0)
})

test('always includes an empty brand-new current month and rolls previous automatically', () => {
  const rows = [sale('september', '2026-09-30T15:59:59.999Z', 'USD', 45)]
  const september = walletFinancialOverview(rows, [], { USD: 1 }, new Date('2026-09-30T15:59:59.999Z'))
  const october = walletFinancialOverview(rows, [], { USD: 1 }, new Date('2026-09-30T16:00:00.000Z'))

  assert.equal(september.current.period.key, '2026-09')
  assert.equal(september.current.usd.total, 45)
  assert.equal(october.current.period.key, '2026-10')
  assert.equal(october.current.usd.total, 0)
  assert.equal(october.previous.period.key, '2026-09')
  assert.equal(october.previous.usd.total, 45)
  assert.deepEqual(october.months.map(({ period }) => period.key), ['2026-10', '2026-09'])
})

test('keeps every supported currency authoritative and converts lifetime totals once', () => {
  const rows = [
    sale('usd', '2026-07-10T00:00:00.000Z', 'USD', 100),
    sale('myr', '2026-07-11T00:00:00.000Z', 'MYR', 400),
    sale('php', '2026-08-10T00:00:00.000Z', 'PHP', 6_000),
    sale('idr', '2026-09-10T00:00:00.000Z', 'IDR', 1_500_000),
  ]
  const result = walletFinancialOverview(
    rows,
    [],
    { USD: 1, MYR: 4, PHP: 60, IDR: 15_000 },
    new Date('2026-09-15T00:00:00.000Z'),
  )

  assert.deepEqual(result.lifetime.netTotals, {
    USD: 100,
    MYR: 400,
    PHP: 6_000,
    IDR: 1_500_000,
  })
  assert.equal(result.lifetime.usd.total, 400)
})

test('does not invent percentage growth when previous month is zero', () => {
  assert.deepEqual(compareUsdTotals(50, 0), {
    amount: 50,
    percent: null,
    status: 'no-baseline',
  })
  assert.deepEqual(compareUsdTotals(0, 0), {
    amount: 0,
    percent: null,
    status: 'no-activity',
  })
})

test('keeps USD-only reporting available when FX is unavailable', () => {
  const usdOnly = walletFinancialOverview(
    [sale('usd', '2026-09-10T00:00:00.000Z', 'USD', 75)],
    [],
    undefined,
    new Date('2026-09-15T00:00:00.000Z'),
  )
  const foreign = walletFinancialOverview(
    [sale('myr', '2026-09-10T00:00:00.000Z', 'MYR', 300)],
    [],
    undefined,
    new Date('2026-09-15T00:00:00.000Z'),
  )

  assert.equal(usdOnly.current.usd.total, 75)
  assert.equal(usdOnly.lifetime.usd.total, 75)
  assert.equal(foreign.current.usd.total, null)
  assert.deepEqual(foreign.current.usd.unavailableCurrencies, ['MYR'])
  assert.equal(foreign.comparison.status, 'unavailable')
})

test('ignores future months without deleting or mutating their source rows', () => {
  const rows = [
    sale('current', '2026-09-10T00:00:00.000Z', 'USD', 10),
    sale('future', '2026-10-10T00:00:00.000Z', 'USD', 20),
  ]
  const snapshot = structuredClone(rows)
  const result = walletFinancialOverview(rows, [], { USD: 1 }, new Date('2026-09-15T00:00:00.000Z'))

  assert.equal(result.lifetime.usd.total, 10)
  assert.deepEqual(result.months.map(({ period }) => period.key), ['2026-09'])
  assert.deepEqual(rows, snapshot)
})
