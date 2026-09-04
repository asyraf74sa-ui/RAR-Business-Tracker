import { CURRENCIES } from './constants.js'

export const BUSINESS_TIME_ZONE = 'Asia/Kuala_Lumpur'

const dateTimeFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

const monthLabelFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TIME_ZONE,
  month: 'long',
  year: 'numeric',
})

function numericParts(date) {
  return Object.fromEntries(
    dateTimeFormatter
      .formatToParts(date)
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value }) => [type, Number(value)]),
  )
}

function zonedDateTimeToUtc(year, monthIndex, day = 1) {
  const target = Date.UTC(year, monthIndex, day, 0, 0, 0)
  let candidate = target

  // Resolve the zone offset from Intl rather than assuming the browser's zone
  // or hard-coding Malaysia's current UTC offset.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = numericParts(new Date(candidate))
    const representedAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    )
    const nextCandidate = target - (representedAsUtc - candidate)
    if (nextCandidate === candidate) break
    candidate = nextCandidate
  }

  return new Date(candidate)
}

function emptyCurrencyRecord() {
  return Object.fromEntries(CURRENCIES.map((currency) => [currency, 0]))
}

function finiteNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function malaysiaMonthPeriod(now = new Date()) {
  const instant = now instanceof Date ? now : new Date(now)
  if (Number.isNaN(instant.getTime())) throw new TypeError('A valid date is required')

  const { year, month } = numericParts(instant)
  const monthIndex = month - 1
  const startInclusive = zonedDateTimeToUtc(year, monthIndex)
  const endExclusive = zonedDateTimeToUtc(year, monthIndex + 1)

  return {
    key: `${year}-${String(month).padStart(2, '0')}`,
    label: monthLabelFormatter.format(instant),
    timeZone: BUSINESS_TIME_ZONE,
    startInclusive,
    endExclusive,
  }
}

export function filterSalesForPeriod(sales, period) {
  const start = period.startInclusive.getTime()
  const end = period.endExclusive.getTime()

  return sales.filter((sale) => {
    const soldAt = new Date(sale.sold_at).getTime()
    return Number.isFinite(soldAt) && soldAt >= start && soldAt < end
  })
}

export function currentMonthFinancials(sales, now = new Date()) {
  const period = malaysiaMonthPeriod(now)
  const currentSales = filterSalesForPeriod(sales, period)
  const netTotals = emptyCurrencyRecord()
  const feeTotals = emptyCurrencyRecord()
  const grossTotals = emptyCurrencyRecord()
  const saleCountByCurrency = emptyCurrencyRecord()

  currentSales.forEach((sale) => {
    const currency = String(sale.currency || '').toUpperCase()
    if (!(currency in netTotals)) return

    const netCredit = finiteNumber(sale.net_credit)
    const platformFee = finiteNumber(sale.platform_fee)
    netTotals[currency] += netCredit
    feeTotals[currency] += platformFee
    grossTotals[currency] += netCredit + platformFee
    saleCountByCurrency[currency] += 1
  })

  return {
    period,
    sales: currentSales,
    netTotals,
    feeTotals,
    grossTotals,
    saleCountByCurrency,
  }
}

export function convertCurrencyTotalsToUsd(totals, rates) {
  const usdTotal = finiteNumber(totals?.USD)
  const foreignCurrencies = CURRENCIES.filter(
    (currency) => currency !== 'USD' && finiteNumber(totals?.[currency]) !== 0,
  )

  if (foreignCurrencies.length === 0) {
    return { total: usdTotal, approximate: false, unavailableCurrencies: [] }
  }

  const unavailableCurrencies = foreignCurrencies.filter((currency) => {
    const rate = Number(rates?.[currency])
    return !Number.isFinite(rate) || rate <= 0
  })

  if (unavailableCurrencies.length > 0) {
    return { total: null, approximate: true, unavailableCurrencies }
  }

  const total = foreignCurrencies.reduce(
    (sum, currency) => sum + finiteNumber(totals[currency]) / Number(rates[currency]),
    usdTotal,
  )

  return { total, approximate: true, unavailableCurrencies: [] }
}

export function malaysiaHour(now = new Date()) {
  const instant = now instanceof Date ? now : new Date(now)
  return numericParts(instant).hour
}
