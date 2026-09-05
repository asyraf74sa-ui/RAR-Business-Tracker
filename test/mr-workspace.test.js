import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { APPROVED_MR_CATALOG, APPROVED_MR_SET_FAMILIES } from '../discord-bot/fixtures/approved-mr-catalog.js'
import { assertDisjointMRTrade, assertMRStock, expandMRLines, selectionValue, toMRRpcPayload } from '../src/lib/mr-operations.js'
import { buildMRReconciliationPayload, MRReconciliationValidationError, parseMRActualCount } from '../src/lib/mr-stock-reconciliation.js'

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

test('MR exact stock quantities allow zero and large Gems while rejecting unsafe input', () => {
  assert.equal(parseMRActualCount('0'), 0)
  assert.equal(parseMRActualCount('400000000'), 400_000_000)
  assert.equal(parseMRActualCount(String(Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER)

  for (const invalid of ['', ' ', '-1', '1.5', 'NaN', 'Infinity', '1e3', String(Number.MAX_SAFE_INTEGER + 1)]) {
    assert.equal(parseMRActualCount(invalid), null, invalid)
  }
})

test('MR reconciliation validates every active row and sends only changed item identities', () => {
  const items = [
    ...APPROVED_MR_CATALOG.map(([name], index) => ({ id: `item-${index}`, name, current_quantity: 0, is_archived: false })),
    { id: 'gems', name: 'Gems (MR)', current_quantity: 0, is_archived: false },
    { id: 'cash', name: 'Cash (MR)', current_quantity: 0, is_archived: false },
  ]
  const counts = Object.fromEntries(items.map((item) => [item.id, '1']))
  counts.gems = '400000000'
  const payload = buildMRReconciliationPayload(items, counts)

  assert.equal(items.length, 75)
  assert.equal(payload.length, 75)
  assert.deepEqual(payload.find(({ item_id: itemId }) => itemId === 'gems'), {
    item_id: 'gems',
    counted_stock: 400_000_000,
  })
  assert.deepEqual(payload.find(({ item_id: itemId }) => itemId === 'cash'), {
    item_id: 'cash',
    counted_stock: 1,
  })
  assert.equal(new Set(items.map(({ id }) => id)).size, 75)
  assert.ok(payload.every((line) => !('set_family_id' in line)))

  counts['item-0'] = '0'
  assert.equal(buildMRReconciliationPayload(items, counts).length, 74)
  counts['item-1'] = ''
  assert.throws(() => buildMRReconciliationPayload(items, counts), MRReconciliationValidationError)
})

test('MR Stock UI uses the authenticated batch RPC and keeps set summaries derived', () => {
  const page = readFileSync(new URL('../src/pages/MRInventory.jsx', import.meta.url), 'utf8')
  const rarPage = readFileSync(new URL('../src/pages/Inventory.jsx', import.meta.url), 'utf8')
  const migration = readFileSync(new URL('../supabase/migrations/20260906120000_mr_reconciliation_quantity_limits.sql', import.meta.url), 'utf8')
  const rpc = readFileSync(new URL('../supabase/migrations/20260904101125_mr_phase1_backend_bot.sql', import.meta.url), 'utf8')

  assert.match(page, /rpc\('mr_reconcile_stock_batch'/)
  assert.match(page, /select\('id,current_quantity'\)/)
  assert.match(page, /await refresh\(\)/)
  assert.doesNotMatch(page, /from\('mr_items'\)\s*\.update/)
  assert.match(page, /data\.mr\.setStock\.map/)
  assert.match(page, /Furniture sets \(read-only\)/)
  assert.match(migration, /jsonb_array_length\(p_payload\) not between 1 and 100/)
  assert.match(migration, /9007199254740991/)
  assert.match(rpc, /for update of i/)
  assert.match(rpc, /'reconcile'/)
  assert.match(rpc, /grant execute on function public\.mr_reconcile_stock_batch[\s\S]+to authenticated/)
  assert.match(rpc, /security invoker/)
  assert.match(rarPage, /rpc\('rar_reconcile_stock_batch'/)
})
