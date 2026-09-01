import { CURRENCIES } from './constants.js'

export function toNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function formatQuantity(value, maximumFractionDigits = 2) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(toNumber(value))
}

export function formatMoney(value, currency) {
  const amount = toNumber(value)
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: currency === 'IDR' ? 0 : 2,
    }).format(amount)
  } catch {
    return `${currency} ${formatQuantity(amount)}`
  }
}

export function formatDateTime(value, options = {}) {
  if (!value) return 'Not yet'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not yet'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: options.compact ? 'medium' : 'medium',
    timeStyle: options.dateOnly ? undefined : 'short',
  }).format(date)
}

export function localDateTimeValue(date = new Date()) {
  const offset = date.getTimezoneOffset()
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16)
}

export function groupCurrencyTotals(rows, selector) {
  const totals = Object.fromEntries(CURRENCIES.map((currency) => [currency, 0]))
  rows.forEach((row) => {
    const currency = String(row.currency || row.cash_currency || '').toUpperCase()
    if (currency in totals) totals[currency] += toNumber(selector(row))
  })
  return totals
}

export function gemRange(item, quantity = 1) {
  if (!item || item.gem_value_min == null) return 'Value not set'
  const min = toNumber(item.gem_value_min) * toNumber(quantity, 1)
  const max = toNumber(item.gem_value_max ?? item.gem_value_min) * toNumber(quantity, 1)
  return min === max ? `${formatQuantity(min)} gems` : `${formatQuantity(min)}–${formatQuantity(max)} gems`
}
