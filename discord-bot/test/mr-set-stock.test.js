import assert from 'node:assert/strict'
import test from 'node:test'
import { deriveMRSetStock, deriveMRSetStockSummaries } from '../src/mr-set-stock.js'

const family = {
  id: 'royal',
  name: 'Test Family',
  table_item_id: 'table',
  chair_item_id: 'chair',
  chairs_per_set: 4,
  active: true,
}

test('1 table plus 4 chairs derives exactly 1 completed set', () => {
  const result = deriveMRSetStock(family, new Map([
    ['table', { current_quantity: 1 }],
    ['chair', { current_quantity: 4 }],
  ]))
  assert.equal(result.completedSets, 1)
  assert.equal(result.excessTables, 0)
  assert.equal(result.excessChairs, 0)
})

test('completed sets and excess table/chair counts use generic metadata', () => {
  const result = deriveMRSetStock(family, new Map([
    ['table', { current_quantity: 7 }],
    ['chair', { current_quantity: 22 }],
  ]))
  assert.deepEqual(result, {
    name: 'Test Family',
    tables: 7,
    chairs: 22,
    chairsPerSet: 4,
    completedSets: 5,
    excessTables: 2,
    excessChairs: 2,
  })
})

test('set summaries sort families without hardcoding any family name', () => {
  const items = [
    { id: 'table', current_quantity: 1 },
    { id: 'chair', current_quantity: 4 },
  ]
  const names = deriveMRSetStockSummaries(items, [
    { ...family, id: 'z', name: 'Z Test' },
    { ...family, id: 'a', name: 'A Test' },
  ]).map(({ name }) => name)
  assert.deepEqual(names, ['A Test', 'Z Test'])
})
