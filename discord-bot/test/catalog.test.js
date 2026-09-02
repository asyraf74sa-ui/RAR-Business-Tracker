import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AmbiguousItemError,
  InsufficientStockError,
  UnknownItemError,
  resolveSaleItems,
} from '../src/catalog.js'

const catalog = [
  { id: 'gems', name: 'Gems', stock: 10000, active: true },
  { id: 'dino', name: 'Dinosaur Fossil', stock: 5, active: true },
  { id: 'piano', name: 'Piano', stock: 1, active: true },
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
