import assert from 'node:assert/strict'
import test from 'node:test'
import { buildHelpPages, buildItemHelpPages, HELP_TOPICS } from '../src/help.js'

test('/help exposes add, read-only stock overview, and stock reconciliation topic choices', () => {
  const values = HELP_TOPICS.map(({ value }) => value)
  assert.ok(values.includes('add'))
  assert.ok(values.includes('stockoverview'))
  assert.ok(values.includes('stock'))
})

test('plain help gives a useful overview of every operation', () => {
  const [page] = buildHelpPages()
  for (const operation of ['SALES', 'PURCHASE', 'FARM', 'TRADE', 'ADD STOCK', 'STOCK OVERVIEW', 'STOCKTAKE / RECONCILE']) {
    assert.match(page.description, new RegExp(operation))
  }
  assert.match(page.description, /`\/stock` \*\*reads\*\* inventory only/i)
  assert.match(page.description, /`RAR STOCK - \.\.\.` \*\*sets\/reconciles\*\*/i)
})

test('/help add explains that ADD increases rather than sets stock', () => {
  const [page] = buildHelpPages('add')
  assert.equal(page.title, 'RAR Bot Help — add')
  assert.match(page.description, /Manual stock addition/)
  assert.match(page.description, /increase/i)
  assert.match(page.description, /RAR ADD - 5 HOST STATION, 3 GREENHOUSE/)
  assert.match(page.description, /does not record cash cost/i)
})

test('/help stock explains that STOCK sets an exact count rather than adding it', () => {
  const [page] = buildHelpPages('stock')
  assert.equal(page.title, 'RAR Bot Help — stock')
  assert.match(page.description, /Stock reconciliation \/ physical count/)
  assert.match(page.description, /set/i)
  assert.match(page.description, /46,398 GEMS/)
  assert.match(page.description, /does \*\*not\*\* add 17/i)
})

test('/help stockoverview explains that /stock views live inventory without modifying it', () => {
  const [page] = buildHelpPages('stockoverview')
  assert.equal(page.title, 'RAR Bot Help — stockoverview')
  assert.match(page.description, /Shows live inventory/)
  assert.match(page.description, /\/stock item:Piano/)
  assert.match(page.description, /only \*\*reads\*\* inventory/i)
  assert.match(page.description, /RAR STOCK - <count> <item>/)
})

test('live item help sorts every exact name and stays within Discord embed limits', () => {
  const itemNames = Array.from(
    { length: 700 },
    (_, index) => `Canonical Item ${String(700 - index).padStart(4, '0')} with exact catalog spelling`,
  )
  itemNames.push('Gems', 'Dinosaur Fossil')

  const pages = buildItemHelpPages(itemNames)
  assert.ok(pages.length > 1)
  for (const page of pages) {
    assert.ok(page.title.length <= 256)
    assert.ok(page.description.length <= 4096)
    assert.ok(page.description.length <= 3900)
  }

  const displayedNames = pages
    .flatMap((page) => page.description.split('\n'))
    .map((line) => line.replace(/^• /, ''))
  const expectedNames = [...itemNames].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  assert.deepEqual(displayedNames, expectedNames)
})
