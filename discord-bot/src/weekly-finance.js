import { addDecimalAmounts, FINANCIAL_CURRENCIES } from './monthly-finance.js'

export const WEEKLY_REPORT_TYPE = 'weekly_sales'
export const WEEKLY_REPORT_TIME_ZONE = 'Asia/Kuala_Lumpur'
// The feature was introduced after the 5 September boundary, so its first
// scheduled report is the completed 5–12 September week.
export const WEEKLY_FIRST_REPORT_END = '2026-09-12T01:30:00.000Z'

const EMBED_COLOR = 0x2f7d4a
const SATURDAY = 6
const REPORT_HOUR = 9
const REPORT_MINUTE = 30

export function latestCompletedWeeklyRange(now = new Date()) {
  const date = validDate(now)
  const local = zonedParts(date, WEEKLY_REPORT_TIME_ZONE)
  const localDay = new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay()
  let daysSinceSaturday = (localDay - SATURDAY + 7) % 7
  const beforeTodayBoundary = local.hour < REPORT_HOUR
    || (local.hour === REPORT_HOUR && local.minute < REPORT_MINUTE)
  if (daysSinceSaturday === 0 && beforeTodayBoundary) daysSinceSaturday = 7

  const endLocalDate = new Date(Date.UTC(local.year, local.month - 1, local.day - daysSinceSaturday))
  const startLocalDate = new Date(endLocalDate.getTime() - 7 * 24 * 60 * 60 * 1000)
  const endExclusive = zonedDateTimeIso({
    year: endLocalDate.getUTCFullYear(),
    month: endLocalDate.getUTCMonth() + 1,
    day: endLocalDate.getUTCDate(),
    hour: REPORT_HOUR,
    minute: REPORT_MINUTE,
  }, WEEKLY_REPORT_TIME_ZONE)
  const startInclusive = zonedDateTimeIso({
    year: startLocalDate.getUTCFullYear(),
    month: startLocalDate.getUTCMonth() + 1,
    day: startLocalDate.getUTCDate(),
    hour: REPORT_HOUR,
    minute: REPORT_MINUTE,
  }, WEEKLY_REPORT_TIME_ZONE)

  return { startInclusive, endExclusive }
}

export function nextWeeklyBoundary(now = new Date()) {
  const completed = latestCompletedWeeklyRange(now)
  const completedLocal = zonedParts(new Date(completed.endExclusive), WEEKLY_REPORT_TIME_ZONE)
  const nextDate = new Date(Date.UTC(completedLocal.year, completedLocal.month - 1, completedLocal.day + 7))
  return zonedDateTimeIso({
    year: nextDate.getUTCFullYear(),
    month: nextDate.getUTCMonth() + 1,
    day: nextDate.getUTCDate(),
    hour: REPORT_HOUR,
    minute: REPORT_MINUTE,
  }, WEEKLY_REPORT_TIME_ZONE)
}

export function aggregateWeeklySales({ sales = [], saleItems = [] }) {
  const currencies = Object.fromEntries(FINANCIAL_CURRENCIES.map((currency) => [currency, {
    netCredit: '0',
    platformFees: '0',
  }]))
  const platforms = new Map()
  const items = new Map()
  let itemQuantity = '0'

  for (const sale of sales) {
    const currency = String(sale.currency || '').trim().toUpperCase()
    if (!currencies[currency]) continue
    currencies[currency].netCredit = addDecimalAmounts(currencies[currency].netCredit, sale.net_credit)
    currencies[currency].platformFees = addDecimalAmounts(currencies[currency].platformFees, sale.platform_fee)
    const platform = String(sale.platform || '').trim() || 'Unknown'
    platforms.set(platform, (platforms.get(platform) || 0) + 1)
  }

  for (const line of saleItems) {
    const quantity = addDecimalAmounts('0', line.quantity)
    itemQuantity = addDecimalAmounts(itemQuantity, quantity)
    const name = nestedItemName(line.item) || String(line.item_id || 'Unknown item')
    items.set(name, addDecimalAmounts(items.get(name) || '0', quantity))
  }

  return {
    salesCount: sales.length,
    itemQuantity,
    currencies,
    topItems: sortTotals(items).slice(0, 5),
    platforms: sortCounts(platforms),
  }
}

