import assert from 'node:assert/strict'
import test from 'node:test'
import { createFxClient, fxCacheKey, FxUnavailableError } from '../src/lib/fx-client.js'
import { currentMonthFinancials } from '../src/lib/dashboard-finance.js'

const payload = {
  base: 'USD',
  rates: { USD: 1, MYR: 4, PHP: 60, IDR: 15_000 },
  provider: 'Frankfurter',
  rateDate: '2026-09-03',
  updatedAt: '2026-09-03T00:00:00.000Z',
}

function storageWith(value) {
  const values = new Map(value ? [[fxCacheKey, JSON.stringify(value)]] : [])
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, nextValue) => values.set(key, nextValue),
  }
}

test('uses the last successful response when an FX refresh fails', async () => {
  const storage = storageWith({ cachedAt: 0, data: payload })
  const client = createFxClient({
    storage,
    now: () => 7_200_000,
    freshnessMs: 3_600_000,
    fetchImpl: async () => { throw new Error('provider down') },
  })

  const result = await client.getRates()
  assert.equal(result.fallback, true)
  assert.equal(result.fresh, false)
  assert.deepEqual(result.rates, payload.rates)
})

test('reports unavailable when refresh fails and no cache exists', async () => {
  const client = createFxClient({
    storage: storageWith(),
    fetchImpl: async () => ({ ok: false, status: 503 }),
  })
  await assert.rejects(client.getRates(), FxUnavailableError)
})

test('keeps original currency totals usable when FX is unavailable', async () => {
  const rows = [{
    id: 'myr-sale',
    sold_at: '2026-09-10T00:00:00.000Z',
    currency: 'MYR',
    net_credit: 50_000,
    platform_fee: 500,
  }]
  const originalTotals = currentMonthFinancials(rows, [], new Date('2026-09-15T00:00:00.000Z')).netTotals
  const client = createFxClient({ fetchImpl: async () => { throw new Error('offline') } })

  await assert.rejects(client.getRates(), FxUnavailableError)
  assert.equal(originalTotals.MYR, 50_000)
})
