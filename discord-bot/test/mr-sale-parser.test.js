import assert from 'node:assert/strict'
import test from 'node:test'
import { APPROVED_MR_CATALOG, APPROVED_MR_SET_FAMILIES } from '../fixtures/approved-mr-catalog.js'
import { AmbiguousItemError, UnknownItemError } from '../src/catalog.js'
import { resolveMRItems, resolveMRSaleItems } from '../src/mr-catalog.js'
import { MRItemParseError, parseMRSaleItemSequence } from '../src/mr-sale-parser.js'
import { parseSaleMessage, SaleParseError } from '../src/parser.js'

const catalog = {
  items: [
    item('gems', 'Gems (MR)', 100_000_000, ['MR Gems', 'Gems']),
    item('gxmas', 'Golden Christmas Tree'),
    item('gwell', 'Gingerbread Well'),
    item('luxtray', 'Luxury Silverware Tray'),
    item('snow', 'Snowglobe Tip Jar'),
    item('relic', 'Infernus Dominus Relic'),
    item('lt', 'Lightning Tile'),
    item('inv-well', 'Inverted Well'),
    item('moai', 'Moai Statue'),
    item('hyper-order', 'Hyper Order Stand'),
    item('cookies', "Santa's Cookies"),
    ...setComponents('candy', 'Candy Cane'),
    ...setComponents('dom', 'Dominus Infernus'),
    ...setComponents('inv', 'Inverted Royal'),
    ...setComponents('corr', 'Corrupted Royal'),
    ...setComponents('royal', 'Royal'),
  ],
  setFamilies: [
    setFamily('candy', 'Candy Cane'),
    setFamily('dom', 'Dominus Infernus'),
    setFamily('inv', 'Inverted Royal'),
    setFamily('corr', 'Corrupted Royal'),
    setFamily('royal', 'Royal'),
  ],
}

test('parses and resolves the required compact MR sale atomically before recording', () => {
  const before = structuredClone(catalog)
  const sale = parseSaleMessage(`MR - 1GXMAS 3 LUXTRAY 50M GEMS 1 DOM
IDR 144,285
IDR 13,039 TAX
ITEMKU`, {
    itemParser: (itemText) => parseMRSaleItemSequence(itemText, catalog),
  })

  assert.deepEqual(sale.items, [
    { name: 'Golden Christmas Tree', quantity: 1 },
    { name: 'Luxury Silverware Tray', quantity: 3 },
    { name: 'Gems (MR)', quantity: 50_000_000 },
    { name: 'Dominus Infernus', quantity: 1 },
  ])
  assert.equal(sale.netCredit, 144_285)
  assert.equal(sale.platformFee, 13_039)
  assert.equal(sale.platform, 'Itemku')

  const resolved = resolveMRSaleItems(sale.items, catalog)
  assert.deepEqual(resolved.items.map(({ item: resolvedItem, quantity }) => [resolvedItem.name, quantity]), [
    ['Golden Christmas Tree', 1],
    ['Luxury Silverware Tray', 3],
    ['Gems (MR)', 50_000_000],
    ['Dominus Infernus Table', 1],
    ['Dominus Infernus Chair', 4],
  ])
  assert.deepEqual(resolved.rpcItems, [
    { item_id: 'gxmas', quantity: 1 },
    { item_id: 'luxtray', quantity: 3 },
    { item_id: 'gems', quantity: 50_000_000 },
    { set_family_id: 'dom-family', quantity: 1 },
  ])
  assert.deepEqual(catalog, before)
})

test('accepts every confirmed popular MR item alias using longest exact matching', () => {
  const cases = [
    ['GXMAS', 'Golden Christmas Tree'],
    ['G XMAS', 'Golden Christmas Tree'],
    ['GOLDEN XMAS', 'Golden Christmas Tree'],
    ['Golden Christmas Tree', 'Golden Christmas Tree'],
    ['GWELL', 'Gingerbread Well'],
    ['GINGERWELL', 'Gingerbread Well'],
    ['GINGER WELL', 'Gingerbread Well'],
    ['GINGERBREAD WELL', 'Gingerbread Well'],
    ['LUX', 'Luxury Silverware Tray'],
    ['LUXTRAY', 'Luxury Silverware Tray'],
    ['LUX TRAY', 'Luxury Silverware Tray'],
    ['LUXURY TRAY', 'Luxury Silverware Tray'],
    ['LUXURY SILVERWARE', 'Luxury Silverware Tray'],
    ['LUXURY SILVERWARE TRAY', 'Luxury Silverware Tray'],
    ['SNOW', 'Snowglobe Tip Jar'],
    ['SNOWGLOBE', 'Snowglobe Tip Jar'],
    ['SNOW GLOBE', 'Snowglobe Tip Jar'],
    ['SNOWGLOBE TIP JAR', 'Snowglobe Tip Jar'],
    ['RELIC', 'Infernus Dominus Relic'],
    ['INFERNUS RELIC', 'Infernus Dominus Relic'],
    ['DOMINUS RELIC', 'Infernus Dominus Relic'],
    ['INFERNUS DOMINUS RELIC', 'Infernus Dominus Relic'],
    ['LT', 'Lightning Tile'],
    ['L TILE', 'Lightning Tile'],
    ['L.TILE', 'Lightning Tile'],
    ['LIGHTNING TILE', 'Lightning Tile'],
    ['INV WELL', 'Inverted Well'],
    ['INVERTED WELL', 'Inverted Well'],
    ['MOAI', 'Moai Statue'],
    ['MOAI STATUE', 'Moai Statue'],
    ['HYPER ORDER', 'Hyper Order Stand'],
    ['HYPER ORDER STAND', 'Hyper Order Stand'],
  ]

  for (const [alias, expected] of cases) {
    assert.deepEqual(parseMRSaleItemSequence(`1${alias}`, catalog), [{ name: expected, quantity: 1 }], alias)
  }
})

