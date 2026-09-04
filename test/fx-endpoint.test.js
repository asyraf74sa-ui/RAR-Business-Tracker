import assert from 'node:assert/strict'
import test from 'node:test'
import { createFxHandler } from '../api/fx.js'
import { fetchLatestUsdRates, frankfurterProvider } from '../src/lib/frankfurter.js'

function fakeResponse() {
  const headers = new Map()
  return {
    headers,
    setHeader(name, value) { headers.set(name.toLowerCase(), value) },
    end(body) { this.body = body },
  }
}

function payloadForEndpoint() {
  return {
    base: 'USD',
    rates: { USD: 1, MYR: 4, PHP: 60, IDR: 15_000 },
    provider: 'Frankfurter',
    rateDate: '2026-09-04',
    updatedAt: '2026-09-04T02:00:00.000Z',
    fresh: true,
    fallback: false,
  }
}

test('the provider adapter performs only a GET and returns numeric USD-base rates', async () => {
  let request
  const result = await fetchLatestUsdRates({
    now: () => new Date('2026-09-04T02:00:00.000Z'),
    fetchImpl: async (url, options) => {
      request = { url, options }
      return {
        ok: true,
        json: async () => [
          { date: '2026-09-04', base: 'USD', quote: 'IDR', rate: 17_702 },
          { date: '2026-09-04', base: 'USD', quote: 'MYR', rate: 4.0417 },
          { date: '2026-09-04', base: 'USD', quote: 'PHP', rate: 62.499 },
        ],
      }
    },
  })

  assert.equal(request.url, frankfurterProvider.url)
  assert.equal(request.options.method, 'GET')
  assert.deepEqual(result.rates, { USD: 1, IDR: 17_702, MYR: 4.0417, PHP: 62.499 })
  Object.values(result.rates).forEach((rate) => assert.equal(typeof rate, 'number'))
  assert.equal(result.base, 'USD')
})

test('the FX endpoint sends one-hour CDN caching metadata', async () => {
  const response = fakeResponse()
  const expected = payloadForEndpoint()
  const handler = createFxHandler({ loadRates: async () => expected })

  await handler({ method: 'GET' }, response)
  assert.equal(response.statusCode, 200)
  assert.equal(response.headers.get('cache-control'), 'public, max-age=300')
  assert.match(response.headers.get('vercel-cdn-cache-control'), /max-age=3600/)
  assert.deepEqual(JSON.parse(response.body), expected)
})

test('the FX endpoint fails safely and never returns invented rates', async () => {
  const response = fakeResponse()
  const errors = []
  const handler = createFxHandler({
    loadRates: async () => { throw new Error('upstream unavailable') },
    logger: { error: (...args) => errors.push(args) },
  })

  await handler({ method: 'GET' }, response)
  assert.equal(response.statusCode, 503)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.deepEqual(JSON.parse(response.body), { error: 'USD conversion is temporarily unavailable' })
  assert.equal(errors.length, 1)
})
