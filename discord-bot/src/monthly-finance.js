const EMBED_COLOR = 0x2f7d4a
const EMBED_DESCRIPTION_LIMIT = 3900
const MALAYSIA_TIME_ZONE = 'Asia/Kuala_Lumpur'

export const FINANCIAL_CURRENCIES = ['USD', 'MYR', 'PHP', 'IDR']

const CURRENCY_FORMATS = {
  USD: { symbol: '$', minimumFractionDigits: 2 },
  MYR: { symbol: 'RM', minimumFractionDigits: 2 },
  PHP: { symbol: '₱', minimumFractionDigits: 2 },
  IDR: { symbol: 'Rp', minimumFractionDigits: 0 },
}

export class MonthlyInputError extends Error {}

export function parseMonthOption(value) {
  const month = String(value || '').trim()
  const match = month.match(/^(\d{4})-(0[1-9]|1[0-2])$/)
  if (!match || Number(match[1]) < 1900) {
    throw new MonthlyInputError('Month must use YYYY-MM, for example 2026-09.')
  }
  return month
}

export function currentMalaysiaMonth(now = new Date()) {
  return monthKeyInMalaysia(now)
}

export function malaysiaMonthRange(month) {
  const canonical = parseMonthOption(month)
  const [yearText, monthText] = canonical.split('-')
  const year = Number(yearText)
  const monthNumber = Number(monthText)
  const nextYear = monthNumber === 12 ? year + 1 : year
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1
  if (nextYear > 9999) throw new MonthlyInputError('Month is outside the supported reporting range.')

  const next = `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}`
  return {
    month: canonical,
    startInclusive: zonedMonthStartIso(canonical),
    endExclusive: zonedMonthStartIso(next),
  }
}

export function aggregateFinancialRecords(
  { sales = [], inventoryEvents = [] },
  { selectedMonth = null } = {},
) {
  const wantedMonth = selectedMonth ? parseMonthOption(selectedMonth) : null
  const months = new Map()

  if (wantedMonth) months.set(wantedMonth, createMonthReport(wantedMonth))

  for (const sale of sales) {
    const currency = normalizeCurrency(sale.currency)
    if (!currency) continue
    const month = monthKeyInMalaysia(sale.sold_at)
    if (wantedMonth && month !== wantedMonth) continue

    const report = getMonthReport(months, month)
    const totals = report.currencies[currency]
    totals.actualWalletCredit = addDecimalAmounts(totals.actualWalletCredit, sale.net_credit)
    totals.platformTax = addDecimalAmounts(totals.platformTax, sale.platform_fee)
    report.salesCount += 1
  }

  inventoryEvents.forEach((event, index) => {
    if (event.event_type !== 'supplier_purchase' || event.cash_amount === null || event.cash_amount === undefined) {
      return
    }

    const currency = normalizeCurrency(event.cash_currency)
    if (!currency) return
    const month = monthKeyInMalaysia(event.event_at)
    if (wantedMonth && month !== wantedMonth) return

    const report = getMonthReport(months, month)
    const totals = report.currencies[currency]
    totals.itemPurchaseSpending = addDecimalAmounts(totals.itemPurchaseSpending, event.cash_amount)
    const transactionKey = event.request_id
      ? `request:${event.request_id}`
      : `event:${event.id || index}`
    report.purchaseTransactionKeys.add(transactionKey)
  })

  return [...months.values()]
    .sort((left, right) => right.month.localeCompare(left.month))
    .map(finalizeMonthReport)
}

export function addDecimalAmounts(...values) {
  return values.reduce((total, value) => addTwoDecimals(total, value), '0')
}

export function subtractDecimalAmounts(left, right) {
  const rightParts = decimalParts(right)
  return addTwoDecimals(left, decimalFromScaled(-rightParts.units, rightParts.scale))
}

