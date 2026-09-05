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

function malaysiaMonthCoordinates(value) {
  const instant = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(instant.getTime())) return null
  const { year, month } = numericParts(instant)
  return { year, monthIndex: month - 1 }
}

function monthPeriod(year, monthIndex) {
  const startInclusive = zonedDateTimeToUtc(year, monthIndex)
  const endExclusive = zonedDateTimeToUtc(year, monthIndex + 1)
  const labelInstant = new Date((startInclusive.getTime() + endExclusive.getTime()) / 2)
  const normalized = numericParts(labelInstant)

  return {
    key: `${normalized.year}-${String(normalized.month).padStart(2, '0')}`,
    label: monthLabelFormatter.format(labelInstant),
    timeZone: BUSINESS_TIME_ZONE,
    startInclusive,
    endExclusive,
  }
}

function emptyPeriodFinancials(period) {
  return {
    period,
    sales: [],
    purchaseEvents: [],
    netTotals: emptyCurrencyRecord(),
    acquisitionTotals: emptyCurrencyRecord(),
    profitTotals: emptyCurrencyRecord(),
    feeTotals: emptyCurrencyRecord(),
    grossTotals: emptyCurrencyRecord(),
    saleCountByCurrency: emptyCurrencyRecord(),
    purchaseCountByCurrency: emptyCurrencyRecord(),
  }
}

function addSale(financials, sale) {
  const currency = String(sale.currency || '').toUpperCase()
  if (!(currency in financials.netTotals)) return

  const netCredit = finiteNumber(sale.net_credit)
  const platformFee = finiteNumber(sale.platform_fee)
  financials.sales.push(sale)
  financials.netTotals[currency] += netCredit
  financials.feeTotals[currency] += platformFee
  financials.grossTotals[currency] += netCredit + platformFee
  financials.saleCountByCurrency[currency] += 1
}

function addAcquisition(financials, event) {
  if (event.event_type !== 'supplier_purchase' || event.cash_amount === null || event.cash_amount === undefined) return

  const currency = String(event.cash_currency || '').toUpperCase()
  if (!(currency in financials.acquisitionTotals)) return

  financials.purchaseEvents.push(event)
  financials.acquisitionTotals[currency] += finiteNumber(event.cash_amount)
  financials.purchaseCountByCurrency[currency] += 1
}

function finalizeFinancials(financials) {
  CURRENCIES.forEach((currency) => {
    financials.profitTotals[currency] = financials.netTotals[currency] - financials.acquisitionTotals[currency]
  })
  return financials
}

function addCurrencyTotals(target, source) {
  CURRENCIES.forEach((currency) => {
    target[currency] += finiteNumber(source?.[currency])
  })
  return target
}

export function malaysiaMonthPeriod(now = new Date()) {
  const coordinates = malaysiaMonthCoordinates(now)
  if (!coordinates) throw new TypeError('A valid date is required')
  return monthPeriod(coordinates.year, coordinates.monthIndex)
}

export function shiftMalaysiaMonth(now = new Date(), offset = 0) {
  const coordinates = malaysiaMonthCoordinates(now)
  if (!coordinates) throw new TypeError('A valid date is required')
  return monthPeriod(coordinates.year, coordinates.monthIndex + Number(offset || 0))
}

export function filterSalesForPeriod(sales, period) {
  const start = period.startInclusive.getTime()
  const end = period.endExclusive.getTime()

  return sales.filter((sale) => {
    const soldAt = new Date(sale.sold_at).getTime()
    return Number.isFinite(soldAt) && soldAt >= start && soldAt < end
  })
}

export function filterInventoryEventsForPeriod(inventoryEvents, period) {
  const start = period.startInclusive.getTime()
  const end = period.endExclusive.getTime()

  return inventoryEvents.filter((event) => {
    const eventAt = new Date(event.event_at).getTime()
    return Number.isFinite(eventAt) && eventAt >= start && eventAt < end
  })
}

export function currentMonthFinancials(sales, inventoryEvents = [], now = new Date()) {
  const period = malaysiaMonthPeriod(now)
  const currentSales = filterSalesForPeriod(sales, period)
  const currentInventoryEvents = filterInventoryEventsForPeriod(inventoryEvents, period)
  const financials = emptyPeriodFinancials(period)
  currentSales.forEach((sale) => addSale(financials, sale))
  currentInventoryEvents.forEach((event) => addAcquisition(financials, event))
  return finalizeFinancials(financials)
}

