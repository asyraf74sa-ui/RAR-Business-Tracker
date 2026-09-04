import {
  AmbiguousItemError,
  DuplicateItemError,
  InsufficientStockError,
  TradeValidationError,
  UnknownItemError,
  normalizeName,
} from './catalog.js'

export function resolveMRItems(parsedItems, catalog, { combineDuplicates = true } = {}) {
  const items = catalog.items.filter((item) => item.is_archived !== true)
  const itemById = new Map(items.map((item) => [item.id, item]))
  const index = new Map()

  for (const item of items) {
    addAliases(index, [item.name, ...(item.aliases || [])], { type: 'item', item })
  }
  for (const family of catalog.setFamilies.filter((candidate) => candidate.active !== false)) {
    addAliases(index, family.aliases || [], { type: 'set', family })
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