export function formatCurrencyAmount(value, currency, { showPositiveSign = false } = {}) {
  const format = CURRENCY_FORMATS[currency]
  if (!format) throw new TypeError(`Unsupported currency: ${currency}`)

  const { units, scale } = decimalParts(value)
  const negative = units < 0n
  const absolute = negative ? -units : units
  const rawDigits = absolute.toString().padStart(scale + 1, '0')
  const integer = scale > 0 ? rawDigits.slice(0, -scale) : rawDigits
  const meaningfulFraction = scale > 0 ? rawDigits.slice(-scale).replace(/0+$/, '') : ''
  const fraction = meaningfulFraction.padEnd(format.minimumFractionDigits, '0')
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const sign = negative ? '-' : showPositiveSign && absolute > 0n ? '+' : ''
  return `${sign}${format.symbol}${grouped}${fraction ? `.${fraction}` : ''}`
}

export function buildMonthlyOverviewPage(report) {
  const sections = FINANCIAL_CURRENCIES.map((currency) => {
    const totals = report.currencies[currency]
    return [
      `**${currency}**`,
      `Actual Wallet Credit: ${formatCurrencyAmount(totals.actualWalletCredit, currency)}`,
      `Platform Tax: ${formatCurrencyAmount(totals.platformTax, currency)}`,
      `Item Purchase Spending: ${formatCurrencyAmount(totals.itemPurchaseSpending, currency)}`,
      `Net Profit: ${formatCurrencyAmount(totals.netProfit, currency)}`,
    ].join('\n')
  })

  return {
    title: '📊 RAR Monthly Overview',
    description: [
      `**${monthLabel(report.month)}**`,
      ...sections,
      `Sales recorded: ${report.salesCount}`,
      `Purchase transactions: ${report.purchaseTransactions}`,
    ].join('\n\n'),
    color: EMBED_COLOR,
    footer: { text: 'Net Profit = Actual Wallet Credit − Item Purchase Spending' },
  }
}

export function buildMonthlyHistoryPages(
  reports,
  { maxDescriptionLength = EMBED_DESCRIPTION_LIMIT } = {},
) {
  if (!Number.isInteger(maxDescriptionLength) || maxDescriptionLength < 1 || maxDescriptionLength > 4096) {
    throw new RangeError('History embed description limit must be between 1 and 4096 characters.')
  }

  const sorted = [...reports].sort((left, right) => right.month.localeCompare(left.month))
  const blocks = sorted.map((report) => [
    `**${monthLabel(report.month)}**`,
    ...FINANCIAL_CURRENCIES.map((currency) => (
      `${currency}: ${formatCurrencyAmount(report.currencies[currency].netProfit, currency, { showPositiveSign: true })}`
    )),
  ].join('\n'))
  const descriptions = packBlocks(blocks, maxDescriptionLength)

  return descriptions.map((description, index) => ({
    title: descriptions.length === 1
      ? '📅 RAR Profit History'
      : `📅 RAR Profit History (${index + 1}/${descriptions.length})`,
    description,
    color: EMBED_COLOR,
    footer: { text: 'Currencies remain separate; no conversion or combined total' },
  }))
}