export function monthlyFinancialHistory(sales, inventoryEvents = [], now = new Date()) {
  const currentPeriod = malaysiaMonthPeriod(now)
  const grouped = new Map()
  let earliestKey = currentPeriod.key

  sales.forEach((sale) => {
    const coordinates = malaysiaMonthCoordinates(sale.sold_at)
    const currency = String(sale.currency || '').toUpperCase()
    if (!coordinates || !CURRENCIES.includes(currency)) return

    const period = monthPeriod(coordinates.year, coordinates.monthIndex)
    if (period.key > currentPeriod.key) return
    if (period.key < earliestKey) earliestKey = period.key

    const financials = grouped.get(period.key) || emptyPeriodFinancials(period)
    addSale(financials, sale)
    grouped.set(period.key, financials)
  })

  inventoryEvents.forEach((event) => {
    const coordinates = malaysiaMonthCoordinates(event.event_at)
    const currency = String(event.cash_currency || '').toUpperCase()
    if (event.event_type !== 'supplier_purchase'
      || event.cash_amount === null
      || event.cash_amount === undefined
      || !coordinates
      || !CURRENCIES.includes(currency)) return

    const period = monthPeriod(coordinates.year, coordinates.monthIndex)
    if (period.key > currentPeriod.key) return
    if (period.key < earliestKey) earliestKey = period.key

    const financials = grouped.get(period.key) || emptyPeriodFinancials(period)
    addAcquisition(financials, event)
    grouped.set(period.key, financials)
  })

  const months = []
  let offset = 0
  while (true) {
    const period = shiftMalaysiaMonth(now, offset)
    months.push(finalizeFinancials(grouped.get(period.key) || emptyPeriodFinancials(period)))
    if (period.key === earliestKey) break
    offset -= 1
  }

  return months
}

export function compareUsdTotals(currentTotal, previousTotal) {
  if (!Number.isFinite(currentTotal) || !Number.isFinite(previousTotal)) {
    return { amount: null, percent: null, status: 'unavailable' }
  }

  const amount = currentTotal - previousTotal
  if (previousTotal === 0) {
    return {
      amount,
      percent: null,
      status: currentTotal === 0 ? 'no-activity' : 'no-baseline',
    }
  }

  return {
    amount,
    percent: (amount / Math.abs(previousTotal)) * 100,
    status: 'comparable',
  }
}

export function walletFinancialOverview(sales, inventoryEvents, rates, now = new Date()) {
  const months = monthlyFinancialHistory(sales, inventoryEvents, now)
  const current = months[0]
  const previousPeriod = shiftMalaysiaMonth(now, -1)
  const previous = months.find(({ period }) => period.key === previousPeriod.key)
    || finalizeFinancials(emptyPeriodFinancials(previousPeriod))
  const lifetimeNetTotals = months.reduce(
    (totals, month) => addCurrencyTotals(totals, month.netTotals),
    emptyCurrencyRecord(),
  )
  const lifetimeAcquisitionTotals = months.reduce(
    (totals, month) => addCurrencyTotals(totals, month.acquisitionTotals),
    emptyCurrencyRecord(),
  )
  const lifetimeFeeTotals = months.reduce(
    (totals, month) => addCurrencyTotals(totals, month.feeTotals),
    emptyCurrencyRecord(),
  )
  const lifetimeProfitTotals = Object.fromEntries(CURRENCIES.map((currency) => [
    currency,
    lifetimeNetTotals[currency] - lifetimeAcquisitionTotals[currency],
  ]))

  const currentUsd = convertCurrencyTotalsToUsd(current.netTotals, rates)
  const previousUsd = convertCurrencyTotalsToUsd(previous.netTotals, rates)
  const lifetimeUsd = convertCurrencyTotalsToUsd(lifetimeNetTotals, rates)

  const withConversions = (financials) => ({
    ...financials,
    usd: convertCurrencyTotalsToUsd(financials.netTotals, rates),
    acquisitionUsd: convertCurrencyTotalsToUsd(financials.acquisitionTotals, rates),
    profitUsd: convertCurrencyTotalsToUsd(financials.profitTotals, rates),
    feeUsd: convertCurrencyTotalsToUsd(financials.feeTotals, rates),
  })

  return {
    current: withConversions(current),
    previous: withConversions(previous),
    lifetime: {
      netTotals: lifetimeNetTotals,
      acquisitionTotals: lifetimeAcquisitionTotals,
      profitTotals: lifetimeProfitTotals,
      feeTotals: lifetimeFeeTotals,
      usd: lifetimeUsd,
      acquisitionUsd: convertCurrencyTotalsToUsd(lifetimeAcquisitionTotals, rates),
      profitUsd: convertCurrencyTotalsToUsd(lifetimeProfitTotals, rates),
      feeUsd: convertCurrencyTotalsToUsd(lifetimeFeeTotals, rates),
    },
    comparison: compareUsdTotals(currentUsd.total, previousUsd.total),
    months: months.map(withConversions),
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
