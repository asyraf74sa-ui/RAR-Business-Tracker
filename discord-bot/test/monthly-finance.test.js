import assert from 'node:assert/strict'
import test from 'node:test'
import {
  aggregateFinancialRecords,
  buildMonthlyHistoryPages,
  buildMonthlyOverviewPage,
  currentMalaysiaMonth,
  formatCurrencyAmount,
  malaysiaMonthRange,
  MonthlyInputError,
  parseMonthOption,
} from '../src/monthly-finance.js'

test('one USD sale reports its net wallet credit and platform tax exactly', () => {
  const [report] = aggregateFinancialRecords({
    sales: [sale('2026-09-10T04:00:00Z', 'USD', '11.52', '1.28')],
  }, { selectedMonth: '2026-09' })

  assert.equal(report.currencies.USD.actualWalletCredit, '11.52')
  assert.equal(report.currencies.USD.platformTax, '1.28')
  assert.equal(report.salesCount, 1)
})

test('net profit subtracts purchases from wallet credit and never subtracts platform tax twice', () => {
  const [report] = aggregateFinancialRecords({
    sales: [sale('2026-09-10T04:00:00Z', 'USD', '100', '15')],
    inventoryEvents: [purchase('2026-09-11T04:00:00Z', 'USD', '30', 'purchase-1')],
  }, { selectedMonth: '2026-09' })

  assert.equal(report.currencies.USD.netProfit, '70')
  assert.notEqual(report.currencies.USD.netProfit, '55')
})

test('USD, MYR, PHP, and IDR are aggregated independently without conversion or combination', () => {
  const [report] = aggregateFinancialRecords({
    sales: [
      sale('2026-09-01T04:00:00Z', 'USD', 100, 10),
      sale('2026-09-02T04:00:00Z', 'MYR', 200, 20),
    ],
    inventoryEvents: [purchase('2026-09-03T04:00:00Z', 'PHP', 500, 'purchase-php')],
  }, { selectedMonth: '2026-09' })

  assert.equal(report.currencies.USD.netProfit, '100')
  assert.equal(report.currencies.MYR.netProfit, '200')
  assert.equal(report.currencies.PHP.netProfit, '-500')
  assert.equal(report.currencies.IDR.netProfit, '0')
})

test('a multi-item purchase bundle counts its one non-null cash amount and transaction once', () => {
  const [report] = aggregateFinancialRecords({
    inventoryEvents: [
      purchase('2026-09-03T04:00:00Z', 'USD', '30', 'bundle-1', 'event-1'),
      { ...purchase('2026-09-03T04:00:00Z', 'USD', null, 'bundle-1', 'event-2') },
      { ...purchase('2026-09-03T04:00:00Z', 'USD', null, 'bundle-1', 'event-3') },
    ],
  }, { selectedMonth: '2026-09' })

  assert.equal(report.currencies.USD.itemPurchaseSpending, '30')
  assert.equal(report.purchaseTransactions, 1)
})

test('history includes purchase-only, sale-only, and combined months and sorts newest first', () => {
  const reports = aggregateFinancialRecords({
    sales: [
      sale('2026-07-10T04:00:00Z', 'USD', 25, 2),
      sale('2026-08-10T04:00:00Z', 'USD', 100, 15),
    ],
    inventoryEvents: [
      purchase('2026-06-10T04:00:00Z', 'USD', 30, 'june-purchase'),
      purchase('2026-08-11T04:00:00Z', 'USD', 40, 'august-purchase'),
    ],
  })

  assert.deepEqual(reports.map(({ month }) => month), ['2026-08', '2026-07', '2026-06'])
  assert.equal(reports[0].currencies.USD.netProfit, '60')
  assert.equal(reports[1].currencies.USD.netProfit, '25')
  assert.equal(reports[2].currencies.USD.netProfit, '-30')
})

test('Malaysia timezone assigns UTC boundary transactions to the correct local month', () => {
  const reports = aggregateFinancialRecords({
    sales: [
      sale('2026-08-31T15:59:59.999Z', 'USD', 1, 0),
      sale('2026-08-31T16:00:00.000Z', 'USD', 2, 0),
    ],
  })

  assert.deepEqual(reports.map(({ month }) => month), ['2026-09', '2026-08'])
  assert.equal(reports[0].currencies.USD.actualWalletCredit, '2')
  assert.equal(reports[1].currencies.USD.actualWalletCredit, '1')
})

test('month ranges are half-open and correct for leap-year February', () => {
  assert.deepEqual(malaysiaMonthRange('2024-02'), {
    month: '2024-02',
    startInclusive: '2024-01-31T16:00:00.000Z',
    endExclusive: '2024-02-29T16:00:00.000Z',
  })
})

