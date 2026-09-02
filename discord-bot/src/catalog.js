const TOKEN_ALIASES = new Map([
  ['dino', 'dinosaur'],
])

export class UnknownItemError extends Error {
  constructor(itemName) {
    super(`Unknown item: ${itemName}`)
    this.name = 'UnknownItemError'
    this.itemName = itemName
  }
}

export class AmbiguousItemError extends Error {
  constructor(itemName, matches) {
    super(`Ambiguous item: ${itemName} (matches ${matches.join(', ')})`)
    this.name = 'AmbiguousItemError'
    this.itemName = itemName
    this.matches = matches
  }
}

export class InsufficientStockError extends Error {
  constructor(itemName) {
    super(`Insufficient stock for ${itemName}`)
    this.name = 'InsufficientStockError'
    this.itemName = itemName
  }
}

export class UnknownPlatformError extends Error {
  constructor(platformName) {
    super(`Unknown or inactive platform: ${platformName}`)
    this.name = 'UnknownPlatformError'
    this.platformName = platformName
  }
}

export function resolveSaleItems(parsedItems, catalogItems) {
  const activeItems = catalogItems.filter((item) => item.active !== false)
  const aliasIndex = buildAliasIndex(activeItems)
  const resolvedById = new Map()

  for (const parsedItem of parsedItems) {
    const matches = new Map()
    for (const alias of aliasesForName(parsedItem.name)) {
      for (const item of aliasIndex.get(alias) || []) matches.set(item.id, item)
    }

    if (matches.size === 0) throw new UnknownItemError(parsedItem.name)
    if (matches.size > 1) {
      throw new AmbiguousItemError(parsedItem.name, [...matches.values()].map((item) => item.name).sort())
    }

    const item = matches.values().next().value
    const existing = resolvedById.get(item.id)
    if (existing) existing.quantity += parsedItem.quantity
    else resolvedById.set(item.id, { item, quantity: parsedItem.quantity })
  }

  const resolved = [...resolvedById.values()]
  for (const line of resolved) {
    const stock = Number(line.item.stock)
    if (!Number.isFinite(stock) || stock < line.quantity) {
      throw new InsufficientStockError(line.item.name)
    }
  }

  return resolved
}

export function resolvePlatform(platformName, platforms) {
  const target = normalizeName(platformName)
  const matches = platforms.filter((platform) => platform.active !== false && normalizeName(platform.name) === target)
  if (matches.length !== 1) throw new UnknownPlatformError(platformName)
  return matches[0]
}

export function normalizeName(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replaceAll('&', ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => TOKEN_ALIASES.get(token) || token)
    .join(' ')
}

function buildAliasIndex(items) {
  const index = new Map()
  for (const item of items) {
    for (const alias of aliasesForName(item.name)) {
      const matches = index.get(alias) || []
      matches.push(item)
      index.set(alias, matches)
    }
  }
  return index
}

function aliasesForName(value) {
  const normalized = normalizeName(value)
  if (!normalized) return []

  const words = normalized.split(' ')
  const last = words.at(-1)
  const prefix = words.slice(0, -1)
  const variants = new Set([last, singularize(last), pluralize(singularize(last))])
  return [...variants].map((variant) => [...prefix, variant].join(' '))
}

function singularize(word) {
  if (word.length > 3 && word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (/(ches|shes|xes|zes)$/.test(word)) return word.slice(0, -2)
  if (word.length > 2 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
  return word
}

function pluralize(word) {
  if (word.length > 1 && /[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`
  if (/(s|x|z|ch|sh)$/.test(word)) return `${word}es`
  return `${word}s`
}
