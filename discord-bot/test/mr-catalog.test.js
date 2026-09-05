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

const productionSetCatalog = {
  items: [
    ...setComponents('candy', 'Candy Cane', 10, 40),
    ...setComponents('dom', 'Dominus Infernus', 10, 40),
    ...setComponents('inv', 'Inverted Royal', 10, 40),
    ...setComponents('corr', 'Corrupted Royal', 10, 40),
    ...setComponents('royal', 'Royal', 10, 40),
  ],
  setFamilies: [
    setFamily('candy', 'Candy Cane'),
    setFamily('dom', 'Dominus Infernus'),
    setFamily('inv', 'Inverted Royal'),
    setFamily('corr', 'Corrupted Royal'),
    setFamily('royal', 'Royal'),
  ],
}

test('confirmed MR set alias expands to one table and four chairs per set', () => {
  const result = resolveMRItems([{ name: 'test set', quantity: 2 }], catalog)
  assert.deepEqual(result.items.map(({ item, quantity }) => [item.id, quantity]), [
    ['table', 2],
    ['chair', 8],
  ])
  assert.deepEqual(result.rpcItems, [{ set_family_id: 'family', quantity: 2 }])
})

test('all confirmed production shorthand aliases and plural forms expand through canonical components', () => {
  const cases = [
    ['CANDY SET', 'candy'],
    ['CANDY', 'candy'],
    ['CANDY CANE', 'candy'],
    ['CANDY CANE SET', 'candy'],
    ['DOM', 'dom'],
    ['DOM SET', 'dom'],
    ['DOMINUS', 'dom'],
    ['DOMINUS SET', 'dom'],
    ['DOMINUS INFERNUS', 'dom'],
    ['DOMINUS INFERNUS SET', 'dom'],
    ['INV', 'inv'],
    ['INV SET', 'inv'],
    ['INVERTED', 'inv'],
    ['INVERTED SET', 'inv'],
    ['INVERTED ROYAL', 'inv'],
    ['INVERTED ROYAL SET', 'inv'],
    ['CORR', 'corr'],
    ['CORR SET', 'corr'],
    ['CORRUPTED', 'corr'],
    ['CORRUPTED SET', 'corr'],
    ['CORRUPTED ROYAL', 'corr'],
    ['CORRUPTED ROYAL SET', 'corr'],
    ['ROYAL', 'royal'],
    ['ROYAL SET', 'royal'],
  ]

  for (const [alias, key] of cases) {
    const spellings = new Set([alias, alias.toLowerCase()])
    if (alias.endsWith(' SET')) spellings.add(`${alias}S`)
    for (const spelling of spellings) {
      const result = resolveMRSaleItems([{ name: spelling, quantity: 2 }], productionSetCatalog)
      assert.deepEqual(result.items.map(({ item, quantity }) => [item.id, quantity]), [
        [`${key}-table`, 2],
        [`${key}-chair`, 8],
      ])
      assert.deepEqual(result.rpcItems, [{ set_family_id: `${key}-family`, quantity: 2 }])
    }
  }
})

test('required Corrupted Royal and Dominus shorthand examples expand exactly', () => {
  const corrupted = resolveMRSaleItems([{ name: 'CORRUPTED SET', quantity: 1 }], productionSetCatalog)
  assert.deepEqual(corrupted.items.map(({ item, quantity }) => [item.name, quantity]), [
    ['Corrupted Royal Table', 1],
    ['Corrupted Royal Chair', 4],
  ])

  const dominus = resolveMRSaleItems([{ name: 'DOM SET', quantity: 2 }], productionSetCatalog)
  assert.deepEqual(dominus.items.map(({ item, quantity }) => [item.name, quantity]), [
    ['Dominus Infernus Table', 2],
    ['Dominus Infernus Chair', 8],
  ])
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

test('insufficient set stock rejects without partially mutating the catalog snapshot', () => {
  const limited = structuredClone(productionSetCatalog)
  limited.items.find(({ id }) => id === 'corr-chair').current_quantity = 3
  const before = structuredClone(limited)

  assert.throws(
    () => resolveMRSaleItems([{ name: 'corr set', quantity: 1 }], limited),
    (error) => error instanceof InsufficientStockError
      && error.itemName === 'Corrupted Royal Chair'
      && error.required === 4
      && error.available === 3,
  )
  assert.deepEqual(limited, before)
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

test('MR STOCK rejects set aliases because exact reconciliation requires component counts', () => {
  assert.throws(
    () => resolveMRItems(
      [{ name: 'CORR SET', quantity: 1 }],
      productionSetCatalog,
      { allowSets: false, combineDuplicates: false },
    ),
    UnknownItemError,
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

function setComponents(key, name, tables, chairs) {
  return [
    {
      id: `${key}-table`,
      name: `${name} Table`,
      current_quantity: tables,
      is_archived: false,
      aliases: [],
    },
    {
      id: `${key}-chair`,
      name: `${name} Chair`,
      current_quantity: chairs,
      is_archived: false,
      aliases: [],
    },
  ]
}

function setFamily(key, name) {
  return {
    id: `${key}-family`,
    name,
    aliases: [`${name} Set`],
    table_item_id: `${key}-table`,
    chair_item_id: `${key}-chair`,
    chairs_per_set: 4,
    active: true,
  }
}