test('month ranges handle December to January rollover', () => {
  assert.deepEqual(malaysiaMonthRange('2026-12'), {
    month: '2026-12',
    startInclusive: '2026-11-30T16:00:00.000Z',
    endExclusive: '2026-12-31T16:00:00.000Z',
  })
})

test('current month selection uses Asia/Kuala_Lumpur rather than the server UTC month', () => {
  assert.equal(currentMalaysiaMonth(new Date('2026-08-31T15:59:59.999Z')), '2026-08')
  assert.equal(currentMalaysiaMonth(new Date('2026-08-31T16:00:00.000Z')), '2026-09')
})

test('historical sales with inventory_applied=false still count financially', () => {
  const historical = sale('2026-09-04T04:00:00Z', 'USD', 42, 5)
  historical.inventory_applied = false
  historical.classification = 'other'
  const [report] = aggregateFinancialRecords({ sales: [historical] }, { selectedMonth: '2026-09' })
  assert.equal(report.currencies.USD.actualWalletCredit, '42')
  assert.equal(report.salesCount, 1)
})

for (const eventType of ['farm', 'trade', 'manual_add', 'stock_adjustment', 'gem_conversion', 'gem_purchase']) {
  test(`${eventType} inventory events do not count as item purchase spending`, () => {
    const event = purchase('2026-09-03T04:00:00Z', 'USD', 999, `${eventType}-request`)
    event.event_type = eventType
    const [report] = aggregateFinancialRecords({ inventoryEvents: [event] }, { selectedMonth: '2026-09' })
    assert.equal(report.currencies.USD.itemPurchaseSpending, '0')
    assert.equal(report.purchaseTransactions, 0)
  })
}

test('currency formatting uses symbols, separators, signs, and meaningful precision', () => {
  assert.equal(formatCurrencyAmount('1234.5', 'USD'), '$1,234.50')
  assert.equal(formatCurrencyAmount('-100', 'MYR'), '-RM100.00')
  assert.equal(formatCurrencyAmount('-500', 'PHP'), '-₱500.00')
  assert.equal(formatCurrencyAmount('1234567', 'IDR'), 'Rp1,234,567')
  assert.equal(formatCurrencyAmount('32.125', 'USD', { showPositiveSign: true }), '+$32.125')
})

test('monthly overview shows all currencies, counts, and the correct accounting formula', () => {
  const [report] = aggregateFinancialRecords({
    sales: [sale('2026-09-10T04:00:00Z', 'USD', 100, 15)],
    inventoryEvents: [purchase('2026-09-11T04:00:00Z', 'USD', 30, 'purchase-1')],
  }, { selectedMonth: '2026-09' })
  const page = buildMonthlyOverviewPage(report)

  for (const currency of ['USD', 'MYR', 'PHP', 'IDR']) assert.match(page.description, new RegExp(`\\*\\*${currency}\\*\\*`))
  assert.match(page.description, /Net Profit: \$70\.00/)
  assert.match(page.description, /Sales recorded: 1/)
  assert.match(page.description, /Purchase transactions: 1/)
  assert.match(page.footer.text, /Actual Wallet Credit − Item Purchase Spending/)
})

test('long history splits into complete Discord-safe pages without dropping old months', () => {
  const sales = []
  for (let year = 2000; year <= 2026; year += 1) {
    for (let month = 0; month < 12; month += 1) {
      sales.push(sale(new Date(Date.UTC(year, month, 15, 4)).toISOString(), 'USD', 1, 0))
    }
  }
  const reports = aggregateFinancialRecords({ sales })
  const pages = buildMonthlyHistoryPages(reports)

  assert.ok(pages.length > 1)
  assert.ok(pages.every((page) => page.title.length <= 256 && page.description.length <= 3900))
  const displayedMonthBlocks = pages.reduce(
    (count, page) => count + (page.description.match(/^\*\*.+ \d{4}\*\*$/gm) || []).length,
    0,
  )
  assert.equal(displayedMonthBlocks, reports.length)
})

test('strict month validation rejects malformed or impossible values', () => {
  assert.equal(parseMonthOption('2026-09'), '2026-09')
  for (const value of ['2026-9', '2026-13', '1899-12', '0000-01', 'September 2026', '']) {
    assert.throws(() => parseMonthOption(value), MonthlyInputError)
  }
})

function sale(soldAt, currency, netCredit, platformFee) {
  return {
    id: `sale-${soldAt}-${currency}`,
    sold_at: soldAt,
    currency,
    net_credit: netCredit,
    platform_fee: platformFee,
    inventory_applied: true,
    classification: 'normal',
  }
}

function purchase(eventAt, currency, cashAmount, requestId, id = `event-${requestId}`) {
  return {
    id,
    event_at: eventAt,
    event_type: 'supplier_purchase',
    cash_amount: cashAmount,
    cash_currency: cashAmount === null ? null : currency,
    request_id: requestId,
  }
}
