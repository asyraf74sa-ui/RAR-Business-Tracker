import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AmbiguousItemError,
  DuplicateItemError,
  InsufficientStockError,
  TradeValidationError,
  UnknownItemError,
} from '../src/catalog.js'
import { resolveMRItems, resolveMRSaleItems, resolveMRTradeItems } from '../src/mr-catalog.js'

const catalog = {
  items: [
    { id: 'table', name: 'Test Table', current_quantity: 5, is_archived: false, aliases: ['TT'] },
    { id: 'chair', name: 'Test Chair', current_quantity: 22, is_archived: false, aliases: ['TC'] },
    { id: 'lamp', name: 'Test Lamp', current_quantity: 2, is_archived: false, aliases: [] },
  ],
  setFamilies: [{
    id: 'family',
    name: 'Test Family',
    aliases: ['Test Set'],
    table_item_id: 'table',
    chair_item_id: 'chair',
    chairs_per_set: 4,
    active: true,
  }],
}

test('confirmed MR set alias expands to one table and four chairs per set', () => {
  const result = resolveMRItems([{ name: 'test set', quantity: 2 }], catalog)
  assert.deepEqual(result.items.map(({ item, quantity }) => [item.id, quantity]), [
    ['table', 2],
    ['chair', 8],
  ])
  assert.deepEqual(result.rpcItems, [{ set_family_id: 'family', quantity: 2 }])
})

test('MR resolution uses only canonical names and explicitly stored aliases', () => {
  assert.equal(resolveMRItems([{ name: 'tt', quantity: 1 }], catalog).items[0].item.id, 'table')
  assert.throws(() => resolveMRItems([{ name: 'guessed family set', quantity: 1 }], catalog), UnknownItemError)
})

test('ambiguous MR aliases reject the whole operation', () => {
  const ambiguous = structuredClone(catalog)
  ambiguous.items[2].aliases = ['TT']
  assert.throws(() => resolveMRItems([{ name: 'TT', quantity: 1 }], ambiguous), AmbiguousItemError)
})

test('MR sale rejects insufficient component stock after set expansion', () => {
  assert.throws(
    () => resolveMRSaleItems([{ name: 'Test Set', quantity: 6 }], catalog),
    (error) => error instanceof InsufficientStockError && error.itemName === 'Test Table',
  )
})

test('MR STOCK rejects overlapping expanded component counts', () => {
  assert.throws(
    () => resolveMRItems([
      { name: 'Test Set', quantity: 1 },
      { name: 'Test Table', quantity: 2 },
    ], catalog, { combineDuplicates: false }),
    DuplicateItemError,
  )
})

test('MR trade never permits the same expanded component on both sides', () => {
  assert.throws(
    () => resolveMRTradeItems(
      [{ name: 'Test Set', quantity: 1 }],
      [{ name: 'Test Chair', quantity: 1 }],
      catalog,
    ),
    TradeValidationError,
  )
})
