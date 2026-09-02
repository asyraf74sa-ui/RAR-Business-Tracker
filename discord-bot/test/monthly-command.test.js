import assert from 'node:assert/strict'
import test from 'node:test'
import { MessageFlags } from 'discord.js'
import { processMonthlyHistoryInteraction, processMonthlyInteraction } from '../src/monthly-command.js'

test('/monthly defaults to the current Malaysia month and responds ephemerally', async () => {
  const interaction = fakeInteraction()
  let receivedRange
  const result = await processMonthlyInteraction(interaction, {
    supabase: {},
    now: new Date('2026-08-31T16:30:00Z'),
    loadRecords: async (supabase, range) => {
      receivedRange = range
      return { sales: [], inventoryEvents: [] }
    },
    logger: silentLogger,
  })

  assert.equal(result, true)
  assert.deepEqual(receivedRange, {
    month: '2026-09',
    startInclusive: '2026-08-31T16:00:00.000Z',
    endExclusive: '2026-09-30T16:00:00.000Z',
  })
  assert.deepEqual(interaction.deferredWith, { flags: MessageFlags.Ephemeral })
  assert.equal(interaction.edits[0].embeds[0].title, '📊 RAR Monthly Overview')
  assert.match(interaction.edits[0].embeds[0].description, /September 2026/)
})

test('/monthly accepts a strict explicit month and rejects invalid input before querying', async () => {
  const valid = fakeInteraction('2024-02')
  let validLoads = 0
  await processMonthlyInteraction(valid, {
    supabase: {},
    loadRecords: async () => {
      validLoads += 1
      return { sales: [], inventoryEvents: [] }
    },
    logger: silentLogger,
  })
  assert.equal(validLoads, 1)
  assert.match(valid.edits[0].embeds[0].description, /February 2024/)

  const invalid = fakeInteraction('2024-2')
  let invalidLoads = 0
  assert.equal(await processMonthlyInteraction(invalid, {
    supabase: {},
    loadRecords: async () => { invalidLoads += 1 },
    logger: silentLogger,
  }), false)
  assert.equal(invalidLoads, 0)
  assert.deepEqual(invalid.edits[0], {
    content: '❌ Invalid month. Use YYYY-MM, for example 2026-09.',
    embeds: [],
  })
})

test('/months splits long private history into ephemeral follow-ups', async () => {
  const interaction = fakeInteraction()
  const sales = []
  for (let year = 2000; year <= 2026; year += 1) {
    for (let month = 0; month < 12; month += 1) {
      sales.push({
        id: `${year}-${month}`,
        sold_at: new Date(Date.UTC(year, month, 15, 4)).toISOString(),
        currency: 'USD',
        net_credit: 1,
        platform_fee: 0,
      })
    }
  }

  assert.equal(await processMonthlyHistoryInteraction(interaction, {
    supabase: {},
    loadRecords: async () => ({ sales, inventoryEvents: [] }),
    logger: silentLogger,
  }), true)
  assert.ok(interaction.followUps.length > 0)
  assert.ok(interaction.followUps.every(({ flags }) => flags === MessageFlags.Ephemeral))
})

test('/monthly handles data and Discord interaction timeouts without throwing', async () => {
  const interaction = fakeInteraction()
  assert.equal(await processMonthlyInteraction(interaction, {
    supabase: {},
    loadRecords: async () => new Promise(() => {}),
    logger: silentLogger,
    timeoutMs: 5,
  }), false)
  assert.deepEqual(interaction.edits[0], {
    content: '❌ Could not load RAR monthly report.\nPlease try again.',
    embeds: [],
  })

  const expired = fakeInteraction()
  expired.deferReply = async () => { throw new Error('Unknown interaction') }
  assert.equal(await processMonthlyInteraction(expired, {
    supabase: {},
    loadRecords: async () => ({ sales: [], inventoryEvents: [] }),
    logger: silentLogger,
  }), false)
  assert.equal(expired.edits.length, 0)
})

function fakeInteraction(month = null) {
  return {
    deferredWith: null,
    edits: [],
    followUps: [],
    options: { getString: () => month },
    async deferReply(options) { this.deferredWith = options },
    async editReply(options) { this.edits.push(options) },
    async followUp(options) { this.followUps.push(options) },
  }
}

const silentLogger = { error() {} }
