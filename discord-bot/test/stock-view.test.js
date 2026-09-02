import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildStockAutocompleteChoices,
  buildStockItemPage,
  buildStockOverviewPages,
  findExactStockItem,
  formatStockQuantity,
} from '../src/stock-view.js'

const inventory = [
  { id: 'piano', name: 'Piano', stock: '0.00', kind: 'item', active: true },
  { id: 'inactive', name: 'Archived Item', stock: 99, kind: 'item', active: false },
  { id: 'gems', name: 'Gems', stock: 46398, kind: 'currency', active: true },
  { id: 'pantry', name: 'Food Pantry', stock: '10.00', kind: 'item', active: true },
  { id: 'other', name: 'Ignored Kind', stock: 7, kind: 'service', active: true },
]

test('/stock shows all active item and currency rows, including Gems and zero stock, alphabetically', () => {
  const pages = buildStockOverviewPages(inventory)
  assert.equal(pages.length, 1)
  assert.deepEqual(pages[0].description.split('\n'), [
    'Food Pantry — 10',
    'Gems — 46,398',
    'Piano — 0',
  ])
  assert.doesNotMatch(pages[0].description, /Archived Item|Ignored Kind/)
})

test('stock quantities use commas, remove only redundant zeroes, and preserve meaningful decimals', () => {
  assert.equal(formatStockQuantity(46398), '46,398')
  assert.equal(formatStockQuantity('10.00'), '10')
  assert.equal(formatStockQuantity('1234567.125000'), '1,234,567.125')
})

test('/stock item resolves one exact canonical item without fuzzy matching', () => {
  const piano = findExactStockItem(inventory, 'pIaNo')
  assert.equal(piano?.name, 'Piano')
  assert.deepEqual(buildStockItemPage(piano), {
    title: '📦 Piano',
    description: 'Current stock: 0',
    color: 0x2f7d4a,
    footer: { text: 'Live, read-only inventory' },
  })
  assert.equal(findExactStockItem(inventory, 'Pian'), null)
  assert.equal(findExactStockItem(inventory, 'Archived Item'), null)
  assert.equal(findExactStockItem(inventory, 'Unknown Item'), null)
})

test('stock autocomplete uses active canonical names and Discord choice limits', () => {
  const many = Array.from({ length: 40 }, (_, index) => ({
    id: `item-${index}`,
    name: `Item ${String(index).padStart(2, '0')}`,
    stock: 1,
    kind: 'item',
    active: true,
  }))
  const choices = buildStockAutocompleteChoices([...inventory, ...many], 'item')
  assert.equal(choices.length, 25)
  assert.deepEqual(choices[0], { name: 'Item 00', value: 'Item 00' })
  assert.ok(choices.every(({ name, value }) => name === value && name.length <= 100))
})

test('long stock inventories split into complete embed-safe pages without truncation', () => {
  const items = Array.from({ length: 700 }, (_, index) => ({
    id: `item-${index}`,
    name: `Canonical Item ${String(700 - index).padStart(4, '0')} with exact catalog spelling`,
    stock: index,
    kind: index === 0 ? 'currency' : 'item',
    active: true,
  }))

  const pages = buildStockOverviewPages(items)
  assert.ok(pages.length > 1)
  assert.ok(pages.every((page) => page.title.length <= 256 && page.description.length <= 3900))

  const displayedNames = pages
    .flatMap((page) => page.description.split('\n'))
    .map((line) => line.split(' — ')[0])
  const expectedNames = [...items]
    .map(({ name }) => name)
    .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }))
  assert.deepEqual(displayedNames, expectedNames)
})

test('an empty active catalog returns a useful page', () => {
  const [page] = buildStockOverviewPages([])
  assert.equal(page.description, 'No active RAR items were found.')
})
