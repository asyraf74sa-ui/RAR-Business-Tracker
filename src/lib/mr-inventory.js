export const MR_STOCK_CATEGORIES = ['Furnitures', 'Appliances', 'Decorations']

export function isMrVirtualCurrencyItem(item) {
  const name = String(item?.name || '').trim().toLowerCase()
  const category = String(item?.category || '').trim().toLowerCase()
  return category === 'currency' || ['gems', 'gems (mr)', 'cash', 'cash (mr)', 'money', 'money (mr)'].includes(name)
}

export function mrVirtualCurrencyLabel(item) {
  const name = String(item?.name || '').trim()
  if (/^gems(?:\s*\(mr\))?$/i.test(name)) return 'Gems'
  if (/^(?:cash|money)(?:\s*\(mr\))?$/i.test(name)) return 'Money'
  return name
}

export function splitMrInventory(items, query = '') {
  const normalizedQuery = String(query).trim().toLowerCase()
  const matches = (item) => !normalizedQuery
    || `${item.name} ${(item.aliases || []).join(' ')}`.toLowerCase().includes(normalizedQuery)
  const active = (items || []).filter((item) => !item.is_archived && matches(item))

  return {
    categories: Object.fromEntries(MR_STOCK_CATEGORIES.map((category) => [
      category,
      active.filter((item) => !isMrVirtualCurrencyItem(item) && item.category === category)
        .sort((left, right) => left.name.localeCompare(right.name)),
    ])),
    virtualCurrencies: active.filter(isMrVirtualCurrencyItem)
      .sort((left, right) => mrVirtualCurrencyLabel(left).localeCompare(mrVirtualCurrencyLabel(right))),
  }
}
