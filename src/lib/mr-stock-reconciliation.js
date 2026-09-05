export const MR_RECONCILIATION_MAX_ITEMS = 100

export class MRReconciliationValidationError extends Error {
  constructor(itemName, message = `Enter a valid non-negative whole-number count for ${itemName}.`) {
    super(message)
    this.name = 'MRReconciliationValidationError'
    this.itemName = itemName
  }
}

export function parseMRActualCount(value) {
  const normalized = String(value ?? '').trim()
  if (!/^\d+$/.test(normalized)) return null

  const quantity = Number(normalized)
  return Number.isSafeInteger(quantity) && quantity >= 0 ? quantity : null
}

export function buildMRReconciliationPayload(items, counts) {
  const activeItems = (items || []).filter((item) => !item.is_archived)
  if (activeItems.length > MR_RECONCILIATION_MAX_ITEMS) {
    throw new Error(`MR stock reconciliation supports at most ${MR_RECONCILIATION_MAX_ITEMS} active items.`)
  }

  return activeItems.flatMap((item) => {
    const countedStock = parseMRActualCount(counts?.[item.id])
    if (countedStock == null) throw new MRReconciliationValidationError(item.name)

    const trackedStock = Number(item.current_quantity)
    if (!Number.isSafeInteger(trackedStock) || trackedStock < 0) {
      throw new MRReconciliationValidationError(
        item.name,
        `${item.name} has an unsafe tracked quantity. Refresh and inspect the stored balance before reconciling.`,
      )
    }

    return countedStock === trackedStock
      ? []
      : [{ item_id: item.id, counted_stock: countedStock }]
  })
}
