const EMBED_COLOR = 0x2f7d4a
const ITEM_DESCRIPTION_LIMIT = 3900

export const HELP_TOPICS = [
  { name: 'Overview', value: 'overview' },
  { name: 'Sales', value: 'sales' },
  { name: 'Purchases', value: 'purchase' },
  { name: 'Farming', value: 'farm' },
  { name: 'Trades', value: 'trade' },
  { name: 'Add stock', value: 'add' },
  { name: 'Stock overview (read only)', value: 'stockoverview' },
  { name: 'Monthly financial reports', value: 'monthly' },
  { name: 'Stocktake / reconcile', value: 'stock' },
  { name: 'Valid item names', value: 'items' },
]

export function buildHelpPages(topic = 'overview', itemNames = []) {
  if (topic === 'items') {
    if (Array.isArray(itemNames)) return buildItemHelpPages(itemNames, { game: 'RAR' })
    return [
      ...buildItemHelpPages(itemNames.RAR || [], { game: 'RAR' }),
      ...buildItemHelpPages(itemNames.MR || [], { game: 'MR' }),
    ]
  }

  const descriptions = {
    overview: [
      '**SHARED SALES RECORD CHANNEL**',
      'Use `RAR - ...` or `MR - ...`; the prefix selects the game.',
      '```text\nMR - <quantity> <item>\n<net amount> <currency>\n<platform fee> <currency> TAX\n<platform>\n```',
      '**Platforms**',
      'Eldorado, ZeusX, Gameflip, PlayerAuctions, G2G, Itemku, PayPal, TNG, Direct.',
      '**RAR ACQUISITIONS CHANNEL**',
      '`RAR PURCHASE`, `RAR FARM`, `RAR TRADE`, `RAR ADD`, `RAR STOCK`',
      '**MR OPERATIONS CHANNEL**',
      '`MR PURCHASE`, `MR TRADE`, `MR ADD`, `MR STOCK`',
      '**FARM — RAR only**',
      '```text\nRAR FARM - <number> CYCLE\n```',
      '**STOCK OVERVIEW — read only, any channel**',
      '`/stock` or `/stock game:MR`',
      '`/stock` defaults to RAR. Each response contains only one game.',
      '`/stock` **reads** inventory only. `RAR STOCK - ...` and `MR STOCK - ...` **set/reconcile** exact inventory.',
      '**MONTHLY FINANCIAL OVERVIEW — read only, any channel**',
      '`/monthly game:RAR` or `/monthly game:MR`',
      '`/months game:RAR` or `/months game:MR`',
      'No game option defaults to RAR.',
      'Shows **Actual Wallet Credit**, **Platform Tax**, **Item Purchase Spending**, and **Net Profit** separately for USD / MYR / PHP / IDR.',
      '**ADD increases** quantity. **STOCK sets** the exact counted quantity. MR set aliases work only when configured for a confirmed family.',
      'Choose the **Valid item names** topic to refresh and display every active canonical item name.',
    ].join('\n'),
    sales: [
      '**RAR or MR sale — shared sales channel**',
      '```text\nMR - 1 ITEM NAME\n25.00 US\n0.50 US TAX\nPAYPAL\n```',
      'The first amount is the actual credit received. TAX/FEE is reported separately and is not subtracted again. Zero or nonzero fees are valid.',
      'TNG aliases include Touch n Go, Touch ‘n Go, Touch ‘n Go eWallet, and TNG eWallet.',
      '**MR shorthand**',
      '`MR - 1GXMAS 3 LUXTRAY 50M GEMS 1 DOM`',
      'Each quantity starts the next item; spaces after quantities and commas between items are optional. `1M`, `1 M`, or `1 MILLION` means 1,000,000 **MR Gems only**.',
      'Popular aliases include `GXMAS`, `GWELL`, `LUXTRAY`, `SNOW`, `RELIC`, `LT`, `INV WELL`, `MOAI`, and `HYPER ORDER`. Set aliases include `DOM`, `CORR`, `INV`, `CANDY`, and `ROYAL` (optionally followed by `SET`).',
      'Use the **Valid item names** topic for the full active canonical catalog. `MR STOCK` remains strict and does not accept sale shorthand or set aliases.',
    ].join('\n'),
    purchase: [
      '**Stock purchase**',
      '```text\nMR PURCHASE - 5 ITEM A, 2 ITEM B\n25 USD\n```',
      'RAR purchases go to the RAR acquisitions channel. MR purchases go to the MR Operations channel. Bundle cost is counted once.',
    ].join('\n'),
    farm: [
      '**Farm claim**',
      '```text\nRAR FARM - 1 CYCLE\n```',
      'Uses the current RAR farm configuration and adds all active farm items atomically. Post this only in the acquisition channel.',
    ].join('\n'),
    trade: [
      '**In-game trade**',
      '```text\nMR TRADE\nGIVE - 1 ITEM A\nRECEIVE - 2 ITEM B\n```',
      'GIVE decreases inventory and RECEIVE increases inventory in one atomic operation. It records no cash sale or purchase.',
    ].join('\n'),
    add: [
      '**Manual stock addition**',
      'Use this when you acquired inventory and simply want to **increase** the tracked quantity.',
      '```text\nRAR ADD - <quantity> <item>\nMR ADD - <quantity> <item>\n```',
      '**Example**',
      '```text\nRAR ADD - 5 HOST STATION, 3 GREENHOUSE\n```',
      'Current 10 Host Station + ADD 5 = 15 Host Station.',
      'This does not record cash cost. For stock purchased with money, use `RAR PURCHASE` instead.',
    ].join('\n'),
    stockoverview: [
      '**Stock overview**',
      '`/stock game:RAR` or `/stock game:MR`',
      'Shows live inventory for one game in a private response; omitted game defaults to RAR.',
      '**Optional specific item**',
      '`/stock game:RAR item:Piano`',
      'This command only **reads** inventory and does not modify stock.',
      'To set or correct exact stock quantities, post this in the acquisition channel:',
      '```text\nRAR STOCK - <count> <item>\n```',
    ].join('\n'),
    monthly: [
      '**Monthly financial reports — private and read only**',
      '`/monthly game:RAR` or `/monthly game:MR` — current Malaysia-calendar month',
      '`/monthly game:MR month:2026-09` — a specific month',
      '`/months game:RAR` or `/months game:MR` — every recorded month',
      '',
      '**Net Profit = Actual Wallet Credit − Item Purchase Spending**',
      'Platform Tax is displayed for reference and is **not subtracted again**, because Actual Wallet Credit is already the amount received after platform fees.',
      '',
      '**Example**',
      'Actual Wallet Credit: $100.00',
      'Platform Tax: $15.00',
      'Item Purchase Spending: $30.00',
      'Net Profit: $70.00 — not $55.00',
      '',
      'USD, MYR, PHP, and IDR are always reported separately and are never converted or combined.',
    ].join('\n'),
    stock: [
      '**Stock reconciliation / physical count**',
      'Use this when you physically counted inventory and want to **set** the exact current quantity.',
      '```text\nRAR STOCK - <count> <item>\nMR STOCK - <count> <item>\n```',
      '**Example**',
      '```text\nRAR STOCK - 17 HOST STATION, 8 GREENHOUSE, 46,398 GEMS\n```',
      'If tracked Host Station stock was 10, `RAR STOCK - 17 HOST STATION` sets it to exactly 17. It does **not** add 17.',
      'Use this for stocktakes and corrections.',
    ].join('\n'),
  }

  return [{
    title: topic === 'overview' ? 'RAR + MR Bot Help' : `RAR + MR Bot Help — ${topic}`,
    description: descriptions[topic] || descriptions.overview,
    color: EMBED_COLOR,
  }]
}

export function buildItemHelpPages(itemNames, { maxDescriptionLength = ITEM_DESCRIPTION_LIMIT, game = 'RAR' } = {}) {
  const names = [...itemNames].map(String).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  const lines = names.map((name) => `• ${name}`)
  const descriptions = []
  let current = game === 'MR'
    ? [
        '**MR shorthand**',
        'Sets: `CANDY` / `DOM` / `INV` / `CORR` / `ROYAL`',
        'Popular: `GXMAS`, `GWELL`, `LUXTRAY`, `SNOW`, `RELIC`, `LT`, `INV WELL`, `MOAI`, `HYPER ORDER`',
        'Gems: `1M` = 1,000,000 • `50M` = 50,000,000',
        '',
        '**Active canonical names**',
      ].join('\n')
    : ''

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
  if (descriptions.length === 0) descriptions.push(`No active ${game} items were found.`)

  return descriptions.map((description, index) => ({
    title: descriptions.length === 1
      ? `Valid ${game} Item Names`
      : `Valid ${game} Item Names (${index + 1}/${descriptions.length})`,
    description,
    color: EMBED_COLOR,
    footer: { text: 'Live from the active Supabase item catalog' },
  }))
}
