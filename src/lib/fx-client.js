const CACHE_KEY = 'rar-fx-usd-v1'
const REQUIRED_RATES = ['USD', 'MYR', 'PHP', 'IDR']
const DEFAULT_FRESHNESS_MS = 60 * 60 * 1000

export class FxUnavailableError extends Error {
  constructor(message = 'USD conversion is temporarily unavailable', options) {
    super(message, options)
    this.name = 'FxUnavailableError'
  }
}

function normalizeFxPayload(payload) {
  if (payload?.base !== 'USD') throw new FxUnavailableError('FX response did not use USD as its base')

  const rates = {}
  REQUIRED_RATES.forEach((currency) => {
    const rate = Number(payload?.rates?.[currency])
    if (!Number.isFinite(rate) || rate <= 0) throw new FxUnavailableError(`FX response omitted ${currency}`)
    rates[currency] = rate
  })

  const updatedAt = new Date(payload.updatedAt)
  if (Number.isNaN(updatedAt.getTime())) throw new FxUnavailableError('FX response omitted its update time')

  return {
    base: 'USD',
    rates,
    provider: String(payload.provider || 'FX provider'),
    rateDate: typeof payload.rateDate === 'string' ? payload.rateDate : null,
    updatedAt: updatedAt.toISOString(),
  }
}

function readStored(storage) {
  if (!storage) return null
  try {
    const parsed = JSON.parse(storage.getItem(CACHE_KEY))
    const cachedAt = Number(parsed?.cachedAt)
    if (!Number.isFinite(cachedAt)) return null
    return { cachedAt, data: normalizeFxPayload(parsed.data) }
  } catch {
    return null
  }
}

function writeStored(storage, value) {
  if (!storage) return
  try {
    storage.setItem(CACHE_KEY, JSON.stringify(value))
  } catch {
    // Storage can be unavailable or full; the in-memory cache still works.
  }
}

function browserStorage() {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function createFxClient({
  endpoint = '/api/fx',
  fetchImpl = globalThis.fetch,
  storage = null,
  now = () => Date.now(),
  freshnessMs = DEFAULT_FRESHNESS_MS,
} = {}) {
  let memory = null
  let inFlight = null

  async function refresh(cached) {
    try {
      const response = await fetchImpl(endpoint, { method: 'GET', headers: { Accept: 'application/json' } })
      if (!response.ok) throw new FxUnavailableError(`FX endpoint returned ${response.status}`)

      const data = normalizeFxPayload(await response.json())
      memory = { cachedAt: now(), data }
      writeStored(storage, memory)
      return { ...data, fresh: true, fallback: false }
    } catch (error) {
      if (cached) {
        memory = cached
        return { ...cached.data, fresh: false, fallback: true }
      }
      throw new FxUnavailableError(undefined, { cause: error })
    }
  }

  return {
    async getRates() {
      const cached = memory || readStored(storage)
      if (cached && now() - cached.cachedAt <= freshnessMs) {
        memory = cached
        return { ...cached.data, fresh: true, fallback: false }
      }

      if (!inFlight) inFlight = refresh(cached).finally(() => { inFlight = null })
      return inFlight
    },
  }
}

export const fxClient = createFxClient({ storage: browserStorage() })
export const fxCacheKey = CACHE_KEY
