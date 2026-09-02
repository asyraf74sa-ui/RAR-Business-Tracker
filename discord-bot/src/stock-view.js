const EMBED_COLOR = 0x2f7d4a
const EMBED_DESCRIPTION_LIMIT = 3900
const AUTOCOMPLETE_CHOICE_LIMIT = 25
const AUTOCOMPLETE_TEXT_LIMIT = 100
const STOCK_KINDS = new Set(['item', 'currency'])

export function prepareStockItems(items) {
  return [...items]
    .filter((item) => item?.active === true && STOCK_KINDS.has(item.kind) && String(item.name || '').trim())
    .map((item) => ({ ...item, name: String(item.name).trim() }))
    .sort(compareItemNames)
}

export function formatStockQuantity(value) {
  const text = String(value).trim()
  const decimal = text.match(/^([+-]?)(\d+)(?:\.(\d+))?$/)

  if (decimal) {
    const sign = decimal[1] === '-' ? '-' : ''
    const integer = decimal[2].replace(/^0+(?=\d)/, '')
    const fraction = (decimal[3] || '').replace(/0+$/, '')
    const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    return `${sign}${grouped}${fraction ? `.${fraction}` : ''}`
  }

  const numeric = Number(value)
  if (!Number.isFinite(numeric)) throw new TypeError(`Invalid stock quantity: ${text || String(value)}`)
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 20 }).format(numeric)
}

export function findExactStockItem(items, requestedName) {
  const wanted = normalizeExactName(requestedName)
  if (!wanted) return null

  const matches = prepareStockItems(items).filter((item) => normalizeExactName(item.name) === wanted)
  return matches.length === 1 ? matches[0] : null
}

export function buildStockOverviewPages(
  items,
  { maxDescriptionLength = EMBED_DESCRIPTION_LIMIT } = {},
) {
  const stockItems = prepareStockItems(items)
  const lines = stockItems.map((item) => `${item.name} — ${formatStockQuantity(item.stock)}`)
  const descriptions = packLines(lines, maxDescriptionLength)

  return descriptions.map((description, index) => ({
    title: descriptions.length === 1
      ? '📦 RAR Stock Overview'
      : `📦 RAR Stock Overview (${index + 1}/${descriptions.length})`,
    description,
    color: EMBED_COLOR,
    footer: { text: 'Live, read-only inventory' },
  }))
}

export function buildStockItemPage(item) {
  const [stockItem] = prepareStockItems([item])
  if (!stockItem) return null

  return {
    title: `📦 ${stockItem.name}`,
    description: `Current stock: ${formatStockQuantity(stockItem.stock)}`,
    color: EMBED_COLOR,
    footer: { text: 'Live, read-only inventory' },
  }
}

export function buildStockAutocompleteChoices(items, focusedValue = '') {
  const focused = normalizeExactName(focusedValue)

  return prepareStockItems(items)
    .filter((item) => !focused || normalizeExactName(item.name).includes(focused))
    .filter((item) => item.name.length <= AUTOCOMPLETE_TEXT_LIMIT)
    .slice(0, AUTOCOMPLETE_CHOICE_LIMIT)
    .map((item) => ({ name: item.name, value: item.name }))
}

function packLines(lines, maxDescriptionLength) {
  if (!Number.isInteger(maxDescriptionLength) || maxDescriptionLength < 1 || maxDescriptionLength > 4096) {
    throw new RangeError('Stock embed description limit must be between 1 and 4096 characters.')
  }

  if (lines.length === 0) return ['No active RAR items were found.']

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
  return descriptions
}

function compareItemNames(left, right) {
  return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
    || left.name.localeCompare(right.name)
}

function normalizeExactName(value) {
  return String(value || '').trim().toLocaleLowerCase('en-US')
}
