import { createHmac } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

const ORIGIN = 'https://production-gameflip.fingershock.com'
const LISTINGS_PATH = '/api/v1/listing'
const PROFILE_PATH = '/api/v1/account/me/profile'
const ID = /^[A-Za-z0-9_-]{1,200}$/
export const ALL_STATUSES = 'draft,prepare,ready,onsale,sale_pending,sold,cancelled'

// Messages are fixed locally. Never expose response bodies, headers or error causes.
export class InspectorError extends Error {}

function decodeSecret(secret) {
  if (typeof secret !== 'string') throw new InspectorError('Set GAMEFLIP_OTP_SECRET locally.')
  const normalized = secret.replace(/\s/g, '').toUpperCase()
  if (!/^[A-Z2-7]+={0,6}$/.test(normalized)) {
    throw new InspectorError('GAMEFLIP_OTP_SECRET must be the Base32 developer secret, not a six-digit OTP.')
  }
  const letters = normalized.replace(/=+$/, '')
  if (![0, 2, 4, 5, 7].includes(letters.length % 8)) {
    throw new InspectorError('GAMEFLIP_OTP_SECRET has an invalid Base32 length.')
  }
  const bytes = []
  let bits = 0
  let buffer = 0
  for (const letter of letters) {
    buffer = (buffer << 5) | 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(letter)
    bits += 5
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >>> bits) & 255)
      buffer &= (1 << bits) - 1
    }
  }
  if (bytes.length < 10 || buffer !== 0) throw new InspectorError('GAMEFLIP_OTP_SECRET is not a valid developer secret.')
  return Buffer.from(bytes)
}

// Gameflip's official SDK: Base32, HMAC-SHA1, six digits, 30-second step.
export function generateOtp(secret, time = Date.now()) {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(time / 30_000)))
  const digest = createHmac('sha1', decodeSecret(secret)).update(counter).digest()
  const offset = digest[digest.length - 1] & 15
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0')
}

export function credentialsFromEnv(env) {
  const apiKey = env.GAMEFLIP_API_KEY?.trim()
  const otpSecret = env.GAMEFLIP_OTP_SECRET?.trim()
  if (!apiKey || !otpSecret) {
    throw new InspectorError('Set GAMEFLIP_API_KEY and GAMEFLIP_OTP_SECRET in tools/gameflip/.env or your local environment. Do not paste them into chat.')
  }
  if (!/^[A-Za-z0-9_-]+$/.test(apiKey)) throw new InspectorError('GAMEFLIP_API_KEY has an invalid format.')
  if (/^(test|development)-/i.test(apiKey)) throw new InspectorError('Use a production Gameflip developer key; this inspector does not connect to test servers.')
  decodeSecret(otpSecret)
  return { apiKey, otpSecret }
}

export function isSensitiveField(key) {
  const compact = key.replace(/[^a-z0-9]/gi, '').toLowerCase()
  return /secret|token|password|passwd|authorization|cookie|apikey|privatekey|signature|credential|digitalgoods|digitalcode|redemption|redeemcode|shippingfromaddress|email|phone/.test(compact)
    || ['otp', 'code', 'codes', 'pin', 'totp', 'headers'].includes(compact)
}

export function createRedactor(credentials) {
  const secrets = new Set([credentials.apiKey, credentials.otpSecret, credentials.otpSecret.replace(/\s/g, '').toUpperCase()])
  function string(value) {
    let result = value
    for (const secret of secrets) if (secret) result = result.split(secret).join('[REDACTED]')
    result = result.replace(/GFAPI\s+[^\s"<>]+/gi, '[REDACTED AUTH]')
    // Photo URLs remain identifiable, but query strings/fragments may contain signed credentials.
    result = result.replace(/https?:\/\/[^\s"<>]+/gi, (text) => {
      try {
        const url = new URL(text)
        const hidden = url.username || url.password || url.search || url.hash
        url.username = ''
        url.password = ''
        url.search = ''
        url.hash = ''
        return url.href + (hidden ? '[REDACTED URL PARAMETERS]' : '')
      } catch { return '[REDACTED URL]' }
    })
    // Prevent API-controlled terminal escape sequences and bidi spoofing.
    return result.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '')
  }
  function redact(value) {
    if (typeof value === 'string') return string(value)
    if (Array.isArray(value)) return value.map(redact)
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [string(key), isSensitiveField(key) ? '[REDACTED]' : redact(item)]))
    }
    return value
  }
  return { redact, rememberOtp: (otp) => secrets.add(otp) }
}

function apiError(status) {
  if (status === 401) return new InspectorError('Gameflip authentication failed. Check the local API key, OTP secret, and Windows automatic date/time synchronization.')
  if (status === 403) return new InspectorError('Gameflip denied access. Check developer API permissions and the local key/OTP secret; only your own listings are supported.')
  if (status === 404) return new InspectorError('Gameflip could not find the requested resource. Check the listing ID and account access.')
  if (status === 429) return new InspectorError('Gameflip rate limit reached. Wait before running the inspector again; no changes were attempted.')
  if (status >= 500) return new InspectorError('Gameflip is temporarily unavailable. Try again later.')
  return new InspectorError('Gameflip rejected the read request. Check account access and options. The server response was withheld to protect secrets.')
}