test('parses every approved active canonical MR item with normalized case, spacing, and apostrophes', () => {
  const items = [
    ...APPROVED_MR_CATALOG.map(([name], index) => item(`active-${index}`, name)),
    item('active-gems', 'Gems (MR)', 100_000_000, ['MR Gems', 'Gems']),
    item('active-cash', 'Cash (MR)', 100_000_000, ['MR Cash', 'Cash', 'Money']),
  ]
  const itemByName = new Map(items.map((activeItem) => [activeItem.name, activeItem]))
  const fullCatalog = {
    items,
    setFamilies: APPROVED_MR_SET_FAMILIES.map(
      ([name, tableName, chairName, alias, chairsPerSet], index) => ({
        id: `active-family-${index}`,
        name,
        aliases: [alias],
        table_item_id: itemByName.get(tableName).id,
        chair_item_id: itemByName.get(chairName).id,
        chairs_per_set: chairsPerSet,
        active: true,
      }),
    ),
  }

  for (const activeItem of items) {
    const normalizedInput = activeItem.name
      .toLowerCase()
      .replace(/[\u2018\u2019']/g, '')
      .replace(/\s+/g, '   ')
    assert.deepEqual(
      parseMRSaleItemSequence(`1${normalizedInput}`, fullCatalog),
      [{ name: activeItem.name, quantity: 1 }],
      activeItem.name,
    )
  }
})

test('accepts every confirmed MR set form and expands through canonical set components', () => {
  const cases = [
    ['DOM', 'Dominus Infernus'],
    ['DOM SET', 'Dominus Infernus'],
    ['DOMINUS', 'Dominus Infernus'],
    ['DOMINUS SET', 'Dominus Infernus'],
    ['DOMINUS INFERNUS SET', 'Dominus Infernus'],
    ['CORR', 'Corrupted Royal'],
    ['CORR SET', 'Corrupted Royal'],
    ['CORRUPTED', 'Corrupted Royal'],
    ['CORRUPTED SET', 'Corrupted Royal'],
    ['CORRUPTED ROYAL SET', 'Corrupted Royal'],
    ['INV', 'Inverted Royal'],
    ['INV SET', 'Inverted Royal'],
    ['INVERTED', 'Inverted Royal'],
    ['INVERTED SET', 'Inverted Royal'],
    ['INVERTED ROYAL SET', 'Inverted Royal'],
    ['CANDY', 'Candy Cane'],
    ['CANDY SET', 'Candy Cane'],
    ['CANDY CANE', 'Candy Cane'],
    ['CANDY CANE SET', 'Candy Cane'],
    ['ROYAL', 'Royal'],
    ['ROYAL SET', 'Royal'],
  ]

  for (const [alias, family] of cases) {
    const parsed = parseMRSaleItemSequence(`2 ${alias}`, catalog)
    assert.deepEqual(parsed, [{ name: family, quantity: 2 }], alias)
    const resolved = resolveMRSaleItems(parsed, catalog)
    assert.deepEqual(
      resolved.items.slice(-2).map(({ quantity }) => quantity),
      [2, 8],
      alias,
    )
  }
})

test('normalizes separators, spacing, punctuation, apostrophes, and component plurals', () => {
  assert.deepEqual(
    parseMRSaleItemSequence("1GINGERBREAD-WELL, 2 L.TILE + 3Santas   Cookies", catalog),
    [
      { name: 'Gingerbread Well', quantity: 1 },
      { name: 'Lightning Tile', quantity: 2 },
      { name: "Santa's Cookies", quantity: 3 },
    ],
  )
  assert.deepEqual(
    parseMRSaleItemSequence('2 Dominus Infernus Chairs 1 Royal Tables 3 Candy Sets', catalog),
    [
      { name: 'Dominus Infernus Chair', quantity: 2 },
      { name: 'Royal Table', quantity: 1 },
      { name: 'Candy Cane', quantity: 3 },
    ],
  )
})

test('supports MR million shorthand with or without spaces and GEMS', () => {
  for (const text of ['1M', '1 M', '1 MILLION', '1MGEMS', '1 M GEMS', '1 MILLION GEMS']) {
    assert.deepEqual(parseMRSaleItemSequence(text, catalog), [{ name: 'Gems (MR)', quantity: 1_000_000 }], text)
  }
  for (const text of ['50M', '50MGEMS', '50M GEMS', '50 M GEMS', '50 MILLION GEMS']) {
    assert.deepEqual(parseMRSaleItemSequence(text, catalog), [{ name: 'Gems (MR)', quantity: 50_000_000 }], text)
  }
  assert.deepEqual(parseMRSaleItemSequence('1 MOAI', catalog), [{ name: 'Moai Statue', quantity: 1 }])
  assert.deepEqual(
    resolveMRSaleItems(parseMRSaleItemSequence('1M', catalog), catalog).rpcItems,
    [{ item_id: 'gems', quantity: 1_000_000 }],
  )
})

test('parses compact and spaced mixed sequences and glued set quantities', () => {
  const expected = [
    { name: 'Golden Christmas Tree', quantity: 1 },
    { name: 'Luxury Silverware Tray', quantity: 3 },
    { name: 'Gems (MR)', quantity: 50_000_000 },
    { name: 'Dominus Infernus', quantity: 1 },
  ]
  assert.deepEqual(parseMRSaleItemSequence('1GXMAS 3LUXTRAY 50MGEMS 1DOM', catalog), expected)
  assert.deepEqual(parseMRSaleItemSequence('1 GXMAS 3 LUXTRAY 50 M GEMS 1 DOM', catalog), expected)
  assert.deepEqual(parseMRSaleItemSequence('1GXMAS, 3 LUXTRAY, 50M GEMS, 1 DOM', catalog), expected)

  const setCases = [
    ['1DOM', 'Dominus Infernus'],
    ['2CORR', 'Corrupted Royal'],
    ['1INV', 'Inverted Royal'],
    ['1CANDY', 'Candy Cane'],
    ['1ROYAL', 'Royal'],
  ]
  for (const [input, name] of setCases) {
    assert.deepEqual(parseMRSaleItemSequence(input, catalog), [{ name, quantity: Number(input.match(/^\d+/)[0]) }])
  }
})

test('reports the smallest unknown token and all items recognized before it', () => {
  assert.throws(
    () => parseMRSaleItemSequence('1GXMAS 2 NOT A REAL ITEM 1MOAI', catalog),
    (error) => error instanceof MRItemParseError
      && error.token === 'NOT'
      && /Recognized before failure:\n1x Golden Christmas Tree/.test(error.message)
      && !/Moai Statue/.test(error.message),
  )
})

test('rejects ambiguous, inactive, zero, and missing-name input without catalog mutation', () => {
  const ambiguous = structuredClone(catalog)
  ambiguous.items.push(item('other', 'Other Item', 10, ['GXMAS']))
  const inactive = structuredClone(catalog)
  inactive.items.find(({ id }) => id === 'gxmas').is_archived = true
  const before = structuredClone(ambiguous)

  assert.throws(() => parseMRSaleItemSequence('1GXMAS', ambiguous), AmbiguousItemError)
  assert.throws(() => parseMRSaleItemSequence('1GXMAS', inactive), MRItemParseError)
  assert.throws(() => parseMRSaleItemSequence('0GXMAS', catalog), /Invalid MR item quantity/)
  assert.throws(() => parseMRSaleItemSequence('1', catalog), /Missing MR item name/)
  assert.deepEqual(ambiguous, before)
})

test('MR STOCK-style resolution remains strict while normal MR operations may use shorthand', () => {
  assert.equal(resolveMRItems([{ name: 'GXMAS', quantity: 1 }], catalog).items[0].item.id, 'gxmas')
  assert.throws(
    () => resolveMRItems(
      [{ name: 'GXMAS', quantity: 1 }],
      catalog,
      { allowSets: false, allowShorthand: false, combineDuplicates: false },
    ),
    UnknownItemError,
  )
  assert.equal(
    resolveMRItems(
      [{ name: 'Golden Christmas Tree', quantity: 1 }],
      catalog,
      { allowSets: false, allowShorthand: false, combineDuplicates: false },
    ).items[0].item.id,
    'gxmas',
  )
})

test('RAR sale parsing does not gain MR glued quantities or million shorthand', () => {
  assert.throws(
    () => parseSaleMessage('RAR - 1GXMAS 1M GEMS\n10 USD\n1 USD TAX\nITEMKU'),
    SaleParseError,
  )
})

function item(id, name, currentQuantity = 100, aliases = []) {
  return { id, name, current_quantity: currentQuantity, is_archived: false, aliases }
}

function setComponents(key, name) {
  return [item(`${key}-table`, `${name} Table`), item(`${key}-chair`, `${name} Chair`, 400)]
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
