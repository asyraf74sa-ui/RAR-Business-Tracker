import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { ALL_STATUSES, createClient, createRedactor, credentialsFromEnv, generateOtp, InspectorError } from './client.js'
import { compareListings, inspect, isRar, renderReport, selectSamples, splitListing } from './report.js'
import { parseArgs, runCli } from './inspect-listings.js'

// Public RFC 6238 SHA-1 test vector, not a Gameflip credential.
const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
const credentials = { apiKey: 'offline_fixture_key', otpSecret: secret }
const environment = { GAMEFLIP_API_KEY: credentials.apiKey, GAMEFLIP_OTP_SECRET: secret }
const owner = 'us-east-1:offline-owner'
const origin = 'https://production-gameflip.fingershock.com'
const success = (data, next_page) => ({ status: 'SUCCESS', data, ...(next_page !== undefined ? { next_page } : {}) })
const fixture = (id = 'listing-1', name = 'Piano', extra = {}) => ({
  id, owner, name: `Run A Restaurant - ${name}`, status: 'onsale',
  price: 125, category: 'DIGITAL_INGAME', platform: 'unknown', digital: true,
  digital_region: 'global', digital_deliverable: 'transfer', shipping_within_days: 1,
  tags: ['Game:Roblox', 'Product:Run A Restaurant'], description: 'Offline test description',
  photo: { 'photo-1': { view_url: 'https://example.invalid/piano.png', display_order: 0 } },
  quantity: 3, upc: 'offline-game-sku', ...extra,
})

// Always inject a fetch mock. No test may fall back to the live network.
function mockClient(responses, options = {}) {
  const requests = []
  const sleeps = []
  const client = createClient(credentials, {
    now: () => 59_000,
    sleep: async (ms) => { sleeps.push(ms) },
    ...options,
    fetchImpl: async (url, init) => {
      requests.push({ url: new URL(url), init })
      assert.equal(init.method, 'GET')
      assert.equal(init.redirect, 'error')
      assert.equal(init.body, undefined)
      assert.equal(new URL(url).origin, origin)
      assert.match(new URL(url).pathname, /^\/api\/v1\/(account\/me\/profile|listing(?:\/[A-Za-z0-9_-]+)?)$/)
      assert.equal(init.headers.Authorization, `GFAPI ${credentials.apiKey}:${generateOtp(secret, (options.now || (() => 59_000))())}`)
      assert.ok(init.signal instanceof AbortSignal)
      const response = responses.shift()
      assert.notEqual(response, undefined, 'Unexpected extra HTTP read')
      if (response instanceof Error) throw response
      return { ok: true, status: 200, json: async () => response, ...response.http }
    },
  })
  return { client, requests, sleeps }
}

async function cli(args, responses = [], extra = {}) {
  const mock = mockClient(responses)
  const out = []
  const err = []
  const code = await runCli(args, {
    env: environment, loadEnv: () => {}, makeClient: () => mock.client,
    stdout: (text) => out.push(text), stderr: (text) => err.push(text), ...extra,
  })
  return { code, out: out.join('\n'), err: err.join('\n'), ...mock }
}

