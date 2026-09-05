import { AmbiguousItemError, normalizeName } from './catalog.js'
import { buildMRAliasIndex, mrMatchLabel } from './mr-catalog.js'
import { SaleParseError } from './parser.js'

const NUMBER_PATTERN = /^-?[0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?$/
const MILLION_WORDS = new Set(['m', 'million'])
const MILLION_GEMS_WORDS = new Set(['mgem', 'mgems', 'milliongem', 'milliongems'])
const PLURALIZABLE_LAST_WORDS = new Set(['set', 'chair', 'table'])

export class MRItemParseError extends SaleParseError {
  constructor(token, recognized = [], detail = null) {
    const lines = [detail || `Unknown MR item: ${token}`]
    if (recognized.length > 0) {
      lines.push('Recognized before failure:', ...recognized.map(formatRecognized))
    }
    lines.push('Use /help with the Valid item names topic.')
    super(lines.join('\n'))
    this.name = 'MRItemParseError'
    this.token = token
    this.recognized = recognized
  }
}

export function parseMRItemSequence(itemText, catalog) {
  const tokens = tokenize(itemText)
  if (tokens.length === 0) throw new SaleParseError('No sale items were found.')

  const aliases = buildAliasPhrases(buildMRAliasIndex(catalog))
  const recognized = []
  let cursor = 0

  while (cursor < tokens.length) {
    const quantityToken = tokens[cursor]
    if (quantityToken.type !== 'number') {
      throw new MRItemParseError(quantityToken.raw, recognized)
    }

    const baseQuantity = parsePositiveQuantity(quantityToken, recognized)
    cursor += 1

    const million = consumeMillion(tokens, cursor)
    if (million) {
      const quantity = baseQuantity * 1_000_000
      if (!Number.isSafeInteger(quantity)) {
        throw new MRItemParseError(
          quantityToken.raw,
          recognized,
          `Invalid MR Gems quantity: ${quantityToken.raw}${million.label}`,
        )
      }
      const gems = resolveGemsMatch(aliases.index, recognized)
      recognized.push({ name: gems.item.name, quantity })
      cursor = million.nextCursor
      continue
    }

    const candidates = longestMatches(tokens, cursor, aliases.phrases)
    if (candidates.length === 0) {
      const unknown = tokens[cursor]
      if (!unknown) {
        throw new MRItemParseError(
          quantityToken.raw,
          recognized,
          `Missing MR item name after quantity ${quantityToken.raw}.`,
        )
      }
      throw new MRItemParseError(unknown.raw, recognized)
    }

    const maxLength = candidates[0].tokens.length
    const matches = uniqueMatches(
      candidates
        .filter((candidate) => candidate.tokens.length === maxLength)
        .flatMap((candidate) => candidate.matches),
    )
    const inputName = tokens.slice(cursor, cursor + maxLength).map(({ raw }) => raw).join(' ')
    if (matches.length > 1) {
      throw new AmbiguousItemError(inputName, matches.map(mrMatchLabel).sort())
    }

    const match = matches[0]
    recognized.push({
      name: match.type === 'item' ? match.item.name : match.family.name,
      quantity: baseQuantity,
    })
    cursor += maxLength
  }

  return recognized
}

function tokenize(value) {
  const normalized = String(value || '')
    .normalize('NFKC')
    .replace(/[\u2018\u2019']/g, '')
    .replaceAll('&', ' and ')
  const matches = normalized.matchAll(/-?[0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?|[a-z]+/gi)
  return [...matches].map((match) => ({
    raw: match[0],
    normalized: NUMBER_PATTERN.test(match[0])
      ? match[0].replaceAll(',', '')
      : normalizeName(match[0]),
    type: NUMBER_PATTERN.test(match[0]) ? 'number' : 'word',
  }))
}

function parsePositiveQuantity(token, recognized) {
  const quantity = Number(token.normalized)
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new MRItemParseError(
      token.raw,
      recognized,
      `Invalid MR item quantity: ${token.raw}`,
    )
  }
  return quantity
}

// Backward-compatible name for callers/tests that predate the shared MR operation parser.
export const parseMRSaleItemSequence = parseMRItemSequence

function consumeMillion(tokens, cursor) {
  const token = tokens[cursor]
  if (!token || token.type !== 'word') return null

  if (MILLION_GEMS_WORDS.has(token.normalized)) {
    return { label: token.raw, nextCursor: cursor + 1 }
  }
  if (!MILLION_WORDS.has(token.normalized)) return null

  const gems = tokens[cursor + 1]
  const consumesGems = gems?.type === 'word' && ['gem', 'gems'].includes(gems.normalized)
  return {
    label: token.raw,
    nextCursor: cursor + (consumesGems ? 2 : 1),
  }
}

function resolveGemsMatch(index, recognized) {
  const matches = uniqueMatches([
    ...(index.get('gems') || []),
    ...(index.get('mr gems') || []),
    ...(index.get('gems mr') || []),
  ].filter((match) => match.type === 'item'))
  if (matches.length === 0) {
    throw new MRItemParseError('GEMS', recognized, 'The active MR Gems catalog item could not be found.')
  }
  if (matches.length > 1) {
    throw new AmbiguousItemError('MR Gems', matches.map(mrMatchLabel).sort())
  }
  return matches[0]
}

function buildAliasPhrases(index) {
  const phrases = []
  for (const [alias, matches] of index) {
    for (const variant of phraseVariants(alias)) {
      phrases.push({ alias, matches, tokens: aliasTokens(variant) })
    }
  }
  phrases.sort((left, right) => right.tokens.length - left.tokens.length || left.alias.localeCompare(right.alias))
  return { index, phrases }
}

function aliasTokens(alias) {
  const result = []
  for (const token of alias.split(' ')) {
    if (token === 's' && /^[a-z]+$/.test(result.at(-1) || '')) result[result.length - 1] += 's'
    else result.push(token)
  }
  return result
}

function phraseVariants(alias) {
  const words = alias.split(' ')
  const last = words.at(-1)
  const variants = new Set([alias])
  if (PLURALIZABLE_LAST_WORDS.has(last)) variants.add([...words.slice(0, -1), `${last}s`].join(' '))
  if (last === 'sets' || last === 'chairs' || last === 'tables') {
    variants.add([...words.slice(0, -1), last.slice(0, -1)].join(' '))
  }
  return variants
}

function longestMatches(tokens, cursor, phrases) {
  let longest = 0
  const matches = []
  for (const phrase of phrases) {
    if (phrase.tokens.length < longest) break
    if (!tokensMatch(tokens, cursor, phrase.tokens)) continue
    if (phrase.tokens.length > longest) {
      longest = phrase.tokens.length
      matches.length = 0
    }
    matches.push(phrase)
  }
  return matches
}

function tokensMatch(input, cursor, expected) {
  if (cursor + expected.length > input.length) return false
  return expected.every((token, offset) => input[cursor + offset].normalized === token)
}

function uniqueMatches(matches) {
  return [...new Map(matches.map((match) => [
    `${match.type}:${match.type === 'item' ? match.item.id : match.family.id}`,
    match,
  ])).values()]
}

function formatRecognized({ name, quantity }) {
  return `${formatQuantity(quantity)}x ${name}`
}

function formatQuantity(value) {
  return Number(value).toLocaleString('en-US', { maximumFractionDigits: 20 })
}
