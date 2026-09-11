import { setTimeout as delay } from 'node:timers/promises'
import { ALL_STATUSES, createRedactor, generateOtp } from './client.js'
import { TEMPLATE, UploadError } from './upload-input.js'

const ORIGIN = 'https://production-gameflip.fingershock.com'
const PATH = '/api/v1/listing'
export const EXPIRATION_RANGE = '1970-01-01T00:00:00.000Z,9999-12-31T23:59:59.999Z'
const id = (value) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(value)) throw new UploadError('Invalid Gameflip resource identifier.', { stop: true })
  return value
}
function apiUrl(value, base = ORIGIN) {
  let url
  try { url = new URL(value, base) } catch { throw new UploadError('Invalid API URL.', { stop: true }) }
  if (url.origin !== ORIGIN || url.username || url.password || url.hash) throw new UploadError('Foreign or unsafe API URL blocked.', { stop: true })
  return url
}

export function retryDelay(headers, attempt, now) {
  const retry = headers.get('retry-after')
  let wait = 0
  if (retry) wait = /^\d+(?:\.\d+)?$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - now
  const reset = headers.get('x-ratelimit-reset')
  if (headers.get('x-ratelimit-remaining') === '0' && reset && /^\d+(?:\.\d+)?$/.test(reset)) {
    wait = Math.max(wait || 0, Number(reset) * 1000 - now)
  }
  return Math.max(1000 * 2 ** attempt, Number.isFinite(wait) ? wait : 0)
}