function safeUrl(value, base = ORIGIN) {
  let url
  try { url = new URL(value, base) } catch { throw new InspectorError('Invalid Gameflip pagination URL; inspection stopped.') }
  if (url.origin !== ORIGIN || url.username || url.password || url.hash) {
    throw new InspectorError('Unsafe Gameflip URL blocked; credentials were not sent to it.')
  }
  return url
}

function validateId(id) {
  if (typeof id !== 'string' || !ID.test(id)) throw new InspectorError('Invalid listing ID. Supply only the listing identifier, not a URL.')
}

export function createClient(credentials, { fetchImpl = globalThis.fetch, now = Date.now, sleep = delay, redact = createRedactor(credentials) } = {}) {
  let requested = false
  let owner
  // Private transport: callers cannot choose an HTTP method, body, host or arbitrary endpoint.
  async function read(url) {
    url = safeUrl(url)
    if (url.pathname !== PROFILE_PATH && url.pathname !== LISTINGS_PATH
        && !/^\/api\/v1\/listing\/[A-Za-z0-9_-]{1,200}$/.test(url.pathname)) {
      throw new InspectorError('Non-inspection Gameflip endpoint blocked.')
    }
    if (requested) await sleep(250)
    requested = true
    const otp = generateOtp(credentials.otpSecret, now())
    redact.rememberOtp(otp)
    let response
    try {
      response = await fetchImpl(url.href, {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: `GFAPI ${credentials.apiKey}:${otp}` },
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
      })
    } catch {
      throw new InspectorError('Gameflip network request failed, timed out, or tried to redirect. Check connectivity and try again. No server details were logged.')
    }
    if (!response.ok) throw apiError(response.status)
    let body
    try { body = await response.json() } catch { throw new InspectorError('Gameflip returned an unreadable response; inspection stopped.') }
    if (!body || body.status !== 'SUCCESS') throw apiError(Number(body?.error?.code))
    return body
  }

  async function ownAccount() {
    if (owner) return owner
    const { data } = await read(PROFILE_PATH)
    if (typeof data?.owner !== 'string' || !/^[A-Za-z0-9:_-]+$/.test(data.owner)) {
      throw new InspectorError('Unable to establish the authenticated Gameflip listing owner; inspection stopped.')
    }
    owner = data.owner
    return owner
  }

  async function listings({ allStatuses = false } = {}) {
    const account = await ownAccount()
    const filters = {
      owner: account, v2: 'true', limit: '50',
      status: allStatuses ? ALL_STATUSES : 'onsale',
      expiration: allStatuses ? '1970-01-01T00:00:00.000Z,' : 'now,',
    }
    let url = new URL(LISTINGS_PATH, ORIGIN)
    Object.entries(filters).forEach(([key, value]) => url.searchParams.set(key, value))
    const visited = new Set()
    const found = new Map()
    while (url) {
      // Canonical ordering detects equivalent pagination loops too.
      url.searchParams.sort()
      if (visited.has(url.href) || visited.size >= 1000) throw new InspectorError('Gameflip pagination repeated or exceeded the safety limit. Results are incomplete; no report was produced.')
      visited.add(url.href)
      const body = await read(url)
      const rows = body.data === null || Array.isArray(body.data) ? body.data : body.data?.listings
      if (rows !== null && !Array.isArray(rows)) throw new InspectorError('Unexpected Gameflip listing response; inspection stopped rather than silently omitting records.')
      for (const listing of rows || []) {
        validateId(listing?.id)
        if (listing.owner != null && listing.owner !== account) throw new InspectorError('A listing did not match your authenticated account; inspection stopped.')
        found.set(listing.id, listing)
      }
      const next = body.next_page ?? body.data?.next_page
      if (next == null || next === '') break
      if (typeof next !== 'string') throw new InspectorError('Unexpected Gameflip pagination format; inspection stopped.')
      url = safeUrl(next, url)
      if (url.pathname !== LISTINGS_PATH) throw new InspectorError('Unexpected Gameflip pagination endpoint blocked.')
      // Preserve scope even when next_page contains only its cursor. Reject changed scope.
      for (const [key, value] of Object.entries(filters)) {
        if (url.searchParams.has(key) && url.searchParams.getAll(key).some((entry) => entry !== value)) {
          throw new InspectorError('Gameflip pagination changed the account or search filters; inspection stopped.')
        }
        url.searchParams.set(key, value)
      }
    }
    return [...found.values()]
  }

  async function listing(id) {
    validateId(id)
    const account = await ownAccount()
    const { data } = await read(`${LISTINGS_PATH}/${id}`)
    // Explicit ID lookup is never allowed to report someone else's publicly visible listing.
    if (data?.id !== id || data?.owner !== account) {
      throw new InspectorError('Could not confirm that this listing belongs to your authenticated account; no listing details were displayed.')
    }
    return data
  }

  return Object.freeze({ listings, listing, redact: redact.redact })
}
