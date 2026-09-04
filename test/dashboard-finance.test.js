import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BUSINESS_TIME_ZONE,
  convertCurrencyTotalsToUsd,
  currentMonthFinancials,
  malaysiaMonthPeriod,
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

  const result = currentMonthFinancials(rows, new Date('2026-09-15T00:00:00.000Z'))
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
    currentMonthFinancials(rows, new Date('2026-09-15T00:00:00.000Z')).sales.map(({ id }) => id),
    ['september'],
  )
  assert.deepEqual(
    currentMonthFinancials(rows, new Date('2026-10-15T00:00:00.000Z')).sales.map(({ id }) => id),
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
  const { netTotals } = currentMonthFinancials(rows, new Date('2026-09-15T00:00:00.000Z'))
  const result = convertCurrencyTotalsToUsd(netTotals, { MYR: 0.03 })

  assert.equal(netTotals.MYR, 0.02)
  assert.ok(Math.abs(result.total - (2 / 3)) < Number.EPSILON)
  assert.equal(Number(result.total.toFixed(2)), 0.67)
})

test('uses net_credit directly and never subtracts platform_fee twice', () => {
  const result = currentMonthFinancials(
    [sale('paid', '2026-09-10T00:00:00.000Z', 'USD', 80, 20)],
    new Date('2026-09-15T00:00:00.000Z'),
  )
  assert.equal(result.netTotals.USD, 80)
  assert.equal(result.feeTotals.USD, 20)
  assert.equal(result.grossTotals.USD, 100)
})

test('handles a zero-sales current month', () => {
  const result = currentMonthFinancials([], new Date('2026-09-15T00:00:00.000Z'))
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
  const result = currentMonthFinancials(rows, new Date('2026-09-15T00:00:00.000Z'))
  convertCurrencyTotalsToUsd(result.netTotals, { PHP: 60 })
  assert.deepEqual(rows, snapshot)
})
