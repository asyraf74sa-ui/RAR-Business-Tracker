import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildUnifiedFinancialOverview } from '../src/lib/business-workspaces.js'
import { currentMonthFinancials, walletFinancialOverview } from '../src/lib/dashboard-finance.js'
import { splitMrInventory } from '../src/lib/mr-inventory.js'

const now = new Date('2026-09-15T00:00:00.000Z')
const rates = { USD: 1, MYR: 4, PHP: 60, IDR: 15_000 }

function sale(id, soldAt, currency, netCredit, platformFee = 0) {
  return { id, sold_at: soldAt, currency, net_credit: netCredit, platform_fee: platformFee }
}

function event(id, eventAt, eventType, cashCurrency = null, cashAmount = null, extra = {}) {
  return {
    id,
    event_at: eventAt,
    event_type: eventType,
    cash_currency: cashCurrency,
    cash_amount: cashAmount,
    ...extra,
  }
}

function realRarPhpBundle() {
  const shared = { request_id: '1928acd1-e239-5bf6-a7b9-26dbdfb4f39e', quantity_delta: 2 }
  return [
    event('dinosaur', '2026-09-05T02:05:49.957Z', 'supplier_purchase', 'PHP', 630, { ...shared, item_name: 'Dinosaur Fossil' }),
    event('pantry', '2026-09-05T02:05:49.957Z', 'supplier_purchase', null, null, { ...shared, item_name: 'Food Pantry' }),
    event('greenhouse', '2026-09-05T02:05:49.957Z', 'supplier_purchase', null, null, { ...shared, item_name: 'Greenhouse' }),
    event('station', '2026-09-05T02:05:49.957Z', 'supplier_purchase', null, null, { ...shared, quantity_delta: 1, item_name: 'Host Station' }),
  ]
}

test('1. RAR multi-item purchase bundle with one PHP total counts cost once', () => {
  const result = currentMonthFinancials([], realRarPhpBundle(), now)
  assert.equal(result.acquisitionTotals.PHP, 630)
  assert.equal(result.purchaseEvents.length, 1)
})

test('2. The real PHP 630 RAR purchase is not multiplied by units', () => {
  const bundle = realRarPhpBundle()
  assert.equal(bundle.reduce((sum, row) => sum + row.quantity_delta, 0), 7)
  assert.equal(currentMonthFinancials([], bundle, now).acquisitionTotals.PHP, 630)
})

test('3. Multiple RAR purchases in one month sum properly', () => {
  const events = [
    event('first', '2026-09-02T02:00:00Z', 'supplier_purchase', 'MYR', 100),
    event('second', '2026-09-08T02:00:00Z', 'supplier_purchase', 'MYR', 250),
  ]
  assert.equal(currentMonthFinancials([], events, now).acquisitionTotals.MYR, 350)
})

test('4. RAR ADD does not count as acquisition cost', () => {
  const result = currentMonthFinancials([], [event('add', '2026-09-02T02:00:00Z', 'manual_add', 'USD', 90)], now)
  assert.equal(result.acquisitionTotals.USD, 0)
})

test('5. RAR STOCK reconciliation does not count as acquisition cost', () => {
  const result = currentMonthFinancials([], [event('stock', '2026-09-02T02:00:00Z', 'stock_adjustment', 'USD', 90)], now)
  assert.equal(result.acquisitionTotals.USD, 0)
})

test('6. RAR FARM does not count as acquisition cost', () => {
  const result = currentMonthFinancials([], [event('farm', '2026-09-02T02:00:00Z', 'farm', 'USD', 90)], now)
  assert.equal(result.acquisitionTotals.USD, 0)
})

test('7. Cashless RAR TRADE does not count as acquisition cost', () => {
  const result = currentMonthFinancials([], [event('trade', '2026-09-02T02:00:00Z', 'trade')], now)
  assert.equal(result.acquisitionTotals.USD, 0)
})

test('8. RAR platform fee is displayed but not deducted twice', () => {
  const result = currentMonthFinancials(
    [sale('rar-sale', '2026-09-04T02:00:00Z', 'USD', 10, 2)],
    [event('rar-cost', '2026-09-03T02:00:00Z', 'supplier_purchase', 'USD', 4)],
    now,
  )
  assert.equal(result.feeTotals.USD, 2)
  assert.equal(result.profitTotals.USD, 6)
})

