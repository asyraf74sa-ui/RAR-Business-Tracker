import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { APPROVED_MR_CATALOG, APPROVED_MR_SET_FAMILIES } from '../discord-bot/fixtures/approved-mr-catalog.js'
import { assertDisjointMRTrade, assertMRStock, expandMRLines, selectionValue, toMRRpcPayload } from '../src/lib/mr-operations.js'

function catalog() {
  const names = new Set(APPROVED_MR_SET_FAMILIES.flatMap(([, table, chair]) => [table, chair]))
  const items = [...names].map((name) => ({ id: name, name, current_quantity: name === 'Royal Table' ? 52 : name === 'Royal Chair' ? 151 : 100, is_archived: false }))
  const families = APPROVED_MR_SET_FAMILIES.map(([name, table, chair, alias, chairs]) => ({ id: name, name, table_item_id: table, chair_item_id: chair, aliases: [alias], chairs_per_set: chairs, active: true }))
  return { items, setFamilies: families }
}

test('the MR workspace fixture retains the exact 73-item production catalog', () => {
  assert.equal(APPROVED_MR_CATALOG.length, 73)
  assert.deepEqual(Object.fromEntries(['Furnitures', 'Appliances', 'Decorations'].map((category) => [category, APPROVED_MR_CATALOG.filter(([, value]) => value === category).length])), { Furnitures: 11, Appliances: 22, Decorations: 40 })
})

test('MR sale and purchase payloads preserve set-family identity for atomic backend expansion', () => {
  assert.deepEqual(toMRRpcPayload([{ selection: selectionValue('set', 'Royal'), quantity: '2' }]), [{ set_family_id: 'Royal', quantity: 2 }])
  assert.deepEqual(expandMRLines([{ selection: selectionValue('set', 'Royal'), quantity: '2' }], catalog()).map((line) => [line.item.name, line.quantity]), [['Royal Table', 2], ['Royal Chair', 8]])
})

test('MR sale stock checks use expanded table and chair requirements', () => {
  assert.doesNotThrow(() => assertMRStock([{ selection: selectionValue('set', 'Royal'), quantity: '37' }], catalog()))
  assert.throws(() => assertMRStock([{ selection: selectionValue('set', 'Royal'), quantity: '38' }], catalog()), /Royal Chair has only 151/)
})

test('MR trades reject component overlap and check GIVE stock without financial fields', () => {
  assert.throws(() => assertDisjointMRTrade(
    [{ selection: selectionValue('set', 'Royal'), quantity: '1' }],
    [{ selection: selectionValue('item', 'Royal Chair'), quantity: '1' }],
    catalog(),
  ), /cannot appear in both GIVE and RECEIVE/)
})

test('MR website forms call only the deployed atomic MR RPCs', () => {
  const sale = readFileSync(new URL('../src/pages/MRSale.jsx', import.meta.url), 'utf8')
  const operations = readFileSync(new URL('../src/pages/MROperations.jsx', import.meta.url), 'utf8')
  assert.match(sale, /rpc\('mr_record_sale'/)
  assert.doesNotMatch(sale, /from\('mr_items'\)\.update/)
  assert.match(operations, /mr_record_purchase_bundle/)
  assert.match(operations, /mr_record_trade/)
  assert.doesNotMatch(operations, /net_credit|platform_fee/)
})
