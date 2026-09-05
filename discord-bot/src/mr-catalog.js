import {
  AmbiguousItemError,
  DuplicateItemError,
  InsufficientStockError,
  TradeValidationError,
  UnknownItemError,
  normalizeName,
} from './catalog.js'

const CONFIRMED_SET_ALIASES = new Map([
  ['candy cane', ['Candy Set', 'Candy Cane Set']],
  ['dominus infernus', ['Dom Set', 'Dominus Set', 'Dominus Infernus Set']],
  ['inverted royal', ['Inv Set', 'Inverted Set', 'Inverted Royal Set']],
  ['corrupted royal', ['Corr Set', 'Corrupted Set', 'Corrupted Royal Set']],
  ['royal', ['Royal Set']],
])

export function resolveMRItems(
  parsedItems,
  catalog,
  { allowSets = true, combineDuplicates = true } = {},
) {
  const items = catalog.items.filter((item) => item.is_archived !== true)
  const itemById = new Map(items.map((item) => [item.id, item]))
  const index = new Map()

  for (const item of items) {
    addAliases(index, [item.name, ...(item.aliases || [])], { type: 'item', item })
  }
  if (allowSets) {
    for (const family of catalog.setFamilies.filter((candidate) => candidate.active !== false)) {
      const confirmedAliases = CONFIRMED_SET_ALIASES.get(normalizeName(family.name)) || []
      addSetAliases(index, [...(family.aliases || []), ...confirmedAliases], { type: 'set', family })
    }
  }

  const expanded = new Map()
  const rpcItems = []
  for (const parsed of parsedItems) {
    const matches = uniqueMatches(index.get(normalizeName(parsed.name)) || [])
    if (matches.length === 0) throw new UnknownItemError(parsed.name)
    if (matches.length > 1) {
      throw new AmbiguousItemError(parsed.name, matches.map(matchLabel).sort())
    }

    const match = matches[0]
    if (match.type === 'item') {
      addExpanded(expanded, match.item, parsed.quantity, combineDuplicates)
      rpcItems.push({ item_id: match.item.id, quantity: parsed.quantity })
      continue
    }

    const table = itemById.get(match.family.table_item_id)
    const chair = itemById.get(match.family.chair_item_id)
    if (!table || !chair) throw new UnknownItemError(parsed.name)
    addExpanded(expanded, table, parsed.quantity, combineDuplicates)
    addExpanded(expanded, chair, parsed.quantity * Number(match.family.chairs_per_set), combineDuplicates)
    rpcItems.push({ set_family_id: match.family.id, quantity: parsed.quantity })
  }

  return { items: [...expanded.values()], rpcItems }
}

export function resolveMRSaleItems(parsedItems, catalog) {
  const resolved = resolveMRItems(parsedItems, catalog)
  validateMRStock(resolved.items)
  return resolved
}

export function resolveMRTradeItems(giveItems, receiveItems, catalog) {
  const give = resolveMRItems(giveItems, catalog)
  const receive = resolveMRItems(receiveItems, catalog)
  const receiveIds = new Set(receive.items.map(({ item }) => item.id))
  const overlap = give.items.find(({ item }) => receiveIds.has(item.id))
  if (overlap) throw new TradeValidationError(`${overlap.item.name} cannot appear in both GIVE and RECEIVE.`)
  validateMRStock(give.items)
  return { give, receive }
}

export function validateMRStock(lines) {
  for (const line of lines) {
    const available = Number(line.item.current_quantity)
    if (!Number.isFinite(available) || available < line.quantity) {
      throw new InsufficientStockError(line.item.name, line.quantity, Number.isFinite(available) ? available : 0)
    }
  }
}

function addAliases(index, values, match) {
  for (const value of values) {
    const alias = normalizeName(value)
    if (!alias) continue
    const matches = index.get(alias) || []
    matches.push(match)
    index.set(alias, matches)
  }
}

function addSetAliases(index, values, match) {
  for (const value of values) {
    const alias = normalizeName(value)
    if (!alias) continue
    const variants = new Set([alias])
    if (alias.endsWith(' set')) variants.add(`${alias}s`)
    if (alias.endsWith(' sets')) variants.add(alias.slice(0, -1))
    addAliases(index, variants, match)
  }
}

function uniqueMatches(matches) {
  return [...new Map(matches.map((match) => [
    `${match.type}:${match.type === 'item' ? match.item.id : match.family.id}`,
    match,
  ])).values()]
}

function matchLabel(match) {
  return match.type === 'item' ? match.item.name : `${match.family.name} set`
}

function addExpanded(expanded, item, quantity, combineDuplicates) {
  const existing = expanded.get(item.id)
  if (existing && !combineDuplicates) throw new DuplicateItemError(item.name)
  if (existing) existing.quantity += quantity
  else expanded.set(item.id, { item, quantity })
}
