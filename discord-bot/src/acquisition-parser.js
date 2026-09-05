import { parseItemList } from './parser.js'

export class AcquisitionParseError extends Error {
  constructor(message) {
    super(message)
    this.name = 'AcquisitionParseError'
  }
}

export function detectAcquisitionOperation(content) {
  const value = String(content || '').trim()
  if (/^(?:RAR|MR)\s+PURCHASE\b/i.test(value)) return 'purchase'
  if (/^(?:RAR|MR)\s+FARM\b/i.test(value)) return 'farm'
  if (/^(?:RAR|MR)\s+TRADE\b/i.test(value)) return 'trade'
  if (/^(?:RAR|MR)\s+ADD\b/i.test(value)) return 'manual_add'
  if (/^(?:RAR|MR)\s+STOCK\b/i.test(value)) return 'stock_reconcile'
  return null
}

export function detectAcquisitionGame(content) {
  const match = String(content || '').trim().match(/^(RAR|MR)\s+(?:PURCHASE|FARM|TRADE|ADD|STOCK)\b/i)
  return match ? match[1].toUpperCase() : null
}

export function parseAcquisitionMessage(content, { itemParser = parseItemList } = {}) {
  const game = detectAcquisitionGame(content)
  const operation = detectAcquisitionOperation(content)
  if (game === 'MR' && operation === 'farm') {
    throw new AcquisitionParseError('MR FARM is not supported. Use MR PURCHASE, MR TRADE, MR ADD, or MR STOCK.')
  }
  if (operation === 'purchase') return { game, ...parsePurchaseMessage(content, { itemParser }) }
  if (operation === 'farm') return { game, ...parseFarmMessage(content) }
  if (operation === 'trade') return { game, ...parseTradeMessage(content, { itemParser }) }
  if (operation === 'manual_add') return { game, ...parseAddMessage(content, { itemParser }) }
  if (operation === 'stock_reconcile') return { game, ...parseStockMessage(content) }
  throw new AcquisitionParseError('Expected a supported RAR or MR operation command.')
}

export function parseAddMessage(content, { itemParser = parseItemList } = {}) {
  const lines = nonEmptyLines(content)
  if (lines.length !== 1) throw new AcquisitionParseError('ADD must be written on one line.')

  const header = lines[0].match(/^(?:RAR|MR)\s+ADD\s*(?:-|\u2013|\u2014|:)\s*(.+)$/i)
  if (!header) throw new AcquisitionParseError('Use "RAR ADD - ..." or "MR ADD - ...".')

  return {
    type: 'manual_add',
    items: itemParser(header[1]),
  }
}

export function parseStockMessage(content) {
  const lines = nonEmptyLines(content)
  if (lines.length !== 1) throw new AcquisitionParseError('STOCK must be written on one line.')

  const header = lines[0].match(/^(?:RAR|MR)\s+STOCK\s*(?:-|\u2013|\u2014|:)\s*(.+)$/i)
  if (!header) throw new AcquisitionParseError('Use "RAR STOCK - ..." or "MR STOCK - ...".')

  return {
    type: 'stock_reconcile',
    items: parseItemList(header[1], { allowZero: true }),
  }
}

export function parsePurchaseMessage(content, { itemParser = parseItemList } = {}) {
  const lines = nonEmptyLines(content)
  if (lines.length !== 2) {
    throw new AcquisitionParseError('A purchase needs one item line and one total cost line.')
  }

  const header = lines[0].match(/^(?:RAR|MR)\s+PURCHASE\s*(?:-|\u2013|\u2014|:)\s*(.+)$/i)
  if (!header) throw new AcquisitionParseError('Use "RAR PURCHASE - ..." or "MR PURCHASE - ...".')

  return {
    type: 'purchase',
    items: itemParser(header[1]),
    cost: parseCashAmount(lines[1]),
  }
}

export function parseFarmMessage(content) {
  const match = String(content || '').trim().match(
    /^RAR\s+FARM\s*(?:-|\u2013|\u2014|:)\s*([0-9]+)\s+CYCLES?\s*$/i,
  )
  if (!match) throw new AcquisitionParseError('Use "RAR FARM - <number> CYCLE".')

  const cycles = Number(match[1])
  if (!Number.isSafeInteger(cycles) || cycles <= 0) {
    throw new AcquisitionParseError('Farm cycles must be a positive whole number.')
  }

  return { type: 'farm', cycles }
}

export function parseTradeMessage(content, { itemParser = parseItemList } = {}) {
  const lines = nonEmptyLines(content)
  if (lines.length !== 3 || !/^(?:RAR|MR)\s+TRADE\s*:?\s*$/i.test(lines[0])) {
    throw new AcquisitionParseError('A trade needs a RAR TRADE or MR TRADE header, GIVE, and RECEIVE lines.')
  }

  const give = lines[1].match(/^GIVE\s*(?:-|\u2013|\u2014|:)\s*(.+)$/i)
  const receive = lines[2].match(/^RECEIVE\s*(?:-|\u2013|\u2014|:)\s*(.+)$/i)
  if (!give || !receive) {
    throw new AcquisitionParseError('Use "GIVE - ..." followed by "RECEIVE - ...".')
  }

  return {
    type: 'trade',
    giveItems: itemParser(give[1]),
    receiveItems: itemParser(receive[1]),
  }
}

export function parseCashAmount(value) {
  const raw = String(value || '').trim().toUpperCase()
  if (!raw) throw new AcquisitionParseError('Purchase cost is missing.')

  const currencies = new Set()
  let numericText = raw

  if (/^RM\s*/.test(numericText)) {
    currencies.add('MYR')
    numericText = numericText.replace(/^RM\s*/, '')
  }

  if (numericText.includes('$')) currencies.add('USD')
  numericText = numericText.replaceAll('$', ' ')

  const currencyTokens = [...numericText.matchAll(/\b(USD|US|MYR|PHP|IDR|RM)\b/g)]
  for (const match of currencyTokens) {
    currencies.add(match[1] === 'US' ? 'USD' : match[1] === 'RM' ? 'MYR' : match[1])
  }
  numericText = numericText.replace(/\b(?:USD|US|MYR|PHP|IDR|RM)\b/g, ' ').replace(/\s+/g, '')

  if (currencies.size === 0) throw new AcquisitionParseError('Unsupported or missing purchase currency.')
  if (currencies.size > 1) throw new AcquisitionParseError('Purchase cost contains conflicting currencies.')
  if (!/^[0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?$/.test(numericText)) {
    throw new AcquisitionParseError('Purchase cost must be a non-negative money amount.')
  }

  const amount = Number(numericText.replaceAll(',', ''))
  if (!Number.isFinite(amount) || amount < 0) {
    throw new AcquisitionParseError('Purchase cost must be a non-negative money amount.')
  }

  return { amount, currency: [...currencies][0] }
}

function nonEmptyLines(content) {
  return String(content || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}
