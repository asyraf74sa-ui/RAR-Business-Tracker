import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AmbiguousItemError,
  DuplicateItemError,
  InsufficientStockError,
  UnknownItemError,
  resolveManualAddItems,
  resolvePurchaseItems,
  resolveSaleItems,
  resolveStockItems,
  resolveTradeItems,
} from '../src/catalog.js'

const catalog = [
  { id: 'gems', name: 'Gems', stock: 10000, kind: 'currency', active: true },
  { id: 'dino', name: 'Dinosaur Fossil', stock: 5, kind: 'item', active: true },
  { id: 'greenhouse', name: 'Greenhouse', stock: 1, kind: 'item', active: true },
  { id: 'host', name: 'Host Station', stock: 2, kind: 'item', active: true },
  { id: 'piano', name: 'Piano', stock: 1, kind: 'item', active: true },
]

test('resolves Gems, reasonable plurals, and the Dino alias', () => {
  const resolved = resolveSaleItems([
    { quantity: 3000, name: 'GEM' },
    { quantity: 2, name: 'Dino Fossils' },
    { quantity: 1, name: 'Pianos' },
  ], catalog)

  assert.deepEqual(resolved.map(({ item, quantity }) => [item.name, quantity]), [
    ['Gems', 3000],
    ['Dinosaur Fossil', 2],
    ['Piano', 1],
  ])
})

test('rejects an unknown item', () => {
  assert.throws(
    () => resolveSaleItems([{ quantity: 1, name: 'Mystery Chair' }], catalog),
    UnknownItemError,
  )
})

test('never guesses when aliases match multiple catalog items', () => {
  const ambiguousCatalog = [
    { id: 'a', name: 'Gem', stock: 10, active: true },
    { id: 'b', name: 'Gems', stock: 10, active: true },
  ]

  assert.throws(
    () => resolveSaleItems([{ quantity: 1, name: 'Gems' }], ambiguousCatalog),
    AmbiguousItemError,
  )
})

test('rejects insufficient stock before calling the sale RPC', () => {
  assert.throws(
    () => resolveSaleItems([{ quantity: 2, name: 'Piano' }], catalog),
    InsufficientStockError,
  )
})

test('resolves every purchase item without applying sale-style stock checks', () => {
  const resolved = resolvePurchaseItems([
    { quantity: 5, name: 'Host Stations' },
    { quantity: 2, name: 'Greenhouse' },
  ], catalog)

  assert.deepEqual(resolved.map(({ item, quantity }) => [item.name, quantity]), [
    ['Host Station', 5],
    ['Greenhouse', 2],
  ])
})

test('keeps trade GIVE and RECEIVE directions after canonical resolution', () => {
  const resolved = resolveTradeItems(
    [{ quantity: 2, name: 'Host Station' }, { quantity: 1, name: 'Dino Fossil' }],
    [{ quantity: 1, name: 'Piano' }, { quantity: 2000, name: 'GEMS' }],
    catalog,
  )

  assert.deepEqual(resolved.give.map(({ item, quantity }) => [item.name, quantity]), [
    ['Host Station', 2],
    ['Dinosaur Fossil', 1],
  ])
  assert.deepEqual(resolved.receive.map(({ item, quantity }) => [item.name, quantity]), [
    ['Piano', 1],
    ['Gems', 2000],
  ])
})

test('insufficient outgoing stock rejects the entire resolved trade with quantities', () => {
  assert.throws(
    () => resolveTradeItems(
      [{ quantity: 2, name: 'Piano' }, { quantity: 1, name: 'Greenhouse' }],
      [{ quantity: 100, name: 'Gems' }],
      catalog,
    ),
    (error) => error instanceof InsufficientStockError
      && error.itemName === 'Piano'
      && error.required === 2
      && error.available === 1,
  )
})

test('an unknown item rejects the entire trade before it can be recorded', () => {
  assert.throws(
    () => resolveTradeItems(
      [{ quantity: 1, name: 'Golden Thing' }],
      [{ quantity: 1, name: 'Gems' }],
      catalog,
    ),
    UnknownItemError,
  )
})

test('manual ADD resolves item and Gems bundles as positive increments', () => {
  const resolved = resolveManualAddItems([
    { quantity: 5, name: 'HOST STATIONS' },
    { quantity: 6000, name: 'gems' },
  ], catalog)

  assert.deepEqual(resolved.map(({ item, quantity }) => [item.name, quantity]), [
    ['Host Station', 5],
    ['Gems', 6000],
  ])
})

test('an unknown ADD item rejects the entire bundle', () => {
  assert.throws(
    () => resolveManualAddItems([
      { quantity: 5, name: 'Host Station' },
      { quantity: 1, name: 'Golden Thing' },
    ], catalog),
    UnknownItemError,
  )
})

test('STOCK resolves exact quantities including zero', () => {
  const resolved = resolveStockItems([
    { quantity: 0, name: 'Piano' },
    { quantity: 46398, name: 'GEMS' },
  ], catalog)

  assert.deepEqual(resolved.map(({ item, quantity }) => [item.name, quantity]), [
    ['Piano', 0],
    ['Gems', 46398],
  ])
})

test('an unknown STOCK item rejects the entire bundle', () => {
  assert.throws(
    () => resolveStockItems([
      { quantity: 17, name: 'Host Station' },
      { quantity: 8, name: 'Golden Thing' },
    ], catalog),
    UnknownItemError,
  )
})

test('STOCK rejects duplicate canonical items instead of adding their counts', () => {
  assert.throws(
    () => resolveStockItems([
      { quantity: 17, name: 'Host Station' },
      { quantity: 8, name: 'Host Stations' },
    ], catalog),
    DuplicateItemError,
  )
})
