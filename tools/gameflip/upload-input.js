import { createHash } from 'node:crypto'
import { open, readFile, stat } from 'node:fs/promises'
import { dirname, extname, resolve } from 'node:path'

export class UploadError extends Error {
  constructor(message, { stop = false, uncertain = false } = {}) {
    super(message)
    this.stop = stop
    this.uncertain = uncertain
  }
}

export const TEMPLATE = Object.freeze({
  kind: 'item', category: 'DIGITAL_INGAME', platform: 'unknown', upc: 'unknown',
  accept_currency: 'USD', tags: Object.freeze(['id: other', 'type: Other']),
  digital: true, digital_region: 'none', digital_deliverable: 'transfer',
  shipping_within_days: 1, shipping_predefined_package: 'None', shipping_fee: 0,
  shipping_paid_by: 'seller', qty_purchased_min: 1, expire_in_days: 30, visibility: 'public',
})
export const LIMITS = Object.freeze({ items: 200, priceCents: 1_000_000, quantity: 10_000, imageBytes: 500_000 })
export const hash = (value) => createHash('sha256').update(value).digest('hex')
export const normalizeTitle = (value) => value.trim().toLowerCase()
const controls = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/

export function titleFor(item) {
  if (typeof item.name !== 'string' || !item.name.trim() || controls.test(item.name)) {
    throw new UploadError('name must be non-empty text without control characters.')
  }
  const name = item.name.trim().replace(/^Run A Restaurant\s*-\s*/i, '')
  const title = item.title === undefined ? `Run A Restaurant - ${name}` : item.title
  if (!name || typeof title !== 'string' || !title.trim() || title.trim().length > 120 || controls.test(title)) {
    throw new UploadError('title must contain 1–120 characters without control characters.')
  }
  return title.trim()
}

export function usdToCents(value) {
  if (!['number', 'string'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value))) {
    throw new UploadError('price_usd must be a USD decimal number or decimal string.')
  }
  const match = /^(\d{1,6})(?:\.(\d{1,2}))?$/.exec(String(value))
  if (!match) throw new UploadError('price_usd must have at most two decimal places; prices are never rounded.')
  const cents = BigInt(match[1]) * 100n + BigInt((match[2] || '').padEnd(2, '0'))
  if (cents < 1n || cents > BigInt(LIMITS.priceCents)) throw new UploadError('price_usd must be between $0.01 and $10,000.00 (tool safety cap).')
  return Number(cents)
}

export function validateEntry(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw new UploadError('Each entry must be a JSON object.')
  const allowed = new Set(['name', 'title', 'description', 'price_usd', 'qty_avail', 'image'])
  if (Object.keys(item).some((key) => !allowed.has(key))) throw new UploadError('Entry contains unsupported fields. Only name, title, description, price_usd, qty_avail and image are accepted.')
  const title = titleFor(item)
  if (typeof item.description !== 'string' || !item.description.trim() || item.description.length > 5000
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(item.description)) {
    throw new UploadError('description must be non-empty text, at most 5,000 characters. Its supplied text is preserved.')
  }
  if (!Number.isInteger(item.qty_avail) || item.qty_avail < 1 || item.qty_avail > LIMITS.quantity) {
    throw new UploadError('qty_avail must be an integer from 1 to 10,000 (tool safety cap).')
  }
  if (typeof item.image !== 'string' || !item.image.trim() || controls.test(item.image)
      || /^[a-z][a-z\d+.-]*:\/\//i.test(item.image) || /^(?:\\\\|\/\/)/.test(item.image)) {
    throw new UploadError('image must be a local file path, not a URL or network share.')
  }
  return {
    title, key: normalizeTitle(title), imagePath: item.image,
    payload: { ...TEMPLATE, tags: [...TEMPLATE.tags], name: title, description: item.description, price: usdToCents(item.price_usd), qty_avail: item.qty_avail },
  }
}

export async function loadInput(file) {
  let entries
  try {
    if (!(await stat(file)).isFile() || (await stat(file)).size > 1_000_000) throw Error()
    entries = JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''))
  } catch { throw new UploadError('Cannot read input JSON. Check the file, JSON syntax, and 1 MB size cap.', { stop: true }) }
  if (!Array.isArray(entries) || !entries.length || entries.length > LIMITS.items) {
    throw new UploadError('Input must be an array containing 1–200 entries.', { stop: true })
  }
  const result = entries.map((item, index) => {
    try { return { index, ...validateEntry(item) } }
    catch (error) { return { index, title: `Entry ${index + 1}`, error: error instanceof UploadError ? error.message : 'Invalid entry.' } }
  })
  const counts = new Map()
  // Even an otherwise invalid entry can collide with a valid title.
  for (const item of entries) {
    try { const key = normalizeTitle(titleFor(item)); counts.set(key, (counts.get(key) || 0) + 1) } catch { /* Already reported above. */ }
  }
  for (const entry of result) if (counts.get(entry.key) > 1) entry.error = 'Duplicate title inside input JSON; remove every duplicate except one.'
  return result
}

export async function loadImage(file, imagePath) {
  const path = resolve(dirname(resolve(file)), imagePath)
  const extension = extname(path).toLowerCase()
  if (!['.png', '.jpg', '.jpeg'].includes(extension)) throw new UploadError('Image must be PNG or JPEG.')
  let handle
  let bytes
  try {
    handle = await open(path, 'r')
    const info = await handle.stat()
    if (!info.isFile() || info.size < 1 || info.size > LIMITS.imageBytes) throw Error()
    // Bound the allocation even if a file changes while being read.
    const buffer = Buffer.alloc(LIMITS.imageBytes + 1)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    if (!bytesRead || bytesRead > LIMITS.imageBytes || bytesRead !== info.size) throw Error()
    bytes = buffer.subarray(0, bytesRead)
  } catch { throw new UploadError('Image missing, unreadable, empty, changed, or over 500,000 bytes.') }
  finally { await handle?.close() }
  const png = bytes.length >= 45 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
    && bytes.toString('ascii', 12, 16) === 'IHDR' && bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0
    && bytes.subarray(-12).equals(Buffer.from('0000000049454e44ae426082', 'hex'))
  const jpeg = bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217
  if ((extension === '.png' && !png) || (extension !== '.png' && !jpeg)) {
    throw new UploadError('Image content does not match a complete PNG/JPEG file. Re-export the image.')
  }
  return { bytes, digest: hash(bytes), contentType: png ? 'image/png' : 'image/jpeg' }
}

export function fingerprint(entry, images) {
  return hash(JSON.stringify({ payload: entry.payload, images: images.map((image) => image.digest) }))
}
