export function buildStockReconciliationResults(events) {
  return [...events]
    .map((event) => {
      const counted = Number(event.balance_after)
      const delta = Number(event.quantity_delta)
      if (!Number.isFinite(counted) || !Number.isFinite(delta)) {
        throw new TypeError('Stock reconciliation event contains an invalid quantity.')
      }

      return {
        itemName: nestedItemName(event.item) || String(event.item_id || 'Unknown item'),
        before: counted - delta,
        counted,
        delta,
      }
    })
    .sort((a, b) => a.itemName.localeCompare(b.itemName, undefined, { sensitivity: 'base' }))
}

export function formatStockReconciliationLine(result) {
  const difference = result.delta === 0
    ? 'no change'
    : `${result.delta > 0 ? '+' : '-'}${formatQuantity(Math.abs(result.delta))}`
  return `${result.itemName}: ${formatQuantity(result.before)} → ${formatQuantity(result.counted)} (${difference})`
}

function nestedItemName(item) {
  if (Array.isArray(item)) return item[0]?.name || null
  return item?.name || null
}

function formatQuantity(value) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(value)
}