test('9. RAR True Net Profit equals Net Wallet Credit minus Acquisition Cost', () => {
  const result = currentMonthFinancials(
    [sale('rar-sale', '2026-09-04T02:00:00Z', 'PHP', 1_000)],
    [event('rar-cost', '2026-09-03T02:00:00Z', 'supplier_purchase', 'PHP', 630)],
    now,
  )
  assert.equal(result.profitTotals.PHP, 370)
})

test('10. RAR acquisition uses inclusive-start and exclusive-end Malaysia boundaries', () => {
  const events = [
    event('before', '2026-08-31T15:59:59.999Z', 'supplier_purchase', 'USD', 1),
    event('start', '2026-08-31T16:00:00.000Z', 'supplier_purchase', 'USD', 2),
    event('end-minus', '2026-09-30T15:59:59.999Z', 'supplier_purchase', 'USD', 3),
    event('end', '2026-09-30T16:00:00.000Z', 'supplier_purchase', 'USD', 4),
  ]
  const result = currentMonthFinancials([], events, now)
  assert.deepEqual(result.purchaseEvents.map(({ id }) => id), ['start', 'end-minus'])
  assert.equal(result.acquisitionTotals.USD, 5)
})

test('11. MR multi-item monetary purchase counts its one bundle total once', () => {
  const events = [
    event('candy', '2026-09-04T02:00:00Z', 'supplier_purchase', 'PHP', 500, { request_id: 'mr-bundle' }),
    event('dominus', '2026-09-04T02:00:00Z', 'supplier_purchase', null, null, { request_id: 'mr-bundle' }),
  ]
  assert.equal(currentMonthFinancials([], events, now).acquisitionTotals.PHP, 500)
})

test('12. MR ADD does not count as acquisition cost', () => {
  assert.equal(currentMonthFinancials([], [event('mr-add', '2026-09-02T02:00:00Z', 'manual_add', 'MYR', 20)], now).acquisitionTotals.MYR, 0)
})

test('13. MR STOCK reconciliation does not count as acquisition cost', () => {
  assert.equal(currentMonthFinancials([], [event('mr-stock', '2026-09-02T02:00:00Z', 'reconcile', 'MYR', 20)], now).acquisitionTotals.MYR, 0)
})

test('14. Cashless MR TRADE does not count as acquisition cost', () => {
  assert.equal(currentMonthFinancials([], [event('mr-trade', '2026-09-02T02:00:00Z', 'trade')], now).acquisitionTotals.MYR, 0)
})

test('15. MR platform fees are informational and not deducted twice', () => {
  const result = currentMonthFinancials(
    [sale('mr-sale', '2026-09-05T02:00:00Z', 'MYR', 80, 20)],
    [event('mr-cost', '2026-09-02T02:00:00Z', 'supplier_purchase', 'MYR', 30)],
    now,
  )
  assert.equal(result.feeTotals.MYR, 20)
  assert.equal(result.profitTotals.MYR, 50)
})

test('16. MR True Net Profit formula is correct', () => {
  const result = currentMonthFinancials(
    [sale('mr-sale', '2026-09-05T02:00:00Z', 'IDR', 500_000)],
    [event('mr-cost', '2026-09-02T02:00:00Z', 'supplier_purchase', 'IDR', 125_000)],
    now,
  )
  assert.equal(result.profitTotals.IDR, 375_000)
})

test('17. MR Current, Previous, and Lifetime acquisition boundaries work', () => {
  const result = walletFinancialOverview([], [
    event('previous', '2026-08-10T02:00:00Z', 'supplier_purchase', 'USD', 25),
    event('current', '2026-09-10T02:00:00Z', 'supplier_purchase', 'USD', 40),
  ], rates, now)
  assert.equal(result.current.acquisitionTotals.USD, 40)
  assert.equal(result.previous.acquisitionTotals.USD, 25)
  assert.equal(result.lifetime.acquisitionTotals.USD, 65)
})

test('18. MR Gems and Money presentation preserves existing catalog IDs', () => {
  const items = [
    { id: 'gems-production-id', name: 'Gems (MR)', category: 'Currency', is_archived: false },
    { id: 'cash-production-id', name: 'Cash (MR)', category: 'Currency', is_archived: false },
  ]
  assert.deepEqual(splitMrInventory(items).virtualCurrencies.map(({ id }) => id), ['gems-production-id', 'cash-production-id'])
})

