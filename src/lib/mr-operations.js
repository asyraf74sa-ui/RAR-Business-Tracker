import { toNumber } from './format.js'

export function selectionValue(type, id) {
  return `${type}:${id}`
}
export function parseSelection(value) {
  const [type, id] = String(value || '').split(':')
  if (!id || !['item', 'set'].includes(type)) return null
  return { type, id }
}

export function toMRRpcPayload(lines) {
  return (lines || []).map((line) => {
    const selection = parseSelection(line.selection)
    const quantity = Number(line.quantity)
    if (!selection || !Number.isFinite(quantity) || quantity <= 0) throw new Error('Choose an MR item or set and enter a positive quantity.')
    return selection.type === 'set'
      ? { set_family_id: selection.id, quantity }
      : { item_id: selection.id, quantity }
  })
}

export function expandMRLines(lines, catalog) {
  const items = new Map((catalog.items || []).map((item) => [item.id, item]))
  const families = new Map((catalog.setFamilies || []).map((family) => [family.id, family]))
  const expanded = new Map()

  for (const payload of toMRRpcPayload(lines)) {
    if (payload.item_id) add(expanded, items.get(payload.item_id), payload.quantity)
    else {
      const family = families.get(payload.set_family_id)
      if (!family || family.active === false) throw new Error('The selected MR set is unavailable.')
      add(expanded, items.get(family.table_item_id), payload.quantity)
      add(expanded, items.get(family.chair_item_id), payload.quantity * Number(family.chairs_per_set))
    }
  }

  return [...expanded.values()]
}

export function assertMRStock(lines, catalog) {
  for (const line of expandMRLines(lines, catalog)) {
    if (toNumber(line.item.current_quantity) < line.quantity) {
      throw new Error(`${line.item.name} has only ${toNumber(line.item.current_quantity)} in stock.`)
    }
  }
}

export function assertDisjointMRTrade(giveLines, receiveLines, catalog) {
  const giveIds = new Set(expandMRLines(giveLines, catalog).map((line) => line.item.id))
  const overlap = expandMRLines(receiveLines, catalog).find((line) => giveIds.has(line.item.id))
  if (overlap) throw new Error(`${overlap.item.name} cannot appear in both GIVE and RECEIVE.`)
  assertMRStock(giveLines, catalog)
}

function add(expanded, item, quantity) {
  if (!item || item.is_archived) throw new Error('The selected MR item is unavailable.')
  const current = expanded.get(item.id)
  if (current) current.quantity += quantity
  else expanded.set(item.id, { item, quantity })
}
