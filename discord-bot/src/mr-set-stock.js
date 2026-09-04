export function deriveMRSetStock(family, itemById) {
  const tables = quantity(itemById.get(family.table_item_id)?.current_quantity)
  const chairs = quantity(itemById.get(family.chair_item_id)?.current_quantity)
  const chairsPerSet = Number(family.chairs_per_set)
  if (!Number.isSafeInteger(chairsPerSet) || chairsPerSet <= 0) {
    throw new TypeError('MR set family has an invalid chairs_per_set value.')
  }

  const completedSets = Math.min(tables, Math.floor(chairs / chairsPerSet))
  return {
    name: family.name,
    tables,
    chairs,
    chairsPerSet,
    completedSets,
    excessTables: tables - completedSets,
    excessChairs: chairs - (completedSets * chairsPerSet),
  }
}

export function deriveMRSetStockSummaries(items, families) {
  const itemById = new Map(items.map((item) => [item.id, item]))
  return families
    .filter((family) => family.active !== false)
    .map((family) => deriveMRSetStock(family, itemById))
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }))
}

function quantity(value) {
  const result = Number(value ?? 0)
  if (!Number.isFinite(result) || result < 0) throw new TypeError('MR stock quantity is invalid.')
  return result
}