test('19. MR Gems and Money are separated from normal stock categories', () => {
  const items = [
    { id: 'gems', name: 'Gems (MR)', category: 'Currency', is_archived: false },
    { id: 'chair', name: 'Royal Chair', category: 'Furnitures', is_archived: false },
  ]
  const result = splitMrInventory(items)
  assert.deepEqual(result.virtualCurrencies.map(({ id }) => id), ['gems'])
  assert.deepEqual(result.categories.Furnitures.map(({ id }) => id), ['chair'])
  const source = readFileSync(new URL('../src/pages/MRInventory.jsx', import.meta.url), 'utf8')
  assert.match(source, /title="Gems & Money"/)
})

test('20. All Business combines RAR and MR Net Wallet Credit', () => {
  const result = buildUnifiedFinancialOverview(
    [sale('rar', '2026-09-02T02:00:00Z', 'USD', 70)],
    [sale('mr', '2026-09-03T02:00:00Z', 'USD', 30)],
    [], [], rates, now,
  )
  assert.equal(result.current.netTotals.USD, 100)
})

test('21. All Business combines RAR and MR Acquisition Cost', () => {
  const result = buildUnifiedFinancialOverview([], [],
    [event('rar', '2026-09-02T02:00:00Z', 'supplier_purchase', 'USD', 25)],
    [event('mr', '2026-09-03T02:00:00Z', 'supplier_purchase', 'USD', 15)],
    rates, now)
  assert.equal(result.current.acquisitionTotals.USD, 40)
})

test('22. Combined True Net Profit subtracts both games acquisition costs', () => {
  const result = buildUnifiedFinancialOverview(
    [sale('rar-sale', '2026-09-02T02:00:00Z', 'USD', 70)],
    [sale('mr-sale', '2026-09-03T02:00:00Z', 'USD', 30)],
    [event('rar-cost', '2026-09-02T02:00:00Z', 'supplier_purchase', 'USD', 25)],
    [event('mr-cost', '2026-09-03T02:00:00Z', 'supplier_purchase', 'USD', 15)],
    rates, now,
  )
  assert.equal(result.current.profitTotals.USD, 60)
  assert.equal(result.current.profitUsd.total, 60)
})

test('23. Mixed USD, MYR, PHP, and IDR convert by original-currency totals', () => {
  const result = buildUnifiedFinancialOverview(
    [sale('usd', '2026-09-02T02:00:00Z', 'USD', 100)],
    [sale('myr', '2026-09-03T02:00:00Z', 'MYR', 400)],
    [event('php', '2026-09-02T02:00:00Z', 'supplier_purchase', 'PHP', 6_000)],
    [event('idr', '2026-09-03T02:00:00Z', 'supplier_purchase', 'IDR', 1_500_000)],
    rates, now,
  )
  assert.equal(result.current.usd.total, 200)
  assert.equal(result.current.acquisitionUsd.total, 200)
  assert.equal(result.current.profitUsd.total, 0)
})

test('24. Financial reporting leaves original currencies unchanged', () => {
  const rarSales = [sale('rar', '2026-09-02T02:00:00Z', 'MYR', 400)]
  const mrEvents = [event('mr', '2026-09-03T02:00:00Z', 'supplier_purchase', 'PHP', 600)]
  const before = structuredClone({ rarSales, mrEvents })
  buildUnifiedFinancialOverview(rarSales, [], [], mrEvents, rates, now)
  assert.deepEqual({ rarSales, mrEvents }, before)
})

test('25. Dashboard financial loading never mutates stock-shaped events', () => {
  const events = realRarPhpBundle()
  const before = structuredClone(events)
  walletFinancialOverview([], events, rates, now)
  assert.deepEqual(events, before)
})

test('26. Existing sales are represented once and are not duplicated', () => {
  const sales = [sale('one', '2026-08-02T02:00:00Z', 'USD', 10), sale('two', '2026-09-02T02:00:00Z', 'USD', 20)]
  const result = walletFinancialOverview(sales, [], rates, now)
  assert.deepEqual(result.months.flatMap((month) => month.sales.map(({ id }) => id)).sort(), ['one', 'two'])
})

test('27. Existing purchase bundles are represented once and are not duplicated', () => {
  const result = walletFinancialOverview([], realRarPhpBundle(), rates, now)
  assert.deepEqual(result.months.flatMap((month) => month.purchaseEvents.map(({ request_id }) => request_id)), [
    '1928acd1-e239-5bf6-a7b9-26dbdfb4f39e',
  ])
  assert.equal(result.lifetime.acquisitionTotals.PHP, 630)
})
