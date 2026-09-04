import { canonicalPlatformName } from './platforms.js'

export class SaleParseError extends Error {
  constructor(message) {
    super(message)
    this.name = 'SaleParseError'
  }
}

export function isSaleMessage(content) {
  return detectSaleGame(content) !== null
}

export function detectSaleGame(content) {
  const match = String(content || '').match(/^\s*(RAR|MR)\s*(?:-|\u2013|\u2014|:)/i)
  return match ? match[1].toUpperCase() : null
}

export function parseSaleMessage(content) {
  const lines = String(content || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length < 4) {
    throw new SaleParseError('Expected RAR or MR items, net amount, fee amount, and platform.')
  }

  const header = lines[0].match(/^(RAR|MR)\s*(?:-|\u2013|\u2014|:)\s*(.*)$/i)
  if (!header) {
    throw new SaleParseError('The first line must start with "RAR -" or "MR -".')
  }

  const game = header[1].toUpperCase()

  const moneyLines = []
  for (let index = 1; index < lines.length && moneyLines.length < 2; index += 1) {
    const parsed = parseMoneyLine(lines[index], {
      allowBare: moneyLines.length === 1,
      fallbackCurrency: moneyLines[0]?.currency,
    })
    if (parsed) moneyLines.push({ ...parsed, index })
  }

  if (moneyLines.length < 2) {
    throw new SaleParseError('Could not find both the net amount and platform fee.')
  }

  const [netLine, feeLine] = moneyLines
  if (netLine.label) {
    throw new SaleParseError('The first money amount must be the net wallet credit, not TAX or FEE.')
  }

  if (netLine.currency !== feeLine.currency) {
    throw new SaleParseError('Net credit and platform fee must use the same currency.')
  }

  const itemText = [header[2], ...lines.slice(1, netLine.index)].filter(Boolean).join(' ')
  const items = parseItemList(itemText)

  const platformText = lines.slice(feeLine.index + 1).join(' ')
  const platform = canonicalPlatformName(platformText)
  if (!platform) {
    throw new SaleParseError(`Unknown platform: ${platformText || '(missing)'}`)
  }

  return {
    game,
    items,
    netCredit: netLine.amount,
    platformFee: feeLine.amount,
    gross: netLine.amount + feeLine.amount,
    currency: netLine.currency,
    platform,
  }
}

export function parseItemList(itemText, { allowZero = false } = {}) {
  const segments = splitItemSegments(itemText)
  if (segments.length === 0) {
    throw new SaleParseError('No sale items were found.')
  }

  return segments.map((segment) => {
    const match = segment.match(/^(-?[0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?)\s+(.+?)$/)
    if (!match) {
      throw new SaleParseError(`Could not parse item: ${segment}`)
    }

    const quantity = Number(match[1].replaceAll(',', ''))
    const name = match[2].replace(/[.,;+]+$/g, '').replace(/\s+/g, ' ').trim()
    if (!Number.isFinite(quantity) || quantity < 0 || (!allowZero && quantity === 0) || !name) {
      throw new SaleParseError(`Invalid item quantity or name: ${segment}`)
    }

    return { quantity, name }
  })
}

function parseMoneyLine(line, { allowBare, fallbackCurrency = null }) {
  const raw = String(line || '').trim()
  if (!raw) return null

  const currencies = new Set()
  if (/\$/.test(raw)) currencies.add('USD')
  if (/^RM\s*/i.test(raw)) currencies.add('MYR')
  for (const match of raw.matchAll(/\b(USD|US|MYR|PHP|IDR|RM)\b/gi)) {
    const token = match[1].toUpperCase()
    currencies.add(token === 'US' ? 'USD' : token === 'RM' ? 'MYR' : token)
  }
  if (currencies.size > 1) throw new SaleParseError('A money line contains conflicting currencies.')

  const hasCurrency = currencies.size === 1
  const labelMatch = raw.match(/\b(TAX|FEE)\b/i)
  if (!hasCurrency && !labelMatch && !allowBare) return null

  const numericText = raw
    .replace(/^RM\s*/i, ' ')
    .replace(/\b(?:USD|US|MYR|PHP|IDR|RM)\b/gi, ' ')
    .replace(/\b(?:TAX|FEE)\b/gi, ' ')
    .replaceAll('$', ' ')
    .replace(/\s+/g, '')

  if (!/^[0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?$/.test(numericText)) return null

  const amount = Number(numericText.replaceAll(',', ''))
  if (!Number.isFinite(amount) || amount < 0) return null

  return {
    amount,
    label: labelMatch ? labelMatch[1].toUpperCase() : null,
    currency: hasCurrency ? [...currencies][0] : fallbackCurrency,
  }
}

function splitItemSegments(value) {
  const segments = []
  let buffer = ''

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    const previous = previousNonSpace(buffer)
    const isPlus = character === '+'
    const isListComma = character === ',' && previous !== null && !/\d/.test(previous)

    if (isPlus || isListComma) {
      const segment = buffer.trim()
      if (!segment) throw new SaleParseError('The item list contains an empty entry.')
      segments.push(segment)
      buffer = ''
      continue
    }

    buffer += character
  }

  const finalSegment = buffer.trim()
  if (finalSegment) segments.push(finalSegment)
  return segments
}

function previousNonSpace(value) {
  for (let index = value.length - 1; index >= 0; index -= 1) {
    if (!/\s/.test(value[index])) return value[index]
  }
  return null
}
