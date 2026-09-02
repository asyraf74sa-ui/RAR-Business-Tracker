import assert from 'node:assert/strict'
import test from 'node:test'
import { isSaleMessage, parseSaleMessage, SaleParseError } from '../src/parser.js'

test('classifies only sale headers as sales messages', () => {
  assert.equal(isSaleMessage('RAR - 1 PIANO\n10 US\n1 US TAX\nZEUSX'), true)
  assert.equal(isSaleMessage('RAR PURCHASE - 1 PIANO\n10 USD'), false)
  assert.equal(isSaleMessage('RAR FARM - 1 CYCLE'), false)
  assert.equal(isSaleMessage('RAR TRADE\nGIVE - 1 PIANO\nRECEIVE - 1 GEMS'), false)
  assert.equal(isSaleMessage('RAR ADD - 5 HOST STATION'), false)
  assert.equal(isSaleMessage('RAR STOCK - 17 HOST STATION'), false)
})

test('parses a Gems sale', () => {
  const sale = parseSaleMessage(`RAR - 8,000 GEMS

11.52 US

1.28 US TAX

ZEUSX`)

  assert.deepEqual(sale.items, [{ quantity: 8000, name: 'GEMS' }])
  assert.equal(sale.netCredit, 11.52)
  assert.equal(sale.platformFee, 1.28)
  assert.equal(sale.currency, 'USD')
  assert.equal(sale.platform, 'ZeusX')
})

test('parses a comma-separated bundle without splitting thousands', () => {
  const sale = parseSaleMessage(`RAR - 3,000 GEMS , 1 PIANO
12.42 US
1.38 US TAX
ZEUSX`)

  assert.deepEqual(sale.items, [
    { quantity: 3000, name: 'GEMS' },
    { quantity: 1, name: 'PIANO' },
  ])
  assert.equal(sale.netCredit, 12.42)
  assert.equal(sale.platformFee, 1.38)
})

test('parses a three-item bundle and fee without a currency suffix', () => {
  const sale = parseSaleMessage(`RAR - 3 Dino Fossil, 2 Host Station, 1 Food Pantry
26.50 US
2.94 TAX
ZEUSX`)

  assert.deepEqual(sale.items, [
    { quantity: 3, name: 'Dino Fossil' },
    { quantity: 2, name: 'Host Station' },
    { quantity: 1, name: 'Food Pantry' },
  ])
  assert.equal(sale.netCredit, 26.5)
  assert.equal(sale.platformFee, 2.94)
})

test('parses plus-separated items case-insensitively', () => {
  const sale = parseSaleMessage(`rar - 4 Greenhouse + 3 Host Station
30.15 us
3.35 US TAX
zeusx`)

  assert.deepEqual(sale.items, [
    { quantity: 4, name: 'Greenhouse' },
    { quantity: 3, name: 'Host Station' },
  ])
  assert.equal(sale.netCredit, 30.15)
  assert.equal(sale.platformFee, 3.35)
  assert.equal(sale.platform, 'ZeusX')
})

test('accepts USD and dollar markers with optional TAX wording', () => {
  const sale = parseSaleMessage(`RAR - 1 Piano
USD 12.42
$1.38
Player Auctions`)

  assert.equal(sale.netCredit, 12.42)
  assert.equal(sale.platformFee, 1.38)
  assert.equal(sale.currency, 'USD')
  assert.equal(sale.platform, 'PlayerAuctions')
})

test('rejects a malformed sale', () => {
  assert.throws(
    () => parseSaleMessage('RAR - some Gems\nZeusX'),
    (error) => error instanceof SaleParseError,
  )
})
