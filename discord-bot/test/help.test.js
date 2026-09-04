import assert from 'node:assert/strict'
import test from 'node:test'
import { buildHelpPages, buildItemHelpPages, HELP_TOPICS } from '../src/help.js'

test('/help exposes add, read-only stock overview, and stock reconciliation topic choices', () => {
  const values = HELP_TOPICS.map(({ value }) => value)
  assert.ok(values.includes('add'))
  assert.ok(values.includes('stockoverview'))
  assert.ok(values.includes('monthly'))
  assert.ok(values.includes('stock'))
})

test('plain help explains shared sales, isolated operations, platforms, and game selectors', () => {
  const [page] = buildHelpPages()
  for (const text of ['SHARED SALES', 'RAR ACQUISITIONS', 'MR OPERATIONS', 'FARM', 'STOCK OVERVIEW', 'MONTHLY FINANCIAL']) {
    assert.match(page.description, new RegExp(text))
  }
  assert.match(page.description, /PayPal, TNG/)
  assert.match(page.description, /RAR - \.\.\.` or `MR - \.\.\./)
  assert.match(page.description, /\/stock game:MR/)
  assert.match(page.description, /\/monthly game:MR/)
  assert.match(page.description, /`\/stock` \*\*reads\*\* inventory only/i)
  assert.match(page.description, /MR STOCK - \.\.\.` \*\*set\/reconcile\*\*/i)
})

test('/help monthly explains the formula without deducting platform tax twice', () => {
  const [page] = buildHelpPages('monthly')
  assert.equal(page.title, 'RAR + MR Bot Help — monthly')
  assert.match(page.description, /\/monthly game:MR month:2026-09/)
  assert.match(page.description, /`\/months game:RAR`/)
  assert.match(page.description, /Net Profit = Actual Wallet Credit − Item Purchase Spending/)
  assert.match(page.description, /not subtracted again/i)
  assert.match(page.description, /Net Profit: \$70\.00 — not \$55\.00/)
  assert.match(page.description, /never converted or combined/i)
})

test('/help add explains that ADD increases rather than sets stock', () => {
  const [page] = buildHelpPages('add')
  assert.equal(page.title, 'RAR + MR Bot Help — add')
  assert.match(page.description, /Manual stock addition/)
  assert.match(page.description, /increase/i)
  assert.match(page.description, /RAR ADD - 5 HOST STATION, 3 GREENHOUSE/)
  assert.match(page.description, /does not record cash cost/i)
})

test('/help stock explains that STOCK sets an exact count rather than adding it', () => {
  const [page] = buildHelpPages('stock')
  assert.equal(page.title, 'RAR + MR Bot Help — stock')
  assert.match(page.description, /Stock reconciliation \/ physical count/)
  assert.match(page.description, /set/i)
  assert.match(page.description, /46,398 GEMS/)
  assert.match(page.description, /does \*\*not\*\* add 17/i)
})

test('/help stockoverview explains that /stock views live inventory without modifying it', () => {
  const [page] = buildHelpPages('stockoverview')
  assert.equal(page.title, 'RAR + MR Bot Help — stockoverview')
  assert.match(page.description, /Shows live inventory/)
  assert.match(page.description, /\/stock game:RAR item:Piano/)
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