test('TOTP matches RFC 6238 SHA-1 vectors with Gameflip six-digit truncation', () => {
  for (const [seconds, expected] of [[59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037'], [20000000000, '353130']]) {
    assert.equal(generateOtp(secret, seconds * 1000), expected)
  }
  assert.equal(generateOtp(secret.toLowerCase(), 59_000), '287082')
  assert.equal(generateOtp(secret, 59_999), '287082')
  assert.notEqual(generateOtp(secret, 60_000), '287082')
})

test('credentials fail locally, safely, before HTTP for missing/malformed/test values', () => {
  for (const env of [{}, { GAMEFLIP_API_KEY: 'do-not-print' }, { ...environment, GAMEFLIP_OTP_SECRET: '123456' }, { ...environment, GAMEFLIP_API_KEY: 'test-offline' }, { ...environment, GAMEFLIP_API_KEY: 'bad\r\nheader' }, { ...environment, GAMEFLIP_OTP_SECRET: 'AAAAAAAAAAAAAAAAA' }]) {
    assert.throws(() => credentialsFromEnv(env), InspectorError)
  }
  assert.deepEqual(credentialsFromEnv(environment), credentials)
})

test('CLI option validation never echoes secret-looking arguments', () => {
  assert.deepEqual(parseArgs(['--search', 'Dinosaur Fossil', '--raw', '--all-statuses']), { raw: true, allStatuses: true, search: 'Dinosaur Fossil' })
  for (const args of [['--id'], ['--search', ' '], ['--unknown-do-not-print'], ['--id', 'a', '--search', 'b'], ['--id', 'a', '--all-statuses'], ['--raw', '--raw'], ['--search', '--raw']]) {
    assert.throws(() => parseArgs(args), (error) => error instanceof InspectorError && !error.message.includes('do-not-print'))
  }
})

test('help does not load credentials or construct an HTTP client', async () => {
  const result = await cli(['--help'], [], { env: {}, loadEnv: () => { throw new Error('must not load') }, makeClient: () => { throw new Error('must not connect') } })
  assert.equal(result.code, 0)
  assert.match(result.out, /GET\/read only/)
  assert.equal(result.err, '')
})

test('missing credentials, malformed env files and unexpected errors never leak values', async () => {
  for (const extra of [{ env: {} }, { loadEnv: () => { throw new Error(secret) } }, { makeClient: () => { throw new Error(credentials.apiKey) } }]) {
    const result = await cli([], [], extra)
    assert.equal(result.code, 1)
    assert.equal(result.out, '')
    assert.ok(!result.err.includes(secret) && !result.err.includes(credentials.apiKey))
    assert.equal(result.requests.length, 0)
  }
})

test('pagination supports legacy/v2 shapes, preserves owner/status, and deduplicates IDs', async () => {
  const mock = mockClient([
    success({ owner, email: 'private@example.invalid' }),
    success([fixture()], '/api/v1/listing?after=first'),
    success({ listings: [fixture(), fixture('listing-2', 'Dinosaur Fossil')] }, '?after=second'),
    success({ listings: [], next_page: null }),
  ])
  const result = await mock.client.listings()
  assert.equal(result.length, 2)
  assert.equal(mock.requests.length, 4)
  for (const request of mock.requests.slice(1)) {
    assert.equal(request.url.searchParams.get('owner'), owner)
    assert.equal(request.url.searchParams.get('status'), 'onsale')
    assert.equal(request.url.searchParams.get('expiration'), 'now,')
    assert.equal(request.url.searchParams.get('v2'), 'true')
  }
  assert.deepEqual(mock.sleeps, [250, 250, 250])
})

test('all-statuses explicitly broadens both status and expiration scopes', async () => {
  const mock = mockClient([success({ owner }), success({ listings: [fixture('old', 'Piano', { status: 'sold', expiration: '2020-01-01T00:00:00.000Z' })] })])
  const result = await mock.client.listings({ allStatuses: true })
  assert.equal(result[0].status, 'sold')
  assert.equal(mock.requests[1].url.searchParams.get('status'), ALL_STATUSES)
  assert.equal(mock.requests[1].url.searchParams.get('expiration'), '1970-01-01T00:00:00.000Z,')
})

test('pagination rejects foreign origins, path changes, credentials, and changed scope', async () => {
  for (const next of [
    'https://example.invalid/api/v1/listing?after=x',
    '//example.invalid/api/v1/listing',
    'http://production-gameflip.fingershock.com/api/v1/listing',
    'https://user:password@production-gameflip.fingershock.com/api/v1/listing',
    '/api/v1/account/me/profile', '/api/v1/listing/some-id',
    '/api/v1/listing?owner=someone-else', '/api/v1/listing?owner=someone-else&owner=' + owner,
    '/api/v1/listing?status=sold', '/api/v1/listing?v2=false', '/api/v1/listing#fragment',
  ]) {
    const mock = mockClient([success({ owner }), success([fixture()], next)])
    await assert.rejects(mock.client.listings(), InspectorError)
    assert.equal(mock.requests.length, 2, 'No credentials sent to rejected URL')
  }
})

test('pagination loop and malformed response fail rather than silently truncate', async () => {
  for (const pages of [
    [success([], '/api/v1/listing?after=repeat'), success([], '/api/v1/listing?after=repeat')],
    [success({ unexpected: [] })], [success([], { cursor: 'bad' })],
    [success([{ name: 'no-id' }])], [success([fixture('x', 'Piano', { owner: 'another-owner' })])],
  ]) {
    const mock = mockClient([success({ owner }), ...pages])
    await assert.rejects(mock.client.listings(), InspectorError)
  }
})

test('empty and null response pages are valid and pagination still continues', async () => {
  for (const data of [null, [], { listings: [] }]) {
    const mock = mockClient([success({ owner }), success(data)])
    assert.deepEqual(await mock.client.listings(), [])
  }
  const mock = mockClient([success({ owner }), success(null, '?after=empty'), success([fixture()])])
  assert.equal((await mock.client.listings()).length, 1)
})

test('direct lookup validates IDs before network and confirms ownership after reading', async () => {
  for (const id of ['../profile', 'a/b', 'https://example.invalid', 'a?query=x', '.', '']) {
    const mock = mockClient([])
    await assert.rejects(mock.client.listing(id), InspectorError)
    assert.equal(mock.requests.length, 0)
  }
  for (const data of [fixture('x', 'Piano', { owner: 'another-owner' }), fixture('x', 'Piano', { owner: undefined }), fixture('wrong-id'), null]) {
    const mock = mockClient([success({ owner }), success(data)])
    await assert.rejects(mock.client.listing('x'), /confirm that this listing belongs/)
  }
  const mock = mockClient([success({ owner }), success(fixture('x', 'Other', { name: 'Other game', status: 'sold' }))])
  assert.equal((await mock.client.listing('x')).status, 'sold')
})

test('missing or ambiguous profile owner fails closed without listing reads', async () => {
  for (const data of [null, {}, { owner: 'x,y' }, { owner: 'x&v2=false' }]) {
    const mock = mockClient([success(data)])
    await assert.rejects(mock.client.listings(), /authenticated Gameflip listing owner/)
    assert.equal(mock.requests.length, 1)
  }
})

test('a fresh OTP is generated for each request', async () => {
  let time = 59_000
  const mock = mockClient([success({ owner }), success([])], { now: () => time, sleep: async () => { time = 61_000 } })
  await mock.client.listings()
  assert.notEqual(mock.requests[0].init.headers.Authorization, mock.requests[1].init.headers.Authorization)
})

test('authentication, permissions, missing listing, rate, server and network errors are safe', async () => {
  for (const [status, pattern] of [[401, /authentication failed/], [403, /denied access/], [404, /could not find/], [429, /rate limit/], [500, /temporarily unavailable/], [400, /rejected the read/], [302, /rejected the read/]]) {
    for (const response of [{ http: { ok: false, status, json: async () => { throw new Error(secret) } } }, { status: 'FAILURE', error: { code: status, message: secret } }]) {
      const mock = mockClient([response])
      await assert.rejects(mock.client.listings(), (error) => pattern.test(error.message) && !error.message.includes(secret))
      assert.equal(mock.requests.length, 1, 'No automatic retries')
    }
  }
  for (const response of [new Error(`fetch error ${secret}`), { http: { json: async () => { throw new Error(secret) } } }]) {
    const result = await cli([], [response])
    assert.equal(result.code, 1)
    assert.ok(!result.err.includes(secret))
    assert.equal(result.out, '')
  }
})

test('RAR titles include special gem formats without matching unrelated prefixes', () => {
  assert.equal(isRar(fixture()), true)
  assert.equal(isRar({ title: 'run a restaurant - 1K (1000) Diamonds Gems' }), true)
  assert.equal(isRar({ name: 'Run A Restaurant Guide' }), false)
  assert.equal(isRar({ name: 'Other - Run A Restaurant - Piano' }), false)
})

test('sample selection prefers requested products and avoids duplicate product titles', () => {
  const rows = ['Jukebox', 'Piano', 'Piano', 'Prep Kitchen', 'High Tech Stove', 'Host Station', 'Dinosaur Fossil'].map((name, index) => fixture(`id-${index}`, name))
  assert.deepEqual(selectSamples(rows).map((row) => row.name.replace('Run A Restaurant - ', '')), ['Dinosaur Fossil', 'Host Station', 'Prep Kitchen', 'Piano', 'High Tech Stove'])
})

test('comparison distinguishes equality, differences, missing/null and array order', () => {
  const a = fixture('a', 'Piano', { tags: ['a', 'b'], metadata: { game: 'Roblox', nested: { x: 1 } }, subcategory: null, seller_config: { active: true } })
  const b = fixture('b', 'Host Station', { tags: ['b', 'a'], metadata: { nested: { x: 1 }, game: 'Roblox' }, price: 200, quantity: 2 })
  const comparison = compareListings([a, b])
  assert.equal(comparison.settings.common.category, 'DIGITAL_INGAME')
  assert.deepEqual(comparison.settings.common.metadata, a.metadata)
  assert.ok(comparison.settings.differing.tags)
  assert.ok(comparison.settings.differing.subcategory)
  assert.ok(comparison.settings.differing.seller_config)
  assert.ok(comparison.item.differing.price)
  assert.ok(comparison.item.differing.quantity)
  assert.equal(comparison.settings.common.status, undefined)
  assert.equal(compareListings([a]).settings, undefined)
})

test('redaction removes credentials, nested secret keys, auth, signed URLs and terminal controls', () => {
  const redactor = createRedactor(credentials)
  redactor.rememberOtp('287082')
  const payload = { title: `Piano ${secret} ${credentials.apiKey} 287082`, api_key: 'hidden-key', nested: { otpSecret: 'hidden-secret', accessToken: 'hidden-token', digital_goods: ['hidden-code'], shipping_from_address_id: 'hidden-address' }, url: 'https://u:p@example.invalid/photo?id=hidden-query#hidden-fragment', description: '\u001b]0;spoof\u0007text', authorization: 'hidden-header' }
  const text = JSON.stringify(redactor.redact(payload))
  for (const hidden of [secret, credentials.apiKey, '287082', 'hidden-key', 'hidden-secret', 'hidden-token', 'hidden-code', 'hidden-address', 'hidden-query', 'hidden-fragment', 'hidden-header', '\\u001b', '\\u0007', 'u:p@']) assert.ok(!text.includes(hidden), hidden)
  assert.match(text, /example.invalid\/photo/)
  assert.equal(redactor.redact('GFAPI not-a-real-key:123456'), '[REDACTED AUTH]')
})

test('redacted placeholders cannot be mistaken for matching template settings', () => {
  const redactor = createRedactor(credentials)
  const result = compareListings([
    fixture('a', 'Piano', { seller_config: { token: 'first' }, metadata: { secret: 'first' } }),
    fixture('b', 'Host Station', { seller_config: { token: 'second' }, metadata: { secret: 'second' } }),
  ], redactor.redact)
  assert.equal(result.settings.common.seller_config, undefined)
  assert.equal(result.settings.common.metadata, undefined)
})

test('report keeps item, template candidates, lifecycle and unknown API fields separate', () => {
  const listing = fixture('a', 'Piano', { unknown_config: { material: 'wood' } })
  const groups = splitListing(listing)
  assert.equal(groups.item.price, 125)
  assert.equal(groups.settings.upc, 'offline-game-sku')
  assert.equal(groups.lifecycle.id, 'a')
  assert.deepEqual(groups.other.unknown_config, { material: 'wood' })
  const text = renderReport({ mode: 'onsale', listings: [listing], comparison: compareListings([listing]) })
  for (const fragment of ['ITEM-SPECIFIC FIELDS', 'TEMPLATE / SHARED SETTING CANDIDATES', 'LIFECYCLE / IDENTITY', 'OTHER API FIELDS', 'COMMON SETTINGS', '$1.25', 'photo-1', 'not exposed', 'shipping_within_days', 'offline-game-sku', 'Offline test description', 'quantity']) assert.ok(text.includes(fragment), fragment)
  const fx = renderReport({ mode: 'id', listings: [fixture('b', 'Piano', { currency: 'FLP' })], comparison: { sample: [] } })
  assert.match(fx, /conversion not assumed/)
})

test('search reads all pages, hydrates matched listings and compares other RAR samples', async () => {
  const a = fixture('a', 'Dinosaur Fossil')
  const b = fixture('b', 'Piano')
  const outsider = fixture('c', 'Other', { name: 'Another game' })
  const mock = mockClient([
    success({ owner }),
    success({ listings: [{ id: a.id, name: a.name }, outsider] }, '?after=first'),
    success({ listings: [{ id: b.id, name: b.name }] }),
    success(a), success(b),
  ])
  const result = await inspect(mock.client, { search: 'dinosaur fossil' })
  assert.equal(result.listings.length, 1)
  assert.equal(result.listings[0].description, a.description)
  assert.equal(result.comparison.sample.length, 2)
  assert.equal(mock.requests.length, 5)
  assert.match(renderReport(result), /Identical setting candidates/)
})

test('default reads all matching listing details, no unrelated listings', async () => {
  const a = fixture('a')
  const b = fixture('b', '1K (1000) Diamonds Gems')
  const result = await cli([], [success({ owner }), success([a, b, { id: 'other', name: 'Not RAR' }]), success(a), success(b)])
  assert.equal(result.code, 0)
  assert.match(result.out, /1K \(1000\) Diamonds Gems/)
  assert.equal(result.requests.length, 4)
})

test('listing changes during hydration stop the report rather than silently mixing games', async () => {
  const result = await cli([], [success({ owner }), success([fixture()]), success(fixture('listing-1', 'Piano', { name: 'Another game' }))])
  assert.equal(result.code, 1)
  assert.equal(result.out, '')
  assert.match(result.err, /listing changed/)
})

test('single-ID raw and table output redact secrets and never print the private profile', async () => {
  for (const args of [['--id', 'a'], ['--id', 'a', '--raw']]) {
    const row = fixture('a', 'Piano', { description: `${secret} ${credentials.apiKey} 287082`, access_token: 'hidden-listing-token', photo: { cover: { view_url: 'https://example.invalid/a?token=hidden-photo-token' } } })
    const result = await cli(args, [success({ owner, email: 'hidden-profile-email', data: 'hidden-profile-value' }), success(row)])
    assert.equal(result.code, 0)
    assert.equal(result.requests.length, 2)
    for (const hidden of [secret, credentials.apiKey, '287082', 'hidden-listing-token', 'hidden-photo-token', 'hidden-profile-email', 'hidden-profile-value']) assert.ok(!`${result.out}${result.err}`.includes(hidden), hidden)
    if (args.includes('--raw')) assert.equal(JSON.parse(result.out).listings[0].id, 'a')
  }
})

test('no listings is a clean success in table and raw modes', async () => {
  for (const args of [[], ['--raw']]) {
    const result = await cli(args, [success({ owner }), success(null)])
    assert.equal(result.code, 0)
    if (args.length) assert.deepEqual(JSON.parse(result.out).listings, [])
    else assert.match(result.out, /No matching Run A Restaurant listings found/)
  }
})

test('production utility contains only one fixed GET transport and no app/database integration', async () => {
  const paths = ['client.js', 'report.js', 'inspect-listings.js']
  const sources = await Promise.all(paths.map((path) => readFile(new URL(path, import.meta.url), 'utf8')))
  const source = sources.join('\n')
  assert.equal((source.match(/method:\s*'GET'/g) || []).length, 1)
  assert.equal((source.match(/await fetchImpl\(/g) || []).length, 1)
  assert.doesNotMatch(source, /method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i)
  assert.doesNotMatch(source, /supabase-js|discord\.js|\/digital_goods|\/publish|\/relist|\/deactivate/)
  assert.doesNotMatch(source, /process\.env\.VITE_|discord-bot\/\.env/)
})
