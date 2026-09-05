import assert from 'node:assert/strict'
import test from 'node:test'
import { runWeeklySalesReport } from '../src/weekly-reporter.js'
import { latestCompletedWeeklyRange, weeklyReportMarker } from '../src/weekly-finance.js'

const NOW = new Date('2026-09-12T02:00:00.000Z')
const CHANNEL_ID = '1517700441679593639'
const BOT_ID = '1517700441679593600'

test('initial startup waits for the requested first upcoming Saturday instead of backfilling', async () => {
  const delivery = createDeliveryServices()
  const discord = createDiscord()
  const result = await runWeeklySalesReport({
    channelId: CHANNEL_ID,
    client: discord.client,
    now: new Date('2026-09-05T02:00:00.000Z'),
    services: delivery.services,
    supabase: {},
  })

  assert.equal(result.status, 'not-due')
  assert.equal(delivery.claimCalls.length, 0)
  assert.equal(delivery.loadCalls.length, 0)
  assert.equal(discord.sent.length, 0)
})

test('restart after Saturday 09:30 catches up once and a later restart does not duplicate', async () => {
  const delivery = createDeliveryServices()
  const discord = createDiscord()

  const first = await runWeeklySalesReport({
    channelId: CHANNEL_ID,
    client: discord.client,
    now: NOW,
    services: delivery.services,
    supabase: {},
  })
  const restarted = await runWeeklySalesReport({
    channelId: CHANNEL_ID,
    client: discord.client,
    now: NOW,
    services: delivery.services,
    supabase: {},
  })

  assert.equal(first.status, 'sent')
  assert.equal(restarted.status, 'already-sent')
  assert.equal(discord.sent.length, 1)
  assert.equal(delivery.loadCalls.length, 2)
})

test('two scheduler fires for the same report period can send only one message', async () => {
  const delivery = createDeliveryServices({ holdFirstLoad: true })
  const discord = createDiscord()

  const first = runWeeklySalesReport({
    channelId: CHANNEL_ID,
    client: discord.client,
    now: NOW,
    services: delivery.services,
    supabase: {},
  })
  await new Promise((resolve) => setImmediate(resolve))
  const second = await runWeeklySalesReport({
    channelId: CHANNEL_ID,
    client: discord.client,
    now: NOW,
    services: delivery.services,
    supabase: {},
  })
  delivery.releaseLoad()
  const firstResult = await first

  assert.equal(firstResult.status, 'sent')
  assert.equal(second.status, 'in-progress')
  assert.equal(discord.sent.length, 1)
})

test('a crash-window retry reconciles the Discord footer marker without reposting', async () => {
  const range = latestCompletedWeeklyRange(NOW)
  const marker = weeklyReportMarker(range)
  const existing = {
    id: '1517700441679593999',
    author: { id: BOT_ID },
    createdTimestamp: Date.parse(range.endExclusive) + 1000,
    embeds: [{ footer: { text: `[start, end) • ${marker}` } }],
  }
  const delivery = createDeliveryServices()
  const discord = createDiscord({ messages: [existing] })

  const result = await runWeeklySalesReport({
    channelId: CHANNEL_ID,
    client: discord.client,
    now: NOW,
    services: delivery.services,
    supabase: {},
  })

  assert.equal(result.status, 'reconciled')
  assert.equal(result.messageId, existing.id)
  assert.equal(discord.sent.length, 0)
  assert.equal(delivery.loadCalls.length, 0)
  assert.equal(delivery.state.status, 'sent')
})

test('empty authoritative records still send one clean weekly embed', async () => {
  const delivery = createDeliveryServices({ records: { sales: [], saleItems: [] } })
  const discord = createDiscord()
  const result = await runWeeklySalesReport({
    channelId: CHANNEL_ID,
    client: discord.client,
    now: NOW,
    services: delivery.services,
    supabase: {},
  })

  assert.equal(result.status, 'sent')
  assert.equal(discord.sent.length, 1)
  assert.match(discord.sent[0].embeds[0].fields[0].value, /Sales: 0/)
  assert.equal(discord.sent[0].embeds[0].fields[2].value, 'Sales: 0\nItems sold: 0')
})

function createDeliveryServices({
  holdFirstLoad = false,
  records = {
    sales: [{ id: 'sale', currency: 'USD', net_credit: 10, platform_fee: 1, platform: 'Eldorado' }],
    saleItems: [{ sale_id: 'sale', item_id: 'item', quantity: 2, item: { name: 'Item' } }],
  },
} = {}) {
  const state = { status: null, claimToken: null, messageId: null }
  const claimCalls = []
  const loadCalls = []
  let releaseLoad
  const loadGate = holdFirstLoad ? new Promise((resolve) => { releaseLoad = resolve }) : null

  return {
    state,
    claimCalls,
    loadCalls,
    releaseLoad: releaseLoad || (() => {}),
    services: {
      async claim(_supabase, { claimToken }) {
        claimCalls.push(claimToken)
        if (state.status === 'sent') {
          return { claimed: false, deliveryStatus: 'sent', messageId: state.messageId }
        }
        if (state.status === 'pending' && state.claimToken !== claimToken) {
          return { claimed: false, deliveryStatus: 'pending', messageId: null }
        }
        state.status = 'pending'
        state.claimToken = claimToken
        return { claimed: true, deliveryStatus: 'pending', messageId: null }
      },
      async loadRecords(_supabase, range, game) {
        loadCalls.push({ range, game })
        if (loadGate) await loadGate
        return structuredClone(records)
      },
      async markSent(_supabase, { claimToken, messageId }) {
        assert.equal(claimToken, state.claimToken)
        state.status = 'sent'
        state.messageId = messageId
        return { marked: true, deliveryStatus: 'sent', messageId }
      },
    },
  }
}

function createDiscord({ messages = [] } = {}) {
  const sent = []
  const history = [...messages]
  const channel = {
    isTextBased: () => true,
    messages: {
      async fetch({ limit, before }) {
        const start = before ? history.findIndex(({ id }) => id === before) + 1 : 0
        const page = history.slice(start, start + limit)
        return new Map(page.map((message) => [message.id, message]))
      },
    },
    async send(payload) {
      sent.push(payload)
      const message = {
        id: `1517700441679593${String(sent.length).padStart(3, '0')}`,
        author: { id: BOT_ID },
        createdTimestamp: NOW.getTime(),
        embeds: payload.embeds,
      }
      history.unshift(message)
      return message
    },
  }
  return {
    sent,
    client: {
      user: { id: BOT_ID },
      channels: { async fetch(id) { return id === CHANNEL_ID ? channel : null } },
    },
  }
}