export function monthLabel(month) {
  const canonical = parseMonthOption(month)
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${canonical}-01T00:00:00Z`))
}

function monthKeyInMalaysia(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) throw new TypeError(`Invalid financial timestamp: ${String(value)}`)

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MALAYSIA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date)
  const year = parts.find(({ type }) => type === 'year')?.value
  const month = parts.find(({ type }) => type === 'month')?.value
  return `${year}-${month}`
}

function zonedMonthStartIso(month) {
  const [year, monthNumber] = month.split('-').map(Number)
  const targetLocalTime = Date.UTC(year, monthNumber - 1, 1)
  let candidate = targetLocalTime
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: MALAYSIA_TIME_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(candidate)).map(({ type, value }) => [type, value]),
    )
    const representedLocalTime = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    )
    const correction = targetLocalTime - representedLocalTime
    candidate += correction
    if (correction === 0) break
  }

  return new Date(candidate).toISOString()
}

function createMonthReport(month) {
  return {
    month,
    currencies: Object.fromEntries(FINANCIAL_CURRENCIES.map((currency) => [currency, {
      actualWalletCredit: '0',
      platformTax: '0',
      itemPurchaseSpending: '0',
    }])),
    salesCount: 0,
    purchaseTransactionKeys: new Set(),
  }
}

function getMonthReport(months, month) {
  if (!months.has(month)) months.set(month, createMonthReport(month))
  return months.get(month)
}

function finalizeMonthReport(report) {
  return {
    month: report.month,
    currencies: Object.fromEntries(FINANCIAL_CURRENCIES.map((currency) => {
      const totals = report.currencies[currency]
      return [currency, {
        ...totals,
        netProfit: subtractDecimalAmounts(totals.actualWalletCredit, totals.itemPurchaseSpending),
      }]
    })),
    salesCount: report.salesCount,
    purchaseTransactions: report.purchaseTransactionKeys.size,
  }
}

function normalizeCurrency(value) {
  const currency = String(value || '').trim().toUpperCase()
  return FINANCIAL_CURRENCIES.includes(currency) ? currency : null
}

function addTwoDecimals(left, right) {
  const leftParts = decimalParts(left)
  const rightParts = decimalParts(right)
  const scale = Math.max(leftParts.scale, rightParts.scale)
  const leftUnits = leftParts.units * 10n ** BigInt(scale - leftParts.scale)
  const rightUnits = rightParts.units * 10n ** BigInt(scale - rightParts.scale)
  return decimalFromScaled(leftUnits + rightUnits, scale)
}

function decimalParts(value) {
  const text = expandScientificDecimal(String(value).trim())
  const match = text.match(/^([+-]?)(\d+)(?:\.(\d+))?$/)
  if (!match) throw new TypeError(`Invalid financial amount: ${String(value)}`)

  const fraction = match[3] || ''
  const digits = `${match[2]}${fraction}`.replace(/^0+(?=\d)/, '')
  const sign = match[1] === '-' ? -1n : 1n
  return { units: BigInt(digits || '0') * sign, scale: fraction.length }
}

function decimalFromScaled(units, scale) {
  let normalizedUnits = units
  let normalizedScale = scale
  while (normalizedScale > 0 && normalizedUnits % 10n === 0n) {
    normalizedUnits /= 10n
    normalizedScale -= 1
  }

  const negative = normalizedUnits < 0n
  const absolute = negative ? -normalizedUnits : normalizedUnits
  const digits = absolute.toString().padStart(normalizedScale + 1, '0')
  const integer = normalizedScale > 0 ? digits.slice(0, -normalizedScale) : digits
  const fraction = normalizedScale > 0 ? digits.slice(-normalizedScale) : ''
  return `${negative ? '-' : ''}${integer}${fraction ? `.${fraction}` : ''}`
}

function expandScientificDecimal(value) {
  const match = value.match(/^([+-]?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/)
  if (!match) return value

  const sign = match[1]
  const integer = match[2]
  const fraction = match[3] || ''
  const digits = `${integer}${fraction}`
  const decimalPosition = integer.length + Number(match[4])
  if (decimalPosition <= 0) return `${sign}0.${'0'.repeat(-decimalPosition)}${digits}`
  if (decimalPosition >= digits.length) return `${sign}${digits}${'0'.repeat(decimalPosition - digits.length)}`
  return `${sign}${digits.slice(0, decimalPosition)}.${digits.slice(decimalPosition)}`
}

function packBlocks(blocks, maxDescriptionLength) {
  if (blocks.length === 0) return ['No recorded financial activity was found.']

  const descriptions = []
  let current = ''
  for (const block of blocks) {
    if (block.length > maxDescriptionLength) throw new RangeError('A monthly history block exceeds Discord limits.')
    const candidate = current ? `${current}\n\n${block}` : block
    if (candidate.length > maxDescriptionLength) {
      descriptions.push(current)
      current = block
    } else {
      current = candidate
    }
  }
  if (current) descriptions.push(current)
  return descriptions
}
