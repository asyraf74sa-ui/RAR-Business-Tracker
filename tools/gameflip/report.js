import { isDeepStrictEqual } from 'node:util'
import { InspectorError, isSensitiveField } from './client.js'

export const isRar = (listing) => /^Run A Restaurant\s*-\s*/i.test(listing.name || listing.title || '')
const title = (listing) => listing.name || listing.title || '(name not exposed)'
const itemFields = new Set(['name', 'title', 'description', 'price', 'currency', 'photo', 'photos', 'images', 'image', 'cover_photo', 'quantity', 'stock', 'stock_quantity', 'quantity_available', 'available_quantity', 'num_available'])
const lifecycleFields = new Set(['id', 'owner', 'status', 'created', 'updated', 'expiration', 'onsale', 'version', 'views', 'likes', 'num_views', 'num_likes', 'statistics', 'exchange', 'exchange_id'])
const settingFields = new Set(['category', 'subcategory', 'sub_category', 'platform', 'digital', 'digital_region', 'digital_deliverable', 'shipping_within_days', 'tags', 'upc', 'sku', 'product', 'product_id', 'game', 'game_id', 'game_name', 'roblox', 'metadata', 'attributes', 'genre', 'kind', 'visibility', 'condition', 'accept_currency', 'delivery_method', 'delivery_time', 'region', 'seller', 'seller_config'])

export function splitListing(listing) {
  const groups = { item: {}, settings: {}, lifecycle: {}, other: {} }
  for (const [key, value] of Object.entries(listing)) {
    const group = itemFields.has(key) ? 'item' : lifecycleFields.has(key) ? 'lifecycle'
      : settingFields.has(key) || /^(digital_|shipping_|seller_|delivery_)/.test(key) ? 'settings' : 'other'
    Object.defineProperty(groups[group], key, { value, enumerable: true, configurable: true })
  }
  return groups
}

function productName(listing) {
  return title(listing).replace(/^Run A Restaurant\s*-\s*/i, '').trim().toLowerCase()
}

export function selectSamples(listings) {
  const rar = listings.filter(isRar)
  const chosen = []
  const usedNames = new Set()
  const add = (listing) => {
    if (listing && !usedNames.has(productName(listing)) && chosen.length < 5) {
      chosen.push(listing)
      usedNames.add(productName(listing))
    }
  }
  for (const name of ['Dinosaur Fossil', 'Host Station', 'Prep Kitchen', 'Piano', 'High Tech Stove']) {
    add(rar.find((listing) => productName(listing) === name.toLowerCase()))
  }
  rar.forEach(add)
  return chosen
}

function compareGroup(listings, group, redact) {
  const records = listings.map((listing) => splitListing(listing)[group])
  const fields = [...new Set(records.flatMap(Object.keys))].sort()
  const common = {}
  const differing = {}
  for (const key of fields) {
    if (isSensitiveField(key)) continue
    const values = records.map((record) => record[key])
    // Never claim that matching redaction placeholders demonstrate a common setting.
    if (values.some((value) => JSON.stringify(redact(value))?.includes('[REDACTED'))) continue
    if (records.every((record) => Object.hasOwn(record, key)) && values.every((value) => isDeepStrictEqual(value, values[0]))) {
      Object.defineProperty(common, key, { value: values[0], enumerable: true })
    } else {
      Object.defineProperty(differing, key, { value: listings.map((listing, index) => ({
        id: listing.id, present: Object.hasOwn(records[index], key), value: values[index],
      })), enumerable: true })
    }
  }
  return { common, differing }
}

export function compareListings(listings, redact = (value) => value) {
  const samples = selectSamples(listings)
  return {
    sample: samples.map((listing) => ({ id: listing.id, name: title(listing) })),
    ...(samples.length >= 2 ? {
      settings: compareGroup(samples, 'settings', redact),
      item: compareGroup(samples, 'item', redact),
      other: compareGroup(samples, 'other', redact),
    } : {}),
  }
}

export async function inspect(client, options, progress = () => {}) {
  if (options.id) {
    const listing = await client.listing(options.id)
    return { mode: 'id (any accessible status)', listings: [listing], comparison: compareListings([listing], client.redact) }
  }
  progress('Reading your listing pages (GET only)...')
  const all = await client.listings({ allStatuses: options.allStatuses })
  const rar = all.filter(isRar)
  const selected = rar.filter((listing) => !options.search || title(listing).toLowerCase().includes(options.search.toLowerCase()))
  if (!selected.length) return { mode: options.allStatuses ? 'all documented statuses' : 'onsale', listings: [], comparison: { sample: [] } }
  // Hydrate full details; search responses can contain only a subset of listing fields.
  const needed = new Map([...selected, ...selectSamples(rar)].map((listing) => [listing.id, listing]))
  const details = new Map()
  progress(`Reading ${needed.size} owned listing details (GET only)...`)
  for (const id of needed.keys()) {
    const detail = await client.listing(id)
    if (!isRar(detail)) throw new InspectorError('A listing changed while inspection was running. Run again for a consistent RAR report.')
    details.set(id, detail)
    if (details.size % 20 === 0) progress(`Read ${details.size} of ${needed.size} listing details...`)
  }
  return {
    mode: options.allStatuses ? 'all documented statuses' : 'onsale',
    listings: selected.map((listing) => details.get(listing.id)),
    comparison: compareListings(selectSamples(rar).map((listing) => details.get(listing.id)), client.redact),
  }
}

