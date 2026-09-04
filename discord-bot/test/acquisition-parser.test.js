import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AcquisitionParseError,
  detectAcquisitionOperation,
  parseAddMessage,
  parseAcquisitionMessage,
  parseCashAmount,
  parseFarmMessage,
  parsePurchaseMessage,
  parseStockMessage,
  parseTradeMessage,
} from '../src/acquisition-parser.js'

test('classifies only acquisition headers as acquisition operations', () => {
  assert.equal(detectAcquisitionOperation('RAR PURCHASE - 1 PIANO\n25 USD'), 'purchase')
  assert.equal(detectAcquisitionOperation('RAR FARM - 1 CYCLE'), 'farm')
  assert.equal(detectAcquisitionOperation('RAR TRADE\nGIVE - 1 PIANO\nRECEIVE - 1 GEMS'), 'trade')
  assert.equal(detectAcquisitionOperation('RAR ADD - 1 PIANO'), 'manual_add')
  assert.equal(detectAcquisitionOperation('RAR STOCK - 1 PIANO'), 'stock_reconcile')
  assert.equal(detectAcquisitionOperation('MR PURCHASE - 1 TEST ITEM\n25 USD'), 'purchase')
  assert.equal(detectAcquisitionOperation('MR STOCK - 0 TEST ITEM'), 'stock_reconcile')
  assert.equal(detectAcquisitionOperation('RAR - 1 PIANO\n10 US\n1 US TAX\nZEUSX'), null)
})

test('MR purchase, trade, add, and exact stock use the shared parser without enabling MR FARM', () => {
  assert.equal(parseAcquisitionMessage('MR PURCHASE - 1 TEST ITEM\n25 USD').game, 'MR')
  assert.equal(parseAcquisitionMessage('MR ADD - 2 TEST ITEM').game, 'MR')
  assert.equal(parseAcquisitionMessage('MR STOCK - 0 TEST ITEM').items[0].quantity, 0)
  assert.equal(parseAcquisitionMessage('MR TRADE\nGIVE - 1 TEST ITEM\nRECEIVE - 2 OTHER ITEM').game, 'MR')
  assert.throws(() => parseAcquisitionMessage('MR FARM - 1 CYCLE'), /not supported/i)
})

test('parses a single-item manual stock addition', () => {
  assert.deepEqual(parseAddMessage('RAR ADD - 5 HOST STATION'), {
    type: 'manual_add',
    items: [{ quantity: 5, name: 'HOST STATION' }],
  })
})

test('parses comma- and plus-separated manual-add bundles', () => {
  assert.deepEqual(parseAddMessage('RAR ADD - 5 HOST STATION, 3 GREENHOUSE'), {
    type: 'manual_add',
    items: [
      { quantity: 5, name: 'HOST STATION' },
      { quantity: 3, name: 'GREENHOUSE' },
    ],
  })
  assert.deepEqual(parseAddMessage('RAR ADD - 5 HOST STATION + 3 GREENHOUSE').items, [
    { quantity: 5, name: 'HOST STATION' },
    { quantity: 3, name: 'GREENHOUSE' },
  ])
})

test('parses a comma-formatted Gems manual addition', () => {
  assert.deepEqual(parseAddMessage('RAR ADD - 6,000 GEMS').items, [
    { quantity: 6000, name: 'GEMS' },
  ])
})

test('manual stock addition rejects zero and negative quantities', () => {
  assert.throws(() => parseAddMessage('RAR ADD - 0 HOST STATION'))
  assert.throws(() => parseAddMessage('RAR ADD - -1 HOST STATION'))
})

test('parses single and bundled exact stock counts', () => {
  assert.deepEqual(parseStockMessage('RAR STOCK - 17 HOST STATION'), {
    type: 'stock_reconcile',
    items: [{ quantity: 17, name: 'HOST STATION' }],
  })
  assert.deepEqual(parseStockMessage('RAR STOCK - 17 HOST STATION, 8 GREENHOUSE, 46,398 GEMS').items, [
    { quantity: 17, name: 'HOST STATION' },
    { quantity: 8, name: 'GREENHOUSE' },
    { quantity: 46398, name: 'GEMS' },
  ])
})

test('exact stock counts allow zero but reject negative quantities', () => {
  assert.deepEqual(parseStockMessage('RAR STOCK - 0 HOST STATION').items, [
    { quantity: 0, name: 'HOST STATION' },
  ])
  assert.throws(() => parseStockMessage('RAR STOCK - -1 HOST STATION'))
})

test('parses a single-item PHP purchase', () => {
  assert.deepEqual(parsePurchaseMessage(`RAR PURCHASE - 5 HOST STATION
240 PHP`), {
    type: 'purchase',
    items: [{ quantity: 5, name: 'HOST STATION' }],
    cost: { amount: 240, currency: 'PHP' },
  })
})