export function createUploadClient(credentials, {
  execute = false, confirmed = false, fetchImpl = globalThis.fetch, sleep = delay,
  now = Date.now, redactor = createRedactor(credentials), onDebug = () => {},
} = {}) {
  let owner
  let lastRequest = -Infinity
  let lastPost = -Infinity
  let nextAllowed = 0
  const allocations = new Map()
  const writeGuard = () => {
    if (!execute || !confirmed) throw new UploadError('Live writes require --execute and --confirm UPLOAD.', { stop: true })
  }
  function failure(status, method, uncertain = false) {
    const options = { stop: uncertain || [401, 403, 429].includes(status), uncertain }
    if (method === 'PUT' && [401, 403].includes(status)) return new UploadError('Image storage rejected the upload authorization. Draft retained; rerun to allocate a fresh photo URL.')
    if ([401, 403].includes(status)) return new UploadError('Gameflip authentication/access failed. Check local credentials, permissions and automatic clock synchronization.', options)
    if (status === 429) return new UploadError('Gameflip rate limit reached; batch stopped. Wait before retrying.', options)
    if ([409, 412, 422].includes(status)) return new UploadError('Gameflip rejected validation or concurrent modification. Review the retained draft before retrying.', options)
    if (uncertain) return new UploadError('Creation outcome is uncertain. No automatic re-create will occur; inspect Gameflip and the recovery journal first.', options)
    return new UploadError(method === 'PUT' ? 'Image upload rejected or unavailable.' : 'Gameflip request rejected or unavailable; response details withheld.', options)
  }

  async function request(url, method = 'GET', body, extraHeaders = {}, storage = false) {
    if (method !== 'GET') writeGuard()
    for (let attempt = 0; attempt < 4; attempt++) {
      const wait = Math.max(0, lastRequest + 250 - now(), nextAllowed - now(), method === 'POST' ? lastPost + 21_000 - now() : 0)
      if (wait > 60_000) throw new UploadError('Server requests a wait longer than 60 seconds. Batch stopped; wait before retrying.', { stop: true })
      if (wait) await sleep(wait)
      lastRequest = now()
      if (method === 'POST') lastPost = now()
      const headers = { ...extraHeaders }
      if (!storage) {
        const otp = generateOtp(credentials.otpSecret, now())
        redactor.rememberOtp(otp)
        headers.Accept = 'application/json'
        headers.Authorization = `GFAPI ${credentials.apiKey}:${otp}`
      }
      onDebug(`${method} ${storage ? 'signed photo storage (URL withheld)' : new URL(url).pathname} attempt ${attempt + 1}`)
      let response
      let envelope
      try {
        response = await fetchImpl(url, { method, headers, body, redirect: 'error', signal: AbortSignal.timeout(20_000) })
        if (response.ok && !storage) envelope = await response.json()
      } catch {
        // POST is not idempotent. A lost response may conceal a successfully created listing/photo.
        if (method === 'POST') throw failure(0, method, true)
        if (attempt === 3) throw new UploadError('Network request failed or timed out; remote details withheld.', { stop: method === 'GET' })
        await sleep(1000 * 2 ** attempt)
        continue
      }
      const rateWait = retryDelay(response.headers, 0, now())
      if (response.headers.has('retry-after') || response.headers.get('x-ratelimit-remaining') === '0') nextAllowed = now() + rateWait
      if (response.ok && (storage || envelope?.status === 'SUCCESS')) return storage ? undefined : envelope
      const status = response.ok ? Number(envelope?.error?.code) : response.status
      const transient = status === 429 || status >= 500
      // A definite 429 rejection can be retried. 5xx/non-JSON POST outcomes cannot.
      if (method === 'POST' && status !== 429 && (status >= 500 || !Number.isFinite(status) || status < 400)) throw failure(status, method, true)
      if (transient && attempt < 3) {
        const waitForRetry = retryDelay(response.headers, attempt, now())
        if (waitForRetry > 60_000) throw new UploadError('Server requests a wait longer than 60 seconds. Batch stopped; wait before retrying.', { stop: true })
        await sleep(waitForRetry)
        continue
      }
      throw failure(status, method)
    }
  }
  async function account() {
    if (owner) return owner
    const { data } = await request(`${ORIGIN}/api/v1/account/me/profile`)
    if (typeof data?.owner !== 'string' || !/^[A-Za-z0-9:_-]{1,200}$/.test(data.owner)) throw new UploadError('Cannot establish the authenticated owner.', { stop: true })
    owner = data.owner
    return owner
  }
  async function listings() {
    const filters = { owner: await account(), v2: 'true', limit: '50', status: ALL_STATUSES, expiration: EXPIRATION_RANGE }
    let url = apiUrl(PATH)
    const visited = new Set()
    const found = new Map()
    while (url) {
      if (url.pathname !== PATH) throw new UploadError('Unexpected pagination endpoint.', { stop: true })
      const allowed = new Set([...Object.keys(filters), 'after', 'start', 'last_key', 'sort'])
      for (const key of url.searchParams.keys()) if (!allowed.has(key)) throw new UploadError('Unexpected pagination filter; duplicate scan stopped.', { stop: true })
      for (const [key, value] of Object.entries(filters)) {
        if (url.searchParams.getAll(key).some((existing) => existing !== value)) throw new UploadError('Pagination changed account/search scope.', { stop: true })
        url.searchParams.set(key, value)
      }
      url.searchParams.sort()
      if (visited.has(url.href) || visited.size >= 1000) throw new UploadError('Duplicate scan incomplete: pagination loop or safety limit.', { stop: true })
      visited.add(url.href)
      const response = await request(url.href)
      const rows = response.data === null || Array.isArray(response.data) ? response.data : response.data?.listings
      if (rows !== null && !Array.isArray(rows)) throw new UploadError('Unknown search response; duplicate scan is incomplete.', { stop: true })
      for (const row of rows || []) {
        id(row?.id)
        if (row.owner !== undefined && row.owner !== filters.owner) throw new UploadError('Search returned a different owner.', { stop: true })
        // Unnamed drafts cannot collide with a nonempty title, but are still counted and retained.
        if (row.name !== undefined && typeof row.name !== 'string') throw new UploadError('Unexpected listing title type.', { stop: true })
        found.set(row.id, row)
      }
      const next = response.next_page ?? response.data?.next_page
      if (next == null || next === '') break
      if (typeof next !== 'string') throw new UploadError('Invalid pagination cursor.', { stop: true })
      url = apiUrl(next, url)
    }
    return [...found.values()]
  }
  async function listing(listingId) {
    const own = await account()
    const { data } = await request(`${ORIGIN}${PATH}/${id(listingId)}`)
    if (data?.id !== listingId || data.owner !== own) throw new UploadError('Cannot verify listing ownership; batch stopped.', { stop: true })
    return data
  }
  async function createDraft(payload) {
    writeGuard()
    const allowed = new Set([...Object.keys(TEMPLATE), 'name', 'description', 'price', 'qty_avail'])
    if (Object.keys(payload).some((key) => !allowed.has(key)) || JSON.stringify(redactor.redact(payload)) !== JSON.stringify(payload)) {
      throw new UploadError('Unsafe create payload blocked.', { stop: true })
    }
    const response = await request(`${ORIGIN}${PATH}`, 'POST', JSON.stringify({ ...payload, status: 'draft' }), { 'Content-Type': 'application/json' })
    try { id(response.data?.id) } catch { throw failure(0, 'POST', true) }
    return response.data.id
  }
  async function allocatePhoto(listingId) {
    const { data } = await request(`${ORIGIN}${PATH}/${id(listingId)}/photo`, 'POST')
    id(data?.id)
    let url
    try { url = new URL(data.upload_url) } catch { throw new UploadError('Photo allocation returned no valid upload URL.') }
    // Official workflow uses S3. Reject unexpected storage hosts instead of guessing.
    const s3 = /^(?:[a-z0-9.-]+\.)?s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/i.test(url.hostname)
    if (!s3 || url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443')) {
      throw new UploadError('Unexpected photo storage destination; draft retained for review.')
    }
    allocations.set(data.id, url.href)
    return { id: data.id, url: url.href }
  }
  async function uploadPhoto(allocation, image) {
    writeGuard()
    if (allocations.get(allocation.id) !== allocation.url) throw new UploadError('Photo upload was not allocated by this run.', { stop: true })
    await request(allocation.url, 'PUT', image.bytes, { 'Content-Type': image.contentType }, true)
  }
  async function patch(listingId, snapshot, changes) {
    if (snapshot.id !== listingId || snapshot.owner !== await account() || !['draft', 'prepare', 'ready'].includes(snapshot.status)) {
      throw new UploadError('Refusing to mutate a foreign or non-draft listing.', { stop: true })
    }
    if (!/^[0-9]+$/.test(String(snapshot.version))) throw new UploadError('No valid listing version; cannot protect against concurrent changes.')
    const conditions = [{ op: 'test', path: '/status', value: snapshot.status }]
    await request(`${ORIGIN}${PATH}/${id(listingId)}`, 'PATCH', JSON.stringify([...conditions, ...changes]), {
      'Content-Type': 'application/json-patch+json', 'If-Match': `"${snapshot.version}"`,
    })
  }
  async function attachPhoto(listingId, photoId, snapshot) {
    id(photoId)
    if (!Object.hasOwn(snapshot.photo || {}, photoId)) throw new UploadError('Allocated photo is absent from this draft.')
    await patch(listingId, snapshot, [
      { op: 'replace', path: `/photo/${photoId}/status`, value: 'active' },
      { op: 'replace', path: `/photo/${photoId}/display_order`, value: 0 },
      { op: 'replace', path: '/cover_photo', value: photoId },
    ])
  }
  async function publish(listingId, snapshot) {
    await patch(listingId, snapshot, [{ op: 'replace', path: '/status', value: 'onsale' }])
  }
  return Object.freeze({ account, listings, listing, createDraft, allocatePhoto, uploadPhoto, attachPhoto, publish, redact: redactor.redact })
}
