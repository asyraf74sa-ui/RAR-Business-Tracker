import assert from 'node:assert/strict'
import test from 'node:test'
import { MessageFlags } from 'discord.js'
import { processStockAutocompleteInteraction, processStockInteraction } from '../src/stock-command.js'

const rows = [
  { id: 'gems', name: 'Gems', stock: 46398, kind: 'currency', active: true },
  { id: 'piano', name: 'Piano', stock: 4, kind: 'item', active: true },
]

test('/stock uses only the authenticated rar_items SELECT path and performs no mutation RPC', async () => {
  const calls = []
  const query = {
    select(columns) {
      calls.push(['select', columns])
      return this
    },
    eq(column, value) {
      calls.push(['eq', column, value])
      return this
    },
    order(column) {
      calls.push(['order', column])
      return Promise.resolve({ data: rows, error: null })
    },
  }
  const supabase = {
    from(table) {
      calls.push(['from', table])
      return query
    },
    rpc() {
      calls.push(['rpc'])
      throw new Error('A read-only command must never call rpc().')
    },
  }
  const interaction = fakeInteraction()

  assert.equal(await processStockInteraction(interaction, { supabase, logger: silentLogger }), true)
  assert.deepEqual(calls, [
    ['from', 'rar_items'],
    ['select', 'id,name,stock,kind,active'],
    ['eq', 'active', true],
    ['order', 'name'],
  ])
  assert.deepEqual(interaction.deferredWith, { flags: MessageFlags.Ephemeral })
  assert.match(interaction.edits[0].embeds[0].description, /Gems — 46,398/)
})

test('/stock item:Piano returns only Piano and an unknown item is rejected safely', async () => {
  const pianoInteraction = fakeInteraction('Piano')
  await processStockInteraction(pianoInteraction, {
    supabase: {},
    loadItems: async () => rows,
    logger: silentLogger,
  })
  assert.equal(pianoInteraction.edits[0].embeds[0].title, '📦 Piano')
  assert.equal(pianoInteraction.edits[0].embeds[0].description, 'Current stock: 4')
  assert.doesNotMatch(JSON.stringify(pianoInteraction.edits[0]), /Gems/)

  const unknownInteraction = fakeInteraction('Pian')
  await processStockInteraction(unknownInteraction, {
    supabase: {},
    loadItems: async () => rows,
    logger: silentLogger,
  })
  assert.deepEqual(unknownInteraction.edits[0], { content: '❌ Item not found.', embeds: [] })
})

test('/stock refreshes live data for every command and autocomplete invocation', async () => {
  let loads = 0
  const loadItems = async () => {
    loads += 1
    return rows
  }

  await processStockInteraction(fakeInteraction(), { supabase: {}, loadItems, logger: silentLogger })
  await processStockInteraction(fakeInteraction(), { supabase: {}, loadItems, logger: silentLogger })

  const autocomplete = fakeAutocomplete('pi')
  await processStockAutocompleteInteraction(autocomplete, {
    supabase: {},
    loadItems,
    logger: silentLogger,
  })
  assert.equal(loads, 3)
  assert.deepEqual(autocomplete.responses[0], [{ name: 'Piano', value: 'Piano' }])
})

test('/stock defaults to RAR while game:MR loads and displays MR only', async () => {
  const mrRows = [{ id: 'chair', name: 'Test Chair', stock: 22, kind: 'item', active: true }]
  const interaction = fakeInteraction(null, 'MR')
  let receivedGame
  await processStockInteraction(interaction, {
    supabase: {},
    loadItems: async (supabase, game) => {
      receivedGame = game
      return mrRows
    },
    loadSetSummaries: async () => [{
      name: 'Test Family', tables: 5, chairs: 22, completed_sets: 5, excess_tables: 0, excess_chairs: 2,
    }],
    logger: silentLogger,
  })
  assert.equal(receivedGame, 'MR')
  assert.equal(interaction.edits[0].embeds[0].title, '📦 MR Stock Overview')
  assert.match(interaction.edits[0].embeds[0].description, /Test Chair — 22/)
  assert.match(interaction.edits[0].embeds[0].description, /Completed Sets 5/)
  assert.doesNotMatch(interaction.edits[0].embeds[0].description, /Gems|Piano/)
})

test('/stock handles Supabase and Discord timeout failures without throwing', async () => {
  const interaction = fakeInteraction()
  const result = await processStockInteraction(interaction, {
    supabase: {},
    loadItems: async () => new Promise(() => {}),
    logger: silentLogger,
    timeoutMs: 5,
  })
  assert.equal(result, false)
  assert.deepEqual(interaction.edits[0], {
    content: '❌ Could not load RAR stock.\nPlease try again.',
    embeds: [],
  })

  const timedOut = fakeInteraction()
  timedOut.deferReply = async () => { throw new Error('Unknown interaction') }
  assert.equal(await processStockInteraction(timedOut, {
    supabase: {},
    loadItems: async () => rows,
    logger: silentLogger,
  }), false)
  assert.equal(timedOut.edits.length, 0)
})

function fakeInteraction(item = null, game = null) {
  return {
    deferredWith: null,
    edits: [],
    followUps: [],
    options: { getString: (name) => name === 'game' ? game : item },
    async deferReply(options) { this.deferredWith = options },
    async editReply(options) { this.edits.push(options) },
    async followUp(options) { this.followUps.push(options) },
  }
}

function fakeAutocomplete(focused, game = null) {
  return {
    responded: false,
    responses: [],
    options: { getFocused: () => focused, getString: (name) => name === 'game' ? game : null },
    async respond(choices) {
      this.responded = true
      this.responses.push(choices)
    },
  }
}

const silentLogger = { error() {} }
