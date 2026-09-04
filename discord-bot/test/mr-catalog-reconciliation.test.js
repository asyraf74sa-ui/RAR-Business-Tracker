import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { resolveMRItems } from '../src/mr-catalog.js'
import { deriveMRSetStock } from '../src/mr-set-stock.js'
import { buildStockOverviewPages } from '../src/stock-view.js'
import { APPROVED_MR_CATALOG, APPROVED_MR_SET_FAMILIES } from '../fixtures/approved-mr-catalog.js'

const migrationSql = readFileSync(
  new URL('../../supabase/migrations/20260904144044_mr_catalog_reconciliation.sql', import.meta.url),
  'utf8',
)

const itemRows = extractApprovedItems(migrationSql)
const familyRows = extractApprovedFamilies(migrationSql)

test('migration contains the exact approved 73-item MR catalog', () => {
  assert.deepEqual(itemRows, APPROVED_MR_CATALOG)
  assert.equal(itemRows.length, 73)
  assert.equal(new Set(itemRows.map(([name]) => normalizeName(name))).size, 73)
})

test('approved MR categories contain exactly 11 Furnitures, 22 Appliances, and 40 Decorations', () => {
  const counts = Object.fromEntries(['Furnitures', 'Appliances', 'Decorations'].map((category) => [
    category,
    itemRows.filter(([, itemCategory]) => itemCategory === category).length,
  ]))
  assert.deepEqual(counts, { Furnitures: 11, Appliances: 22, Decorations: 40 })
})

test('all four user-confirmed catalog additions are present in their approved categories', () => {
  const categories = new Map(itemRows)
  assert.equal(categories.get('Purple Arcade Machine - BIG Paintball Edition'), 'Appliances')
  assert.equal(categories.get("Santa's Sleigh"), 'Furnitures')
  assert.equal(categories.get('Haunted Statue'), 'Decorations')
  assert.equal(categories.get("Santa's Cookies"), 'Decorations')
})