export function weeklyReportMarker({ startInclusive, endExclusive }) {
  return `weekly-sales:${startInclusive}/${endExclusive}`
}

export function buildWeeklySalesEmbed({ range, rar, mr }) {
  return {
    title: '📊 WEEKLY SALES OVERVIEW',
    description: weeklyRangeLabel(range),
    color: EMBED_COLOR,
    fields: [
      { name: 'RAR', value: businessSection(rar), inline: false },
      { name: 'MR', value: businessSection(mr), inline: false },
      {
        name: 'ALL BUSINESS',
        value: [
          `Sales: ${rar.salesCount + mr.salesCount}`,
          `Items sold: ${formatDecimal(addDecimalAmounts(rar.itemQuantity, mr.itemQuantity))}`,
        ].join('\n'),
        inline: false,
      },
    ],
    footer: {
      text: `[start, end) • ${weeklyReportMarker(range)}`,
    },
    timestamp: range.endExclusive,
  }
}

export function weeklyRangeLabel({ startInclusive, endExclusive }) {
  const start = localDateParts(startInclusive)
  const end = localDateParts(endExclusive)
  const startLabel = start.year === end.year
    ? `${start.day} ${start.month}`
    : `${start.day} ${start.month} ${start.year}`
  return `${startLabel} – ${end.day} ${end.month} ${end.year} · Saturday 09:30 MYT boundaries`
}

function businessSection(report) {
  return [
    `Sales: ${report.salesCount}`,
    `Items sold: ${formatDecimal(report.itemQuantity)}`,
    '**Net Credit**',
    ...currencyLines(report.currencies, 'netCredit'),
    '**Platform Fees**',
    ...currencyLines(report.currencies, 'platformFees'),
    '**Top items**',
    ...(report.topItems.length > 0
      ? report.topItems.map(({ name, total }) => `• ${name} × ${formatDecimal(total)}`)
      : ['• None']),
    '**Platforms**',
    ...(report.platforms.length > 0
      ? report.platforms.map(({ name, count }) => `• ${name} ${count}`)
      : ['• None']),
  ].join('\n')
}

function currencyLines(currencies, field) {
  const active = FINANCIAL_CURRENCIES.filter((currency) => currencies[currency]?.[field] !== '0')
  if (active.length === 0) return ['• None']
  return active.map((currency) => (
    `• ${currency} ${formatDecimal(currencies[currency][field], currency === 'IDR' ? 0 : 2)}`
  ))
}

function sortTotals(totals) {
  return [...totals.entries()]
    .map(([name, total]) => ({ name, total }))
    .sort((left, right) => Number(right.total) - Number(left.total)
      || left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }))
}

function sortCounts(counts) {
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count
      || left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }))
}

function formatDecimal(value, minimumFractionDigits = 0) {
  const text = addDecimalAmounts('0', value)
  const [integer, fraction = ''] = text.split('.')
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const paddedFraction = fraction.padEnd(minimumFractionDigits, '0')
  return paddedFraction ? `${grouped}.${paddedFraction}` : grouped
}

function nestedItemName(item) {
  if (Array.isArray(item)) return item[0]?.name || null
  return item?.name || null
}

function localDateParts(value) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: WEEKLY_REPORT_TIME_ZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).formatToParts(validDate(value))
  return Object.fromEntries(parts.filter(({ type }) => type !== 'literal').map(({ type, value: part }) => [type, part]))
}

function zonedParts(value, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(validDate(value))
  const values = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]))
  return Object.fromEntries(['year', 'month', 'day', 'hour', 'minute', 'second'].map((key) => [key, Number(values[key])]))
}

function zonedDateTimeIso(target, timeZone) {
  const targetAsUtc = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute, 0)
  let candidate = targetAsUtc
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const represented = zonedParts(new Date(candidate), timeZone)
    const representedAsUtc = Date.UTC(
      represented.year,
      represented.month - 1,
      represented.day,
      represented.hour,
      represented.minute,
      represented.second,
    )
    const correction = targetAsUtc - representedAsUtc
    candidate += correction
    if (correction === 0) break
  }
  return new Date(candidate).toISOString()
}

function validDate(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) throw new TypeError(`Invalid weekly report timestamp: ${String(value)}`)
  return date
}