function display(value) {
  if (value === undefined) return '(not exposed)'
  if (value === null) return 'null'
  return (typeof value === 'string' ? value : JSON.stringify(value)).replace(/\r?\n/g, ' \\n ').replace(/\t/g, ' ').replace(/\|/g, '\\|')
}

function table(headers, rows) {
  return [headers, headers.map(() => '---'), ...rows].map((row) => `| ${row.map(display).join(' | ')} |`).join('\n')
}

function flatten(record, path = []) {
  return Object.entries(record).flatMap(([key, value]) => {
    const next = [...path, key]
    if (value && !Array.isArray(value) && typeof value === 'object' && Object.keys(value).length) return flatten(value, next)
    return [[next.map((part) => /^[a-zA-Z0-9_]+$/.test(part) ? part : `[${JSON.stringify(part)}]`).join('.'), value]]
  })
}

function fieldTable(record, expected = []) {
  const rows = flatten(record)
  for (const key of expected) if (!Object.hasOwn(record, key)) rows.push([key, undefined])
  return rows.length ? table(['Field', 'Value'], rows) : '(No fields exposed.)'
}

function price(listing) {
  if (typeof listing.price !== 'number') return listing.price
  if (listing.currency && listing.currency !== 'USD') return `${listing.price} (API units; conversion not assumed)`
  return `$${(listing.price / 100).toFixed(2)} (${listing.price} cents)`
}

export function renderReport(report) {
  const output = ['GAMEFLIP LISTING INSPECTOR — PHASE 1 / READ ONLY', `Scope: your account; ${report.mode}. No listing changes were requested.`]
  if (!report.listings.length) {
    output.push('No matching Run A Restaurant listings found in this scope. Try --all-statuses, a broader --search, or --id for an owned listing not returned by search.')
    return output.join('\n\n')
  }
  output.push(table(['Listing ID', 'Title', 'RAR?', 'Status', 'Price', 'Currency'], report.listings.map((listing) => [
    listing.id, title(listing), isRar(listing) ? 'yes' : 'no (explicit ID)', listing.status, price(listing), listing.currency ?? 'USD (documented price unit; currency field absent)',
  ])))
  for (const listing of report.listings) {
    const groups = splitListing(listing)
    output.push(`LISTING: ${display(title(listing))} [${display(listing.id)}]`)
    output.push('ITEM-SPECIFIC FIELDS\n' + fieldTable(groups.item, ['description', 'price', 'currency', 'photo', 'quantity']))
    output.push('TEMPLATE / SHARED SETTING CANDIDATES (not assumed shared)\n' + fieldTable(groups.settings, ['category', 'subcategory', 'platform', 'digital', 'digital_region', 'digital_deliverable', 'shipping_within_days', 'tags']))
    output.push('LIFECYCLE / IDENTITY (not template inputs)\n' + fieldTable(groups.lifecycle))
    if (Object.keys(groups.other).length) output.push('OTHER API FIELDS (unclassified; review before reuse)\n' + fieldTable(groups.other))
  }
  const comparison = report.comparison
  output.push('COMMON SETTINGS ACROSS RAR LISTINGS')
  if (!comparison.settings) {
    output.push('At least two distinct RAR products are required for comparison. Run without --id to compare available listings automatically.')
  } else {
    output.push(table(['Sample ID', 'Title'], comparison.sample.map((listing) => [listing.id, listing.name])))
    output.push('Identical setting candidates in this sample only:\n' + fieldTable(comparison.settings.common))
    for (const [group, label] of [['settings', 'Setting candidates'], ['item', 'Item-specific fields'], ['other', 'Other unclassified fields']]) {
      const rows = Object.entries(comparison[group].differing).flatMap(([key, values]) => values.map((entry) => [key, entry.id, entry.present ? entry.value : undefined]))
      output.push(`${label} that differ:\n` + (rows.length ? table(['Field', 'Listing ID', 'Value'], rows) : '(None in this sample.)'))
    }
    if (Object.keys(comparison.other.common).length) output.push('Other identical API fields (not confirmed template settings):\n' + fieldTable(comparison.other.common))
  }
  output.push('Missing fields are not inferred. Price is documented in USD cents; accept_currency is separate. digital=true/false means digital/physical. shipping_within_days=0 means automatic delivery. Array order is compared exactly. Redacted fields are excluded from comparison. This is not an atomic snapshot or a Phase 2 template.')
  return output.join('\n\n')
}