test('parses a bundle purchase and keeps the cost as one bundle total', () => {
  assert.deepEqual(parsePurchaseMessage(`RAR PURCHASE - 5 HOST STATION, 2 GREENHOUSE
336 PHP`), {
    type: 'purchase',
    items: [
      { quantity: 5, name: 'HOST STATION' },
      { quantity: 2, name: 'GREENHOUSE' },
    ],
    cost: { amount: 336, currency: 'PHP' },
  })
})

test('parses one and multiple farm cycles', () => {
  assert.deepEqual(parseFarmMessage('RAR FARM - 1 CYCLE'), { type: 'farm', cycles: 1 })
  assert.deepEqual(parseFarmMessage('RAR FARM - 2 CYCLES'), { type: 'farm', cycles: 2 })
})

test('parses an item-to-Gems trade without splitting 6,000', () => {
  assert.deepEqual(parseTradeMessage(`RAR TRADE
GIVE - 1 PIANO
RECEIVE - 6,000 GEMS`), {
    type: 'trade',
    giveItems: [{ quantity: 1, name: 'PIANO' }],
    receiveItems: [{ quantity: 6000, name: 'GEMS' }],
  })
})

test('parses a Gems-to-item trade', () => {
  const trade = parseTradeMessage(`RAR TRADE
GIVE - 3,000 GEMS
RECEIVE - 1 PIANO`)

  assert.deepEqual(trade.giveItems, [{ quantity: 3000, name: 'GEMS' }])
  assert.deepEqual(trade.receiveItems, [{ quantity: 1, name: 'PIANO' }])
})

test('parses an item-to-item trade', () => {
  const trade = parseTradeMessage(`RAR TRADE
GIVE - 1 GREENHOUSE
RECEIVE - 2 HOST STATION`)

  assert.deepEqual(trade.giveItems, [{ quantity: 1, name: 'GREENHOUSE' }])
  assert.deepEqual(trade.receiveItems, [{ quantity: 2, name: 'HOST STATION' }])
})

test('parses a bundle trade in the correct GIVE and RECEIVE directions', () => {
  const trade = parseTradeMessage(`RAR TRADE
GIVE - 2 HOST STATION, 1 DINOSAUR FOSSIL
RECEIVE - 1 PIANO, 2,000 GEMS`)

  assert.deepEqual(trade.giveItems, [
    { quantity: 2, name: 'HOST STATION' },
    { quantity: 1, name: 'DINOSAUR FOSSIL' },
  ])
  assert.deepEqual(trade.receiveItems, [
    { quantity: 1, name: 'PIANO' },
    { quantity: 2000, name: 'GEMS' },
  ])
})

test('dispatches acquisition formats to the matching parser', () => {
  assert.equal(parseAcquisitionMessage('RAR FARM - 1 CYCLE').type, 'farm')
  assert.equal(parseAcquisitionMessage('RAR PURCHASE - 1 PIANO\n$25').type, 'purchase')
  assert.equal(parseAcquisitionMessage('RAR TRADE\nGIVE - 1 PIANO\nRECEIVE - 1 GEMS').type, 'trade')
  assert.equal(parseAcquisitionMessage('RAR ADD - 1 PIANO').type, 'manual_add')
  assert.equal(parseAcquisitionMessage('RAR STOCK - 0 PIANO').type, 'stock_reconcile')
})

test('normalizes supported purchase currency variations', () => {
  assert.deepEqual(parseCashAmount('RM240'), { amount: 240, currency: 'MYR' })
  assert.deepEqual(parseCashAmount('240 MYR'), { amount: 240, currency: 'MYR' })
  assert.deepEqual(parseCashAmount('$25'), { amount: 25, currency: 'USD' })
  assert.deepEqual(parseCashAmount('25 USD'), { amount: 25, currency: 'USD' })
  assert.deepEqual(parseCashAmount('25 US'), { amount: 25, currency: 'USD' })
  assert.deepEqual(parseCashAmount('10,000 IDR'), { amount: 10000, currency: 'IDR' })
})

test('rejects malformed acquisition commands and unsupported currency', () => {
  assert.throws(() => parseAcquisitionMessage('RAR PURCHASE nonsense'), AcquisitionParseError)
  assert.throws(() => parsePurchaseMessage('RAR PURCHASE - 1 PIANO\n25 SGD'), AcquisitionParseError)
  assert.throws(() => parseFarmMessage('RAR FARM - 0 CYCLES'), AcquisitionParseError)
  assert.throws(
    () => parseTradeMessage('RAR TRADE\nGIVE - 1 PIANO'),
    AcquisitionParseError,
  )
})
