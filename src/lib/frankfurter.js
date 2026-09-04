const PROVIDER_NAME = 'Frankfurter'
const PROVIDER_URL = 'https://api.frankfurter.dev/v2/rates?base=USD&quotes=MYR,PHP,IDR'
const REQUIRED_QUOTES = ['MYR', 'PHP', 'IDR']

function validateProviderRows(payload) {
  if (!Array.isArray(payload)) throw new Error('FX provider returned an invalid response')

  const rates = { USD: 1 }
  const dates = []

  payload.forEach((row) => {
    const quote = String(row?.quote || '').toUpperCase()
    const rate = Number(row?.rate)
    if (row?.base === 'USD' && REQUIRED_QUOTES.includes(quote) && Number.isFinite(rate) && rate > 0) {
      rates[quote] = rate
      if (typeof row.date === 'string') dates.push(row.date)
    }
  })

  const missing = REQUIRED_QUOTES.filter((currency) => !(currency in rates))
  if (missing.length > 0) throw new Error(`FX provider omitted ${missing.join(', ')}`)

  return { rates, rateDate: dates.sort().at(-1) || null }
}

export async function fetchLatestUsdRates({ fetchImpl = fetch, now = () => new Date() } = {}) {
  const response = await fetchImpl(PROVIDER_URL, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })

  if (!response.ok) throw new Error(`FX provider request failed with status ${response.status}`)

  const { rates, rateDate } = validateProviderRows(await response.json())
  return {
    base: 'USD',
    rates,
    provider: PROVIDER_NAME,
    rateDate,
    updatedAt: now().toISOString(),
    fresh: true,
    fallback: false,
  }
}

export const frankfurterProvider = Object.freeze({
  name: PROVIDER_NAME,
  url: PROVIDER_URL,
})
