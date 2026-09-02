import assert from 'node:assert/strict'
import test from 'node:test'
import { buildStockReconciliationResults, formatStockReconciliationLine } from '../src/stock-results.js'

test('reconciliation calculates an upward delta from the recorded result', () => {
  const [result] = buildStockReconciliationResults([{
    item_id: 'host',
    item: { name: 'Host Station' },
    quantity_delta: 7,
    balance_after: 17,
  }])

  assert.deepEqual(result, {
    itemName: 'Host Station',
    before: 10,
    counted: 17,
    delta: 7,
  })
  assert.equal(formatStockReconciliationLine(result), 'Host Station: 10 → 17 (+7)')
})

test('reconciliation calculates a downward delta from the recorded result', () => {
  const [result] = buildStockReconciliationResults([{
    item_id: 'host',
    item: { name: 'Host Station' },
    quantity_delta: -6,
    balance_after: 4,
  }])

  assert.deepEqual(result, {
    itemName: 'Host Station',
    before: 10,
    counted: 4,
    delta: -6,
  })
  assert.equal(formatStockReconciliationLine(result), 'Host Station: 10 → 4 (-6)')
})

test('reconciliation formats zero delta as no change and sorts canonical names', () => {
  const results = buildStockReconciliationResults([
    { item_id: 'piano', item: { name: 'Piano' }, quantity_delta: 0, balance_after: 4 },
    { item_id: 'gems', item: { name: 'Gems' }, quantity_delta: -3602, balance_after: 46398 },
  ])

  assert.deepEqual(results.map(({ itemName }) => itemName), ['Gems', 'Piano'])
  assert.equal(formatStockReconciliationLine(results[1]), 'Piano: 4 → 4 (no change)')
})