test("Santa's Golden Cookies is canonical and the workbook typo is only a legacy alias", () => {
  const cookieRows = itemRows.filter(([name]) => /Golden Cookies$/i.test(name))
  assert.deepEqual(cookieRows, [["Santa's Golden Cookies", 'Decorations']])
  assert.doesNotMatch(itemRows.map(([name]) => name).join('\n'), /Santan's Golden Cookies/)
  assert.match(
    migrationSql,
    /when v_item\.name = 'Santa''s Golden Cookies'[\s\S]+?array\['Santan''s Golden Cookies'\]::text\[\]/i,
  )

  const cookieCatalog = {
    items: [{
      id: 'golden-cookies',
      name: "Santa's Golden Cookies",
      aliases: ["Santan's Golden Cookies"],
      current_quantity: 25,
      is_archived: false,
    }],
    setFamilies: [],
  }
  assert.equal(resolveMRItems([{ name: "Santa's Golden Cookies", quantity: 1 }], cookieCatalog).items[0].item.id, 'golden-cookies')
  assert.equal(resolveMRItems([{ name: "Santan's Golden Cookies", quantity: 1 }], cookieCatalog).items[0].item.id, 'golden-cookies')
})

test('migration creates exactly the five approved MR set-family mappings', () => {
  assert.deepEqual(familyRows, APPROVED_MR_SET_FAMILIES)
  assert.equal(familyRows.length, 5)
  assert.ok(familyRows.every(([, , , alias, chairsPerSet]) => alias.endsWith(' Set') && chairsPerSet === 4))
})

test('all five confirmed set aliases expand case-insensitively to one table and four chairs', () => {
  const itemNames = new Set(APPROVED_MR_SET_FAMILIES.flatMap(([, table, chair]) => [table, chair]))
  const catalog = {
    items: [...itemNames].map((name) => ({
      id: normalizeName(name), name, aliases: [], current_quantity: 100, is_archived: false,
    })),
    setFamilies: APPROVED_MR_SET_FAMILIES.map(([name, table, chair, alias, chairsPerSet]) => ({
      id: normalizeName(name),
      name,
      aliases: [alias],
      table_item_id: normalizeName(table),
      chair_item_id: normalizeName(chair),
      chairs_per_set: chairsPerSet,
      active: true,
    })),
  }

  for (const [name, table, chair, alias] of APPROVED_MR_SET_FAMILIES) {
    const result = resolveMRItems([{ name: alias.toUpperCase(), quantity: 2 }], catalog)
    assert.deepEqual(result.items.map(({ item, quantity }) => [item.name, quantity]), [
      [table, 2],
      [chair, 8],
    ], `${name} set expansion`)
  }
})

test('Royal production example derives 37 completed sets, 15 excess tables, and 3 excess chairs', () => {
  const result = deriveMRSetStock({
    name: 'Royal', table_item_id: 'table', chair_item_id: 'chair', chairs_per_set: 4,
  }, new Map([
    ['table', { current_quantity: 52 }],
    ['chair', { current_quantity: 151 }],
  ]))
  assert.equal(result.completedSets, 37)
  assert.equal(result.excessTables, 15)
  assert.equal(result.excessChairs, 3)
})

test('/stock game:MR can render all 73 approved items without introducing RAR stock', () => {
  const pages = buildStockOverviewPages(APPROVED_MR_CATALOG.map(([name], index) => ({
    id: `mr-${index}`, name, stock: index, kind: 'item', active: true,
  })), { game: 'MR' })
  const rendered = pages.map((page) => `${page.title}\n${page.description}`).join('\n')

  for (const [name] of APPROVED_MR_CATALOG) assert.match(rendered, new RegExp(escapeRegExp(name)))
  assert.ok(pages.every((page) => page.title.includes('MR Stock Overview')))
  assert.doesNotMatch(rendered, /RAR Stock Overview|Gems —|Piano —/)
})

test('catalog reconciliation preserves existing IDs and quantities and never mutates RAR business tables', () => {
  const updateStart = migrationSql.indexOf('update public.mr_items')
  const updateWhere = migrationSql.indexOf('where id = v_item_id', updateStart)
  const updateSetClause = migrationSql.slice(updateStart, updateWhere)

  assert.doesNotMatch(migrationSql, /delete\s+from\s+public\.mr_items/i)
  assert.doesNotMatch(updateSetClause, /\b(?:id|current_quantity)\s*=/i)
  assert.doesNotMatch(migrationSql, /public\.rar_(?:items|sales|sale_items|inventory_events)/i)
  assert.match(migrationSql, /else\s+insert into public\.mr_items/i)
})

function extractApprovedItems(sql) {
  const start = sql.indexOf('for v_item in')
  const end = sql.indexOf(') as approved(name, category)', start)
  assert.ok(start >= 0 && end > start, 'approved item values are present')
  return [...sql.slice(start, end).matchAll(/\('((?:[^']|'')*)', '((?:[^']|'')*)'\)/g)]
    .map((match) => [sqlString(match[1]), sqlString(match[2])])
}

function extractApprovedFamilies(sql) {
  const start = sql.indexOf('for v_family in')
  const end = sql.indexOf(') as approved(name, table_name, chair_name, set_alias, chairs_per_set)', start)
  assert.ok(start >= 0 && end > start, 'approved family values are present')
  return [...sql.slice(start, end).matchAll(
    /\('((?:[^']|'')*)', '((?:[^']|'')*)', '((?:[^']|'')*)', '((?:[^']|'')*)', (\d+)\)/g,
  )].map((match) => [
    sqlString(match[1]), sqlString(match[2]), sqlString(match[3]), sqlString(match[4]), Number(match[5]),
  ])
}

function sqlString(value) {
  return value.replaceAll("''", "'")
}

function normalizeName(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
