import assert from 'node:assert/strict'
import test from 'node:test'
import {
  aggregateWeeklySales,
  buildWeeklySalesEmbed,
  latestCompletedWeeklyRange,
  nextWeeklyBoundary,
  weeklyReportMarker,
} from '../src/weekly-finance.js'

test('weekly boundaries use Saturday 09:30 Asia/Kuala_Lumpur and [start, end)', () => {
  assert.deepEqual(latestCompletedWeeklyRange(new Date('2026-09-12T01:29:59.999Z')), {
    startInclusive: '2026-08-29T01:30:00.000Z',
    endExclusive: '2026-09-05T01:30:00.000Z',
  })
  assert.deepEqual(latestCompletedWeeklyRange(new Date('2026-09-12T01:30:00.000Z')), {
    startInclusive: '2026-09-05T01:30:00.000Z',
    endExclusive: '2026-09-12T01:30:00.000Z',
  })
  assert.equal(nextWeeklyBoundary(new Date('2026-09-12T01:29:59.999Z')), '2026-09-12T01:30:00.000Z')
  assert.equal(nextWeeklyBoundary(new Date('2026-09-12T01:30:00.000Z')), '2026-09-19T01:30:00.000Z')
})

test('consecutive weekly periods meet exactly without overlap or gaps', () => {
  const first = latestCompletedWeeklyRange(new Date('2026-09-12T02:00:00.000Z'))
  const second = latestCompletedWeeklyRange(new Date('2026-09-19T02:00:00.000Z'))
  assert.equal(first.endExclusive, second.startInclusive)
  assert.equal(Date.parse(first.endExclusive) - Date.parse(first.startInclusive), 7 * 24 * 60 * 60 * 1000)
})

test('weekly aggregation keeps currencies separate and counts item quantities and sale platforms', () => {
  const result = aggregateWeeklySales({
    sales: [
      { id: 'sale-1', currency: 'USD', net_credit: '100.20', platform_fee: '12.50', platform: 'Eldorado' },
      { id: 'sale-2', currency: 'USD', net_credit: '52.20', platform_fee: '7.17', platform: 'ZeusX' },
      { id: 'sale-3', currency: 'MYR', net_credit: '83.50', platform_fee: '4.20', platform: 'Eldorado' },
      { id: 'sale-4', currency: 'IDR', net_credit: '1250000', platform_fee: '100000', platform: 'Itemku' },
    ],
    saleItems: [
      { item_id: 'dino', quantity: '2', item: { name: 'Dinosaur Fossil' } },
      { item_id: 'dino', quantity: '5', item: [{ name: 'Dinosaur Fossil' }] },
      { item_id: 'greenhouse', quantity: '5', item: { name: 'Greenhouse' } },
    ],
  })

  assert.equal(result.salesCount, 4)
  assert.equal(result.itemQuantity, '12')
  assert.deepEqual(result.currencies.USD, { netCredit: '152.4', platformFees: '19.67' })
  assert.deepEqual(result.currencies.MYR, { netCredit: '83.5', platformFees: '4.2' })
  assert.deepEqual(result.currencies.IDR, { netCredit: '1250000', platformFees: '100000' })
  assert.deepEqual(result.topItems, [
    { name: 'Dinosaur Fossil', total: '7' },
    { name: 'Greenhouse', total: '5' },
  ])
  assert.deepEqual(result.platforms, [
    { name: 'Eldorado', count: 2 },
    { name: 'Itemku', count: 1 },
    { name: 'ZeusX', count: 1 },
  ])
})

test('weekly embed reports RAR and MR independently and combines counts only', () => {
  const range = {
    startInclusive: '2026-09-05T01:30:00.000Z',
    endExclusive: '2026-09-12T01:30:00.000Z',
  }
  const rar = aggregateWeeklySales({
    sales: [{ currency: 'USD', net_credit: '10', platform_fee: '1', platform: 'Eldorado' }],
    saleItems: [{ quantity: 2, item: { name: 'RAR item' } }],
  })
  const mr = aggregateWeeklySales({
    sales: [{ currency: 'MYR', net_credit: '20', platform_fee: '2', platform: 'TNG' }],
    saleItems: [{ quantity: 4, item: { name: 'MR item' } }],
  })
  const embed = buildWeeklySalesEmbed({ range, rar, mr })

  assert.equal(embed.title, '📊 WEEKLY SALES OVERVIEW')
  assert.match(embed.description, /5 Sep – 12 Sep 2026/)
  assert.match(embed.fields[0].value, /USD 10\.00/)
  assert.doesNotMatch(embed.fields[0].value, /MYR/)
  assert.match(embed.fields[1].value, /MYR 20\.00/)
  assert.deepEqual(embed.fields[2], {
    name: 'ALL BUSINESS',
    value: 'Sales: 2\nItems sold: 6',
    inline: false,
  })
  assert.ok(embed.footer.text.includes(weeklyReportMarker(range)))
})

test('empty week produces a compact zero-sales report', () => {
  const range = latestCompletedWeeklyRange(new Date('2026-09-12T02:00:00.000Z'))
  const empty = aggregateWeeklySales({})
  const embed = buildWeeklySalesEmbed({ range, rar: empty, mr: empty })

  assert.equal(empty.salesCount, 0)
  assert.equal(empty.itemQuantity, '0')
  assert.match(embed.fields[0].value, /Sales: 0/)
  assert.match(embed.fields[0].value, /Items sold: 0/)
  assert.match(embed.fields[0].value, /Top items\*\*\n• None/)
  assert.equal(embed.fields[2].value, 'Sales: 0\nItems sold: 0')
})
