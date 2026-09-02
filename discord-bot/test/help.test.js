import assert from 'node:assert/strict'
import test from 'node:test'
import { buildHelpPages, buildItemHelpPages } from '../src/help.js'

test('plain help gives a useful overview of every operation', () => {
  const [page] = buildHelpPages()
  for (const operation of ['SALES', 'PURCHASE', 'FARM', 'TRADE']) {
    assert.match(page.description, new RegExp(operation))
  }
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
