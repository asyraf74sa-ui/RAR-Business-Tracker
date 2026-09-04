import { CURRENCIES } from './constants.js'
import { convertCurrencyTotalsToUsd, walletFinancialOverview } from './dashboard-finance.js'
import { toNumber } from './format.js'

export const WORKSPACES = [
  { id: 'all', label: 'All Business', shortLabel: 'All', description: 'Financial overview across both games' },
  { id: 'rar', label: 'RAR', shortLabel: 'RAR', description: 'Run a Restaurant operations' },
  { id: 'mr', label: 'MR', shortLabel: 'MR', description: 'My Restaurant operations' },
]

export const WORKSPACE_NAVIGATION = {
  all: [
    { id: 'dashboard', label: 'Overview', mobileLabel: 'Overview' },
    { id: 'history', label: 'Financial history', mobileLabel: 'History' },
  ],
  rar: [
    { id: 'dashboard', label: 'Dashboard', mobileLabel: 'Home' },
    { id: 'inventory', label: 'Stock', mobileLabel: 'Stock' },
    { id: 'sale', label: 'Sale', mobileLabel: 'Sale' },
    { id: 'gems', label: 'Gems' },
    { id: 'purchases', label: 'Purchases' },
    { id: 'farming', label: 'Farm' },
    { id: 'history', label: 'History', mobileLabel: 'History' },
    { id: 'settings', label: 'Prices / Setup' },
  ],
  mr: [
    { id: 'dashboard', label: 'Dashboard', mobileLabel: 'Home' },
    { id: 'inventory', label: 'Stock', mobileLabel: 'Stock' },
    { id: 'sale', label: 'Sale', mobileLabel: 'Sale' },
    { id: 'operations', label: 'Purchases / Trades', mobileLabel: 'Operations' },
    { id: 'history', label: 'History', mobileLabel: 'History' },
    { id: 'settings', label: 'Prices / Setup' },
  ],
}
function tagSales(sales, game) {
  return (sales || []).map((sale) => ({ ...sale, game }))
}

function monthByKey(overview, key) {
  return overview.months.find((month) => month.period.key === key)
}

export function buildUnifiedFinancialOverview(rarSales, mrSales, rates, now = new Date()) {
  const taggedRar = tagSales(rarSales, 'RAR')
  const taggedMr = tagSales(mrSales, 'MR')
  const combined = walletFinancialOverview([...taggedRar, ...taggedMr], rates, now)
  const rar = walletFinancialOverview(taggedRar, rates, now)
  const mr = walletFinancialOverview(taggedMr, rates, now)

  return {
    ...combined,
    games: { RAR: rar, MR: mr },
    months: combined.months.map((month) => {
      const rarMonth = monthByKey(rar, month.period.key)
      const mrMonth = monthByKey(mr, month.period.key)
      return {
        ...month,
        contributions: {
          RAR: rarMonth?.usd || convertCurrencyTotalsToUsd({}, rates),
          MR: mrMonth?.usd || convertCurrencyTotalsToUsd({}, rates),
        },
      }
    }),
  }
}

export function platformPerformance(sales, currency) {
  const filtered = (sales || []).filter((sale) => !currency || String(sale.currency).toUpperCase() === currency)
  const grouped = new Map()
  for (const sale of filtered) {
    const key = sale.platform || 'Unknown'
    const entry = grouped.get(key) || { platform: key, net: 0, fees: 0, orders: 0, games: new Set() }
    entry.net += toNumber(sale.net_credit)
    entry.fees += toNumber(sale.platform_fee)
    entry.orders += 1
    if (sale.game) entry.games.add(sale.game)
    grouped.set(key, entry)
  }
  return [...grouped.values()]
    .map((entry) => ({ ...entry, games: [...entry.games].sort() }))
    .sort((left, right) => right.net - left.net || right.orders - left.orders || left.platform.localeCompare(right.platform))
}

export function originalCurrencyTotals(sales) {
  const totals = Object.fromEntries(CURRENCIES.map((currency) => [currency, 0]))
  for (const sale of sales || []) {
    const currency = String(sale.currency || '').toUpperCase()
    if (currency in totals) totals[currency] += toNumber(sale.net_credit)
  }
  return totals
}

export function salesForWorkspace(data, workspace) {
  if (workspace === 'rar') return tagSales(data.sales, 'RAR')
  if (workspace === 'mr') return tagSales(data.mr?.sales, 'MR')
  return [...tagSales(data.sales, 'RAR'), ...tagSales(data.mr?.sales, 'MR')]
}

export function filterRowsByDate(rows, dateField, from, to) {
  const start = from ? new Date(`${from}T00:00:00`).getTime() : Number.NEGATIVE_INFINITY
  const end = to ? new Date(`${to}T23:59:59.999`).getTime() : Number.POSITIVE_INFINITY
  return (rows || []).filter((row) => {
    const value = new Date(row[dateField]).getTime()
    return Number.isFinite(value) && value >= start && value <= end
  })
}
