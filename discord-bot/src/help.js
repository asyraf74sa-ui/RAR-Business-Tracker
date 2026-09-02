const EMBED_COLOR = 0x2f7d4a
const ITEM_DESCRIPTION_LIMIT = 3900

export const HELP_TOPICS = [
  { name: 'Overview', value: 'overview' },
  { name: 'Sales', value: 'sales' },
  { name: 'Purchases', value: 'purchase' },
  { name: 'Farming', value: 'farm' },
  { name: 'Trades', value: 'trade' },
  { name: 'Add stock', value: 'add' },
  { name: 'Stocktake / reconcile', value: 'stock' },
  { name: 'Valid item names', value: 'items' },
]

export function buildHelpPages(topic = 'overview', itemNames = []) {
  if (topic === 'items') return buildItemHelpPages(itemNames)

  const descriptions = {
    overview: [
      '**SALES — sales channel only**',
      '```text\nRAR - <quantity> <item>, <quantity> <item>\n<net amount> <currency>\n<platform fee> <currency> TAX\n<platform>\n```',
      '**PURCHASE — acquisition channel only**',
      '```text\nRAR PURCHASE - <quantity> <item>, <quantity> <item>\n<total purchase cost> <currency>\n```',
      '**FARM — acquisition channel only**',
      '```text\nRAR FARM - <number> CYCLE\n```',
      '**TRADE — acquisition channel only**',
      '```text\nRAR TRADE\nGIVE - <quantity> <item>\nRECEIVE - <quantity> <item>\n```',
      '**ADD STOCK — acquisition channel only**',
      '```text\nRAR ADD - <quantity> <item>, <quantity> <item>\n```',
      '**STOCKTAKE / RECONCILE — acquisition channel only**',
      '```text\nRAR STOCK - <count> <item>, <count> <item>\n```',
      '**ADD increases** the current quantity. **STOCK sets** the exact counted quantity.',
      'Choose the **Valid item names** topic to refresh and display every active canonical item name.',
    ].join('\n'),
    sales: [
      '**RAR sale**',
      '```text\nRAR - 3,000 GEMS, 1 PIANO\n12.42 US\n1.38 US TAX\nZEUSX\n```',
      'Records revenue and platform fee, then deducts the listed inventory. Post this only in the configured sales channel.',
    ].join('\n'),
    purchase: [
      '**Stock purchase**',
      '```text\nRAR PURCHASE - 5 HOST STATION, 2 GREENHOUSE\n336 PHP\n```',
      'Adds every listed item atomically and records the total cash cost exactly once. Post this only in the acquisition channel.',
    ].join('\n'),
    farm: [
      '**Farm claim**',
      '```text\nRAR FARM - 1 CYCLE\n```',
      'Uses the current RAR farm configuration and adds all active farm items atomically. Post this only in the acquisition channel.',
    ].join('\n'),
    trade: [
      '**In-game trade**',
      '```text\nRAR TRADE\nGIVE - 1 PIANO\nRECEIVE - 6,000 GEMS\n```',
      'GIVE decreases inventory and RECEIVE increases inventory in one atomic operation. It records no cash sale or purchase.',
    ].join('\n'),
    add: [
      '**Manual stock addition**',
      'Use this when you acquired inventory and simply want to **increase** the tracked quantity.',
      '```text\nRAR ADD - <quantity> <item>, <quantity> <item>\n```',
      '**Example**',
      '```text\nRAR ADD - 5 HOST STATION, 3 GREENHOUSE\n```',
      'Current 10 Host Station + ADD 5 = 15 Host Station.',
      'This does not record cash cost. For stock purchased with money, use `RAR PURCHASE` instead.',
    ].join('\n'),
    stock: [
      '**Stock reconciliation / physical count**',
      'Use this when you physically counted inventory and want to **set** the exact current quantity.',
      '```text\nRAR STOCK - <count> <item>, <count> <item>\n```',
      '**Example**',
      '```text\nRAR STOCK - 17 HOST STATION, 8 GREENHOUSE, 46,398 GEMS\n```',
      'If tracked Host Station stock was 10, `RAR STOCK - 17 HOST STATION` sets it to exactly 17. It does **not** add 17.',
      'Use this for stocktakes and corrections.',
    ].join('\n'),
  }

  return [{
    title: topic === 'overview' ? 'RAR Bot Help' : `RAR Bot Help — ${topic}`,
    description: descriptions[topic] || descriptions.overview,
    color: EMBED_COLOR,
  }]
}

export function buildItemHelpPages(itemNames, { maxDescriptionLength = ITEM_DESCRIPTION_LIMIT } = {}) {
  const names = [...itemNames].map(String).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  const lines = names.map((name) => `• ${name}`)
  const descriptions = []
  let current = ''

  for (const line of lines) {
    if (line.length > maxDescriptionLength) {
      throw new RangeError(`Item name is too long for a Discord embed: ${line.slice(0, 80)}`)
    }
    const candidate = current ? `${current}\n${line}` : line
    if (candidate.length > maxDescriptionLength) {
      descriptions.push(current)
      current = line
    } else {
      current = candidate
    }
  }

  if (current) descriptions.push(current)
  if (descriptions.length === 0) descriptions.push('No active RAR items were found.')

  return descriptions.map((description, index) => ({
    title: descriptions.length === 1
      ? 'Valid RAR Item Names'
      : `Valid RAR Item Names (${index + 1}/${descriptions.length})`,
    description,
    color: EMBED_COLOR,
    footer: { text: 'Live from the active Supabase item catalog' },
  }))
}
