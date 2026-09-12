import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRedactor } from './client.js'
import { TEMPLATE, LIMITS, UploadError, hash, titleFor, normalizeTitle, usdToCents, validateEntry, loadInput, loadImage } from './upload-input.js'
import { createUploadClient, EXPIRATION_RANGE, retryDelay } from './upload-api.js'
import { acquireLock, openJournal } from './upload-state.js'
import { planUpload, runUpload, verifyFields, verifyPhoto } from './upload-runner.js'
import { parseUploadArgs, runUploadCli } from './upload-listings.js'

// Public RFC 6238 vector and dummy key, never the local .env or a real account.
const credentials = { apiKey: 'offline_mock_key', otpSecret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' }
const owner = 'offline:owner'
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jO9sAAAAASUVORK5CYII=', 'base64')
const input = (name = 'Golden Chair') => ({ name, description: ' Exact supplied text.\nSecond line. ', price_usd: 1.55, qty_avail: 20, image: './product.png' })
const noImage = (name) => { const item = input(name); delete item.image; return item }
const success = (data, extra = {}) => new Response(JSON.stringify({ status: 'SUCCESS', data, ...extra }), { status: 200, headers: { 'Content-Type': 'application/json' } })
const reject = (status, headers = {}) => new Response('Remote body deliberately withheld', { status, headers })

test('draft offer update preserves description/photo and uses conditional version protection', async () => {
  const record = { id: 'bundle-draft', owner, status: 'draft', version: '1', name: 'Run A Restaurant - Small Tip Jar', price: 50, qty_avail: 3, description: 'Approved', cover_photo: 'existing-photo' }
  const mock = mockApi({ existing: [record] })
  const offer = { name: 'Run A Restaurant - 2x Small Tip Jar', price: 100, qty_avail: Math.ceil(record.qty_avail / 2) }
  await mock.api.updateDraftOffer(record.id, await mock.api.listing(record.id), offer)
  const updated = mock.records.get(record.id)
  assert.equal(updated.qty_avail, 2)
  assert.equal(updated.price, 100)
  assert.equal(updated.name, offer.name)
  assert.equal(updated.description, record.description)
  assert.equal(updated.cover_photo, record.cover_photo)
  assert.equal(updated.status, 'draft')
  const patch = mock.calls.find(c => c.method === 'PATCH')
  assert.deepEqual(JSON.parse(patch.options.body).slice(0, 2), [{ op: 'test', path: '/status', value: 'draft' }, { op: 'test', path: '/version', value: '1' }])
})

test('draft offer update rejects extra fields, invalid quantities and published listings', async () => {
  const record = { id: 'bundle-draft', owner, status: 'onsale', version: '1' }
  const mock = mockApi({ existing: [record] })
  const offer = { name: 'Run A Restaurant - 2x Taco Chair', price: 100, qty_avail: 33 }
  const snapshot = await mock.api.listing(record.id)
  for (const invalid of [{ ...offer, description: 'filler' }, { ...offer, qty_avail: 0 }, { ...offer, qty_avail: 1.5 }, { ...offer, price: 1.1 }]) {
    await assert.rejects(mock.api.updateDraftOffer(record.id, snapshot, invalid), /Invalid draft offer/)
  }
  await assert.rejects(mock.api.updateDraftOffer(record.id, snapshot, offer), /non-draft/)
  assert.equal(mock.mutations().length, 0)
})

async function fixture(t, items = [input()]) {
  const directory = await mkdtemp(join(tmpdir(), 'gameflip-offline-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await writeFile(join(directory, 'product.png'), png)
  const file = join(directory, 'listings.json')
  await writeFile(file, JSON.stringify(items))
  const entries = await loadInput(file)
  const runs = join(directory, 'runs')
  return { directory, file, entries, runs, journal: await openJournal(runs, owner) }
}

function mockApi({ existing = [], hook = () => undefined, execute = true, confirmed = true } = {}) {
  const records = new Map(existing.map((item) => [item.id, structuredClone(item)]))
  const calls = []
  const sleeps = []
  let clock = 60_000
  let sequence = 0
  let photoSequence = 0
  const api = createUploadClient(credentials, {
    execute, confirmed, now: () => clock, sleep: async (time) => { sleeps.push(time); clock += time },
    fetchImpl: async (url, options) => {
      const parsed = new URL(url)
      const call = { url, path: parsed.pathname, options, method: options.method }
      calls.push(call)
      assert.equal(options.redirect, 'error')
      const override = await hook(call, records, calls)
      if (override !== undefined) return override
      if (parsed.hostname === 'bucket.s3.amazonaws.com') {
        assert.equal(options.method, 'PUT')
        assert.equal(options.headers.Authorization, undefined)
        assert.deepEqual(options.body, png)
        return new Response('', { status: 200 })
      }
      assert.equal(parsed.origin, 'https://production-gameflip.fingershock.com')
      assert.match(options.headers.Authorization, /^GFAPI offline_mock_key:\d{6}$/)
      if (parsed.pathname === '/api/v1/account/me/profile') return success({ owner })
      if (parsed.pathname === '/api/v1/listing' && options.method === 'GET') {
        assert.equal(parsed.searchParams.get('owner'), owner)
        assert.equal(parsed.searchParams.get('expiration'), EXPIRATION_RANGE)
        return success([...records.values()])
      }
      if (parsed.pathname === '/api/v1/listing' && options.method === 'POST') {
        const data = JSON.parse(options.body)
        const listing = { ...data, id: `new-${++sequence}`, owner, version: '1', photo: {} }
        records.set(listing.id, listing)
        return success({ id: listing.id })
      }
      const match = /^\/api\/v1\/listing\/([^/]+)(\/photo)?$/.exec(parsed.pathname)
      assert.ok(match, 'Unexpected mock endpoint; no global fetch fallback exists.')
      const listing = records.get(match[1])
      if (!listing) return reject(404)
      if (options.method === 'GET') return success(listing)
      if (options.method === 'POST' && match[2]) {
        const photoId = `photo-${++photoSequence}`
        listing.photo[photoId] = { status: 'pending', view_url: `https://production-gameflipusercontent.fingershock.com/${listing.id}/${photoId}` }
        listing.version = String(Number(listing.version) + 1)
        return success({ id: photoId, upload_url: `https://bucket.s3.amazonaws.com/${listing.id}/${photoId}?signature=do-not-log` })
      }
      if (options.method === 'PATCH') {
        assert.equal(options.headers['Content-Type'], 'application/json-patch+json')
        if (options.headers['If-Match'] !== String(listing.version)) return reject(412)
        for (const patch of JSON.parse(options.body)) {
          const fields = patch.path.slice(1).split('/')
          let current = listing
          for (const field of fields.slice(0, -1)) current = current[field]
          const key = fields.at(-1)
          if (patch.op === 'test') { if (current[key] !== patch.value) return reject(412) }
          else current[key] = patch.value
        }
        listing.version = String(Number(listing.version) + 1)
        return success({ id: listing.id })
      }
      assert.fail('Unexpected mock mutation')
    },
  })
  return { api, calls, records, sleeps, mutations: () => calls.filter((call) => call.method !== 'GET') }
}

async function runFixture(context, mock, options = {}) {
  const logs = []
  const plan = await planUpload(context.entries, { ...context, api: mock.api, ...options })
  const report = await runUpload(plan, { api: mock.api, journal: context.journal, execute: true, confirmed: true, log: (line) => logs.push(line), ...options })
  return { plan, report, logs }
}

test('title generation, override and normalization', () => {
  assert.equal(titleFor(input()), 'Run A Restaurant - Golden Chair')
  assert.equal(titleFor(input('Run A Restaurant - Dinosaur Fossil')), 'Run A Restaurant - Dinosaur Fossil')
  assert.equal(titleFor({ ...input(), title: ' Special title ' }), 'Special title')
  assert.equal(normalizeTitle('  RUN A RESTAURANT - Golden Chair  '), 'run a restaurant - golden chair')
  assert.equal(validateEntry(input()).payload.description, input().description)
})

for (const etag of ['"7"', 'W/"7"']) {
  test(`conditional publish uses raw document version with returned ETag ${etag}`, async () => {
    const mutations = []
    const api = createUploadClient(credentials, { execute: true, confirmed: true, sleep: async () => {},
      fetchImpl: async (url, options) => {
        if (url.endsWith('/account/me/profile')) return success({ owner })
        if (options.method === 'GET') return new Response(JSON.stringify({ status: 'SUCCESS', data: {
          id: 'etag-draft', owner, status: 'draft', version: '7',
        } }), { headers: { 'Content-Type': 'application/json', ETag: etag } })
        mutations.push(options)
        return success({ id: 'etag-draft' })
      },
    })
    const snapshot = await api.listing('etag-draft')
    await api.publish('etag-draft', snapshot)
    assert.equal(mutations.length, 1)
    assert.equal(mutations[0].headers['If-Match'], '7')
    assert.deepEqual(JSON.parse(mutations[0].body), [
      { op: 'test', path: '/status', value: 'draft' },
      { op: 'test', path: '/version', value: '7' },
      { op: 'replace', path: '/status', value: 'onsale' },
    ])
  })
}

for (const etag of ['W/"8"', '*', 'garbage']) {
  test(`mismatched or unsafe ETag ${etag} blocks mutations`, async () => {
    const api = createUploadClient(credentials, { execute: true, confirmed: true, sleep: async () => {},
      fetchImpl: async (url, options) => {
        assert.equal(options.method, 'GET')
        if (url.endsWith('/account/me/profile')) return success({ owner })
        return new Response(JSON.stringify({ status: 'SUCCESS', data: { id: 'etag-draft', owner, status: 'draft', version: '7' } }),
          { headers: { 'Content-Type': 'application/json', ETag: etag } })
      },
    })
    await assert.rejects(api.publish('etag-draft', await api.listing('etag-draft')), /ETag does not match/)
  })
}

for (const [start, sentAt] of [[60_500, 62_000], [89_500, 92_000], [75_000, 75_000]]) {
  test(`OTP boundary guard sends at a safe point: ${start}`, async () => {
    let clock = start
    const api = createUploadClient(credentials, { now: () => clock, otpWindowGuardMs: 2000,
      sleep: async (milliseconds) => { clock += milliseconds },
      fetchImpl: async (_url, options) => {
        assert.equal(options.method, 'GET')
        assert.equal(clock, sentAt)
        return success({ owner })
      },
    })
    assert.equal(await api.account(), owner)
  })
}

test('OTP boundary guard rejects invalid configuration', () => {
  for (const otpWindowGuardMs of [-1, 3001, 1.5, '2000']) {
    assert.throws(() => createUploadClient(credentials, { otpWindowGuardMs }), /Invalid OTP boundary guard/)
  }
})

test('invalid version-header configuration is rejected', () => {
  assert.throws(() => createUploadClient(credentials, { versionHeaderFormat: 'none' }), /Invalid version header/)
})

test('only explicitly blank descriptions permit an omitted API field', () => {
  verifyFields({}, { description: '' })
  verifyFields({ description: '' }, { description: '' })
  for (const description of [null, ' ', 'unexpected', 0]) {
    assert.throws(() => verifyFields({ description }, { description: '' }), /description/)
  }
  assert.throws(() => verifyFields({}, { description: 'approved text' }), /description/)
  assert.throws(() => verifyFields({}, { name: '' }), /name/)
})

test('omitted blank description publishes and resumes without filler or replacement', async (t) => {
  const ctx = await fixture(t, [{ ...input(), description: '' }])
  let blockPublish = true
  const mock = mockApi({ hook: (call, records) => {
    if (call.method === 'GET' && call.path === '/api/v1/listing/new-1') delete records.get('new-1').description
    if (call.method === 'PATCH' && JSON.parse(call.options.body).some(p => p.path === '/status' && p.op === 'replace') && blockPublish) return reject(400)
  } })
  assert.equal((await runFixture(ctx, mock)).report.summary.failed, 1)
  blockPublish = false
  assert.equal((await runFixture(ctx, mock)).report.summary.created, 1)
  assert.equal(mock.records.size, 1)
  assert.equal(mock.records.get('new-1').description, undefined)
  const post = mock.calls.find(call => call.method === 'POST' && call.path === '/api/v1/listing')
  assert.equal(JSON.parse(post.options.body).description, '')
})
for (const [value, cents] of [[1.55, 155], [5, 500], [50, 5000], [1.8, 180], ['10.00', 1000], [0.29, 29], ['0.01', 1]]) {
  test(`exact USD cents: ${value}`, () => assert.equal(usdToCents(value), cents))
}
for (const value of [1.555, '1.555', '1e2', -1, 0, Infinity, NaN, null, true, {}, '1.', ' 1.55', '10000.01']) {
  test(`reject unsafe price ${String(value)}`, () => assert.throws(() => usdToCents(value), UploadError))
}
for (const qty of [0, -1, 1.2, '12', null, 10_001]) {
  test(`reject invalid quantity ${String(qty)}`, () => assert.throws(() => validateEntry({ ...input(), qty_avail: qty }), UploadError))
}
test('template uses exact observed fields and string-array tags', () => {
  assert.deepEqual(TEMPLATE.tags, ['id: other', 'type: Other'])
  assert.deepEqual(validateEntry(input()).payload, { ...TEMPLATE, name: 'Run A Restaurant - Golden Chair', description: input().description, price: 155, qty_avail: 20 })
  for (const extras of [{ status: 'onsale' }, { photo: {} }, { api_key: 'secret' }, { owner: 'someone' }, { description: undefined }, { title: '\u001b[31m' }, { image: 'https://host/x.png' }, { image: '\\\\server\\x.png' }]) {
    assert.throws(() => validateEntry({ ...input(), ...extras }), UploadError)
  }
})
test('JSON validation, duplicate input blocking including invalid counterpart, BOM', async (t) => {
  const ctx = await fixture(t, [input(), { ...input(' golden chair '), qty_avail: 0 }])
  assert.match(ctx.entries[0].error, /Duplicate title/)
  assert.ok(ctx.entries[1].error)
  await writeFile(ctx.file, '\uFEFF' + JSON.stringify([input()]))
  assert.equal((await loadInput(ctx.file)).length, 1)
  for (const text of ['{', '{}', '[]', JSON.stringify(Array(201).fill(input()))]) {
    await writeFile(ctx.file, text)
    await assert.rejects(loadInput(ctx.file), UploadError)
  }
})
test('local image path is relative to JSON and rejects missing/empty/oversize/wrong type', async (t) => {
  const ctx = await fixture(t)
  assert.equal((await loadImage(ctx.file, './product.png')).digest, hash(png))
  await assert.rejects(loadImage(ctx.file, './missing.png'), /Image missing/)
  for (const buffer of [Buffer.alloc(0), Buffer.alloc(LIMITS.imageBytes + 1), Buffer.from('not a PNG')]) {
    await writeFile(join(ctx.directory, 'bad.png'), buffer)
    await assert.rejects(loadImage(ctx.file, './bad.png'), UploadError)
  }
  await mkdir(join(ctx.directory, 'folder.png'))
  await assert.rejects(loadImage(ctx.file, './folder.png'), UploadError)
  await assert.rejects(loadImage(ctx.file, './product.gif'), /PNG or JPEG/)
  await writeFile(join(ctx.directory, 'wrong.jpg'), png)
  await assert.rejects(loadImage(ctx.file, './wrong.jpg'), /does not match/)
})
test('dry-run performs zero POST, PATCH, PUT or journal writes', async (t) => {
  const ctx = await fixture(t)
  ctx.journal.save = async () => assert.fail('Dry-run must not write state')
  const mock = mockApi({ execute: false, confirmed: false })
  const { report } = await runFixture(ctx, mock, { execute: false, confirmed: false })
  assert.equal(report.summary.wouldCreate, 1)
  assert.equal(mock.mutations().length, 0)
})

test('image omission is valid but explicit empty, null and invalid paths are not', () => {
  const entry = validateEntry(noImage())
  assert.equal(entry.imagePath, undefined)
  assert.ok(!('photo' in entry.payload) && !('cover_photo' in entry.payload))
  for (const image of ['', ' ', null, false, 3, {}, 'https://host/product.png']) {
    assert.throws(() => validateEntry({ ...noImage(), image }), UploadError)
  }
})

test('explicit empty description is preserved; missing, non-text and unsafe descriptions fail', () => {
  assert.equal(validateEntry({ ...noImage(), description: '' }).payload.description, '')
  for (const description of [undefined, null, false, 1, {}, 'x'.repeat(5001), 'bad\u0000text']) {
    assert.throws(() => validateEntry({ ...noImage(), description }), UploadError)
  }
})

test('29 no-image entries dry-run without image access, stock clamping or any writes', async (t) => {
  const quantities = [2, 14, 2, 2, 2, 2, 2, 5, 2, 2, 3, 2, 2, 5, 6, 2, 117, 2, 3, 66, 6, 2, 491, 507, 282, 146, 30, 48, 179]
  const ctx = await fixture(t, quantities.map((qty_avail, index) => ({ ...noImage(`Fixture ${index}`), qty_avail, description: index < 8 ? '' : 'Supplied description.' })))
  ctx.journal.save = () => assert.fail('Dry-run cannot write the journal')
  const mock = mockApi({ execute: false, confirmed: false })
  const { plan, report, logs } = await runFixture(ctx, mock, { execute: false, confirmed: false, readImage: () => assert.fail('No image file should be accessed') })
  assert.deepEqual(plan.plans.map((entry) => entry.payload.qty_avail), quantities)
  assert.ok(plan.plans.every((entry) => entry.images.length === 0))
  assert.deepEqual(report.summary, { created: 0, draftsCreated: 0, wouldCreate: 29, wouldResume: 0, skipped: 0, invalid: 0, failed: 0, notAttempted: 0 })
  assert.equal(mock.mutations().length, 0)
  assert.equal(logs.filter((line) => line.includes('no image (photo workflow omitted)')).length, 29)
})

test('mock no-image creation skips all photo allocation, upload and cover patches', async (t) => {
  const ctx = await fixture(t, [noImage()])
  const mock = mockApi()
  const { report } = await runFixture(ctx, mock)
  assert.equal(report.summary.created, 1)
  assert.deepEqual(mock.mutations().map((call) => [call.method, call.path]), [['POST', '/api/v1/listing'], ['PATCH', '/api/v1/listing/new-1']])
  const payload = JSON.parse(mock.mutations()[0].options.body)
  assert.ok(!('photo' in payload) && !('cover_photo' in payload))
  assert.deepEqual(mock.records.get('new-1').photo, {})
  assert.equal(mock.records.get('new-1').cover_photo, undefined)
  assert.equal(ctx.journal.get(ctx.entries[0].key).photoId, undefined)
  assert.equal(ctx.journal.get(ctx.entries[0].key).stage, 'published')
})

test('mixed mock batch uploads only the explicitly supplied image', async (t) => {
  const ctx = await fixture(t, [noImage('No image'), input('With image')])
  const mock = mockApi()
  assert.equal((await runFixture(ctx, mock)).report.summary.created, 2)
  assert.equal(mock.calls.filter((call) => call.path.endsWith('/photo')).length, 1)
  assert.equal(mock.calls.filter((call) => call.method === 'PUT').length, 1)
  assert.equal(mock.records.get('new-1').cover_photo, undefined)
  verifyPhoto(mock.records.get('new-2'), 'photo-1')
})

test('explicit missing image still prevents creation after making images optional', async (t) => {
  const ctx = await fixture(t, [{ ...input(), image: './missing.png' }])
  const mock = mockApi()
  const { report } = await runFixture(ctx, mock)
  assert.equal(report.summary.invalid, 1)
  assert.equal(mock.mutations().length, 0)
})

test('no-image publish rejection retains and resumes the same mock draft without photos', async (t) => {
  const ctx = await fixture(t, [noImage()])
  let rejectPublish = true
  const mock = mockApi({ hook: (call) => call.method === 'PATCH' && rejectPublish ? reject(400) : undefined })
  const first = await runFixture(ctx, mock)
  assert.equal(first.report.summary.failed, 1)
  assert.equal(mock.records.get('new-1').status, 'draft')
  assert.equal(ctx.journal.get(ctx.entries[0].key).stage, 'publish_pending')
  rejectPublish = false
  ctx.journal = await openJournal(ctx.runs, owner)
  const second = await runFixture(ctx, mock)
  assert.equal(second.report.summary.created, 1)
  assert.equal(mock.calls.filter((call) => call.method === 'POST').length, 1)
  assert.ok(mock.calls.every((call) => !call.path.endsWith('/photo') && call.method !== 'PUT'))
})

test('no-image recovery confirms a previous mock publish using GET only', async (t) => {
  const ctx = await fixture(t, [noImage()])
  const mock = mockApi()
  const plan = await planUpload(ctx.entries, { ...ctx, api: mock.api })
  const id = 'previous'
  mock.records.set(id, { ...plan.plans[0].payload, id, owner, status: 'onsale', version: '2' })
  await ctx.journal.save(ctx.entries[0].key, { title: ctx.entries[0].title, fingerprint: plan.plans[0].fingerprint, listingId: id, stage: 'publish_pending' })
  const { report } = await runFixture(ctx, mock)
  assert.equal(report.summary.created, 1)
  assert.equal(report.summary.draftsCreated, 0)
  assert.equal(mock.mutations().length, 0)
})

test('adding or removing an image cannot bypass recovery fingerprint verification', async (t) => {
  for (const originallyWithImage of [true, false]) {
    const ctx = await fixture(t, [originallyWithImage ? input() : noImage()])
    const mock = mockApi({ hook: (call) => ['PUT', 'PATCH'].includes(call.method) ? reject(400) : undefined })
    assert.equal((await runFixture(ctx, mock)).report.summary.failed, 1)
    ctx.entries = [{ index: 0, ...validateEntry(originallyWithImage ? noImage() : input()) }]
    const before = mock.mutations().length
    const { report } = await runFixture(ctx, mock)
    assert.equal(report.summary.invalid, 1)
    assert.match(report.results[0].reason, /Input or image changed/)
    assert.equal(mock.mutations().length, before)
  }
})

test('server rejection of an empty description never generates replacement text or retries creation', async (t) => {
  const ctx = await fixture(t, [{ ...noImage(), description: '' }])
  const mock = mockApi({ hook: (call) => call.method === 'POST' ? reject(400) : undefined })
  const { report } = await runFixture(ctx, mock)
  assert.equal(report.summary.failed, 1)
  assert.equal(mock.mutations().length, 1)
  assert.equal(JSON.parse(mock.mutations()[0].options.body).description, '')
  assert.equal(ctx.journal.get(ctx.entries[0].key).stage, 'create_rejected')
})
test('confirmation and transport independently gate every write', async (t) => {
  const ctx = await fixture(t)
  const mock = mockApi({ confirmed: false })
  await assert.rejects(runFixture(ctx, mock, { confirmed: false }), /Confirmation missing/)
  await assert.rejects(mock.api.createDraft(validateEntry(input()).payload), /--confirm UPLOAD/)
  await assert.rejects(mock.api.allocatePhoto('fake'), /--confirm UPLOAD/)
  await assert.rejects(mock.api.uploadPhoto({}, {}), /--confirm UPLOAD/)
  assert.equal(mock.mutations().length, 0)
})
test('explicit live flags complete mocked draft/photo/verify/publish flow', async (t) => {
  const ctx = await fixture(t)
  const mock = mockApi()
  const { report, logs } = await runFixture(ctx, mock)
  assert.equal(report.summary.created, 1)
  const record = mock.records.get('new-1')
  assert.equal(record.status, 'onsale')
  verifyFields(record, validateEntry(input()).payload)
  verifyPhoto(record, 'photo-1')
  const creates = mock.calls.filter((call) => call.method === 'POST' && call.path === '/api/v1/listing')
  assert.equal(creates.length, 1)
  assert.equal(JSON.parse(creates[0].options.body).status, 'draft')
  assert.ok(mock.sleeps.some((time) => time >= 20_000))
  assert.match(logs[0], /LIVE GAMEFLIP UPLOAD/)
  assert.match(logs[1], /1 new listings will be created/)
  assert.equal(ctx.journal.get(ctx.entries[0].key).stage, 'published')
})
test('existing title (any status) skips, even without local image', async (t) => {
  const ctx = await fixture(t, [{ ...input(), image: './missing.png' }])
  for (const status of ['draft', 'sold', 'onsale', 'cancelled']) {
    const mock = mockApi({ existing: [{ id: 'existing', name: ' RUN A RESTAURANT - GOLDEN CHAIR ', owner, status, expiration: '2020-01-01T00:00:00Z' }] })
    const { report } = await runFixture(ctx, mock)
    assert.equal(report.summary.skipped, 1)
    assert.equal(mock.mutations().length, 0)
  }
})
test('allow-duplicate opt-in does not override journal or duplicate JSON guards', async (t) => {
  const ctx = await fixture(t)
  const mock = mockApi({ existing: [{ id: 'existing', name: titleFor(input()), owner, status: 'onsale' }] })
  assert.equal((await runFixture(ctx, mock, { allowDuplicate: true })).report.summary.created, 1)
  const before = mock.mutations().length
  assert.equal((await runFixture(ctx, mock, { allowDuplicate: true })).report.summary.skipped, 1)
  assert.equal(mock.mutations().length, before)
  const duplicate = await fixture(t, [input(), input()])
  const second = mockApi()
  assert.equal((await runFixture(duplicate, second, { allowDuplicate: true })).report.summary.invalid, 2)
  assert.equal(second.mutations().length, 0)
})
test('immediate pre-create scan catches a newly appeared duplicate', async (t) => {
  const ctx = await fixture(t)
  let scans = 0
  const mock = mockApi({ hook: (call, records) => {
    if (call.method === 'GET' && call.path === '/api/v1/listing' && ++scans === 2) records.set('race', { id: 'race', name: titleFor(input()), owner })
  } })
  assert.equal((await runFixture(ctx, mock)).report.summary.skipped, 1)
  assert.equal(mock.mutations().length, 0)
})
test('image failure retains draft, continues independent item and safely resumes same ID', async (t) => {
  const ctx = await fixture(t, [input(), input('Clown Chair')])
  let failUpload = true
  const mock = mockApi({ hook: (call) => {
    if (call.method === 'PUT' && call.path.startsWith('/new-1/') && failUpload) return reject(400)
  } })
  const first = await runFixture(ctx, mock)
  assert.equal(first.report.summary.failed, 1)
  assert.equal(first.report.summary.created, 1)
  assert.equal(first.report.results[0].listingId, 'new-1')
  assert.equal(first.report.results[0].stage, 'upload image')
  assert.equal(mock.records.get('new-1').status, 'draft')
  failUpload = false
  // Reload disk journal: recovery must not depend on the original process.
  ctx.journal = await openJournal(ctx.runs, owner)
  const second = await runFixture(ctx, mock)
  assert.equal(second.report.summary.created, 1)
  assert.equal(second.report.summary.skipped, 1)
  assert.equal(mock.calls.filter((call) => call.method === 'POST' && call.path === '/api/v1/listing').length, 2)
  assert.equal(mock.records.get('new-1').status, 'onsale')
  assert.notEqual(mock.records.get('new-1').cover_photo, mock.records.get('new-2').cover_photo)
})
test('ambiguous create is never automatically retried, blocks later items and reruns', async (t) => {
  const ctx = await fixture(t, [input(), input('Clown Chair')])
  const mock = mockApi({ hook: (call) => { if (call.method === 'POST') throw Error('lost response containing secret') } })
  const first = await runFixture(ctx, mock)
  assert.equal(first.report.summary.failed, 1)
  assert.equal(first.report.summary.notAttempted, 1)
  assert.equal(mock.mutations().length, 1)
  assert.equal(ctx.journal.get(ctx.entries[0].key).stage, 'create_pending')
  const second = await runFixture(ctx, mock)
  assert.equal(second.report.summary.invalid, 1)
  assert.equal(second.report.summary.notAttempted, 1)
  assert.equal(mock.mutations().length, 1)
})
test('500 after POST is ambiguous; explicit 400 is not retried and permits independent item', async (t) => {
  for (const status of [500, 400]) {
    const ctx = await fixture(t, [input(), input('Clown Chair')])
    const mock = mockApi({ hook: (call) => {
      if (call.method === 'POST' && call.path === '/api/v1/listing' && JSON.parse(call.options.body).name === titleFor(input())) return reject(status)
    } })
    const { report } = await runFixture(ctx, mock)
    assert.equal(report.summary.failed, 1)
    assert.equal(report.summary.created, status === 400 ? 1 : 0)
    assert.equal(mock.calls.filter((call) => call.method === 'POST' && call.path === '/api/v1/listing').length, status === 400 ? 2 : 1)
    assert.equal(ctx.journal.get(ctx.entries[0].key).stage, status === 400 ? 'create_rejected' : 'create_pending')
  }
})
test('stock/template/description mismatch prevents image upload and publication', async (t) => {
  for (const field of ['qty_avail', 'qty_purchased_min', 'tags', 'description', 'accept_currency']) {
    const ctx = await fixture(t)
    const mock = mockApi({ hook: (call, records) => {
      if (call.path === '/api/v1/listing/new-1' && call.method === 'GET') delete records.get('new-1')[field]
    } })
    const { report } = await runFixture(ctx, mock)
    assert.equal(report.summary.failed, 1)
    assert.match(report.results[0].reason, new RegExp(field))
    assert.equal(mock.mutations().length, 1)
  }
})
test('missing cover blocks publish, and concurrent version change rejects PATCH', async (t) => {
  const ctx = await fixture(t)
  const mock = mockApi({ hook: (call, records) => {
    if (call.method === 'GET' && records.get('new-1')?.cover_photo) records.get('new-1').cover_photo = 'wrong'
  } })
  assert.equal((await runFixture(ctx, mock)).report.summary.failed, 1)
  assert.equal(mock.records.get('new-1').status, 'draft')
  const concurrent = await fixture(t)
  const raced = mockApi({ hook: (call, records) => {
    if (call.method === 'PATCH') records.get('new-1').version = '999'
  } })
  assert.equal((await runFixture(concurrent, raced)).report.summary.failed, 1)
  assert.equal(raced.records.get('new-1').status, 'draft')
})
test('changed input after partial failure refuses a replacement listing', async (t) => {
  const ctx = await fixture(t)
  const mock = mockApi({ hook: (call) => call.method === 'PUT' ? reject(400) : undefined })
  await runFixture(ctx, mock)
  ctx.entries[0].payload.qty_avail = 21
  const before = mock.mutations().length
  assert.equal((await runFixture(ctx, mock)).report.summary.invalid, 1)
  assert.equal(mock.mutations().length, before)
})
test('lost publish response recovers by GET without creating or publishing again', async (t) => {
  const ctx = await fixture(t)
  let lost = true
  const mock = mockApi({ hook: (call, records) => {
    if (lost && call.method === 'PATCH' && JSON.parse(call.options.body).some((patch) => patch.value === 'onsale')) {
      records.get('new-1').status = 'onsale'
      throw Error('Response lost')
    }
  } })
  assert.equal((await runFixture(ctx, mock)).report.summary.failed, 1)
  lost = false
  const before = mock.mutations().length
  assert.equal((await runFixture(ctx, mock)).report.summary.created, 1)
  assert.equal(mock.mutations().length, before)
})
test('journal write failure before create sends no mutations and stops batch', async (t) => {
  const ctx = await fixture(t, [input(), input('Clown Chair')])
  ctx.journal.save = async () => { throw new UploadError('Disk full', { stop: true }) }
  const mock = mockApi()
  const { report } = await runFixture(ctx, mock)
  assert.equal(report.summary.failed, 1)
  assert.equal(report.summary.notAttempted, 1)
  assert.equal(mock.mutations().length, 0)
})
test('journal stores only recovery fields, account scoped; locks and corruption fail closed', async (t) => {
  const ctx = await fixture(t)
  await runFixture(ctx, mockApi())
  const raw = await readFile(join(ctx.runs, `${hash(owner)}.state.json`), 'utf8')
  for (const forbidden of [credentials.apiKey, credentials.otpSecret, 'signature=', 'upload_url', input().description, 'Authorization']) assert.ok(!raw.includes(forbidden))
  assert.equal((await openJournal(ctx.runs, 'different-owner')).get(ctx.entries[0].key), undefined)
  const release = await acquireLock(ctx.runs, owner)
  await assert.rejects(acquireLock(ctx.runs, owner), /lock/)
  await release()
  await (await acquireLock(ctx.runs, owner))()
  await writeFile(join(ctx.runs, `${hash(owner)}.state.json`), '{bad')
  await assert.rejects(openJournal(ctx.runs, owner), /journal/)
})
test('paginated duplicate scan preserves owner/status/expiration and includes late-page duplicate', async () => {
  let page = 0
  const mock = mockApi({ hook: (call) => {
    if (call.path === '/api/v1/listing') {
      page++
      assert.equal(new URL(call.url).searchParams.get('expiration'), EXPIRATION_RANGE)
      return page === 1 ? success([{ id: 'one', owner }], { next_page: '?start=50' }) : success([{ id: 'two', owner, name: titleFor(input()), status: 'draft' }])
    }
  } })
  assert.equal((await mock.api.listings()).length, 2)
  assert.equal(page, 2)
})
for (const next of ['https://evil.example/api/v1/listing', '?owner=foreign', '?status=onsale', '?expiration=now,', '/api/v1/listing/one/photo', '?term=restrict', '?start=50']) {
  test(`unsafe/incomplete pagination fails closed: ${next}`, async () => {
    const mock = mockApi({ hook: (call) => call.path === '/api/v1/listing' ? success([], { next_page: next }) : undefined })
    await assert.rejects(mock.api.listings(), UploadError)
    assert.ok(mock.calls.every((call) => new URL(call.url).hostname !== 'evil.example'))
    assert.equal(mock.mutations().length, 0)
  })
}
test('malformed search rows and foreign detailed listings fail closed', async () => {
  for (const rows of [{ unknown: [] }, [{ id: 'bad/id' }], [{ id: 'valid', owner: 'other' }]]) {
    const mock = mockApi({ hook: (call) => call.path === '/api/v1/listing' ? success(rows) : undefined })
    await assert.rejects(mock.api.listings(), UploadError)
  }
  const mock = mockApi({ existing: [{ id: 'foreign', owner: 'other' }] })
  await assert.rejects(mock.api.listing('foreign'), /ownership/)
})
test('429, Retry-After, exponential backoff, fresh OTP; permanent failures are not retried', async () => {
  let reads = 0
  const mock = mockApi({ hook: (call) => {
    if (call.path.endsWith('/profile') && ++reads <= 2) return reject(reads === 1 ? 429 : 503, { 'Retry-After': reads === 1 ? '30' : '2' })
  } })
  assert.equal(await mock.api.account(), owner)
  assert.equal(reads, 3)
  assert.ok(mock.sleeps.includes(30_000))
  assert.notEqual(mock.calls[0].options.headers.Authorization, mock.calls[1].options.headers.Authorization)
  const invalid = mockApi({ hook: () => reject(400) })
  await assert.rejects(invalid.api.account(), UploadError)
  assert.equal(invalid.calls.length, 1)
  assert.equal(retryDelay(new Headers({ 'Retry-After': 'Thu, 01 Jan 1970 00:01:30 GMT' }), 0, 60_000), 30_000)
  assert.equal(retryDelay(new Headers({ 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': '95' }), 0, 60_000), 35_000)
})
test('explicit 429 on create backs off, auth and exhausted rate limits halt remaining entries', async (t) => {
  const ctx = await fixture(t)
  let posts = 0
  const mock = mockApi({ hook: (call) => {
    if (call.method === 'POST' && call.path === '/api/v1/listing' && ++posts === 1) return reject(429, { 'Retry-After': '2' })
  } })
  assert.equal((await runFixture(ctx, mock)).report.summary.created, 1)
  assert.equal(posts, 2)
  for (const status of [401, 403, 429]) {
    const batch = await fixture(t, [input(), input('Clown Chair')])
    const failure = mockApi({ hook: (call) => call.method === 'POST' ? reject(status) : undefined })
    const { report } = await runFixture(batch, failure)
    assert.equal(report.summary.failed, 1)
    assert.equal(report.summary.notAttempted, 1)
  }
})
test('long server wait stops instead of retrying too early', async () => {
  const mock = mockApi({ hook: () => reject(429, { 'Retry-After': '120' }) })
  await assert.rejects(mock.api.account(), /longer than 60/)
  assert.equal(mock.calls.length, 1)
})
test('photo upload rejects untrusted destination and never forwards Gameflip authorization', async (t) => {
  const ctx = await fixture(t)
  const mock = mockApi({ hook: (call) => call.path.endsWith('/photo') ? success({ id: 'ph', upload_url: 'https://evil.example/upload?token=secret' }) : undefined })
  assert.equal((await runFixture(ctx, mock)).report.summary.failed, 1)
  assert.ok(mock.calls.every((call) => !call.url.includes('evil.example')))
  assert.equal(mock.records.get('new-1').status, 'draft')
})
test('CLI options: default dry-run, confirmation, no implicit duplicate override', () => {
  assert.deepEqual(parseUploadArgs(['--file', 'input.json']), { file: 'input.json', execute: false, confirmed: false, allowDuplicate: false, verbose: false })
  assert.equal(parseUploadArgs(['--file', 'x', '--execute', '--confirm', 'UPLOAD']).confirmed, true)
  for (const args of [[], ['--file'], ['--file', 'x', '--confirm', 'UPLOAD'], ['--execute', '--file', 'x', '--confirm', 'yes'], ['--file', 'x', '--execute', '--execute'], ['--api-key', 'secret']]) {
    assert.throws(() => parseUploadArgs(args), UploadError)
  }
})
test('CLI help uses no credentials/network, live confirmation missing makes no writes', async (t) => {
  const output = []
  assert.equal(await runUploadCli(['--help'], { loadEnv: () => assert.fail('No env for help'), makeClient: () => assert.fail('No API for help'), stdout: (line) => output.push(line) }), 0)
  assert.match(output[0], /DRY RUN/)
  const ctx = await fixture(t)
  const mock = mockApi({ confirmed: false })
  assert.equal(await runUploadCli(['--file', ctx.file, '--execute'], { env: { GAMEFLIP_API_KEY: credentials.apiKey, GAMEFLIP_OTP_SECRET: credentials.otpSecret }, loadEnv: () => {}, makeClient: () => mock.api, directory: ctx.runs, stdout: (line) => output.push(line), stderr: (line) => output.push(line) }), 1)
  assert.equal(mock.mutations().length, 0)
})
test('redaction and CLI never expose server bodies, credentials or signed URLs', async (t) => {
  const redactor = createRedactor(credentials)
  redactor.rememberOtp('123456')
  const sanitized = JSON.stringify(redactor.redact({ title: `${credentials.apiKey} ${credentials.otpSecret} 123456`, Authorization: 'GFAPI private:otp', url: 'https://s3.amazonaws.com/photo?token=private', cookie: 'sensitive' }))
  for (const secret of [credentials.apiKey, credentials.otpSecret, '123456', 'token=private', 'private:otp', 'sensitive']) assert.ok(!sanitized.includes(secret))
  const ctx = await fixture(t, [{ ...input(), description: credentials.apiKey }])
  const output = []
  const mock = mockApi({ execute: false, confirmed: false })
  const code = await runUploadCli(['--file', ctx.file, '--verbose'], {
    env: { GAMEFLIP_API_KEY: credentials.apiKey, GAMEFLIP_OTP_SECRET: credentials.otpSecret }, loadEnv: () => {}, makeClient: () => mock.api, directory: ctx.runs,
    stdout: (line) => output.push(line), stderr: (line) => output.push(line),
  })
  assert.equal(code, 1)
  assert.ok(!output.join('\n').includes(credentials.apiKey))
  assert.equal(mock.mutations().length, 0)
  const bad = mockApi({ hook: () => new Response(JSON.stringify({ status: 'FAILURE', error: { code: 401, message: credentials.apiKey } }), { status: 200 }) })
  await assert.rejects(bad.api.account(), (error) => !error.message.includes(credentials.apiKey))
})

test('unreadable/missing-ID create response blocks retry and retains uncertain state', async (t) => {
  for (const response of [() => new Response('broken JSON', { status: 200 }), () => success({})]) {
    const ctx = await fixture(t)
    const mock = mockApi({ hook: (call) => call.method === 'POST' ? response() : undefined })
    assert.equal((await runFixture(ctx, mock)).report.summary.failed, 1)
    assert.equal(mock.mutations().length, 1)
    assert.equal(ctx.journal.get(ctx.entries[0].key).stage, 'create_pending')
    assert.equal((await runFixture(ctx, mock)).report.summary.invalid, 1)
    assert.equal(mock.mutations().length, 1)
  }
})
test('journal failure after successful create reports its ID and blocks replacement', async (t) => {
  const ctx = await fixture(t)
  const save = ctx.journal.save
  ctx.journal.save = async (key, value) => {
    if (value.listingId) throw new UploadError('Disk full', { stop: true })
    await save(key, value)
  }
  const mock = mockApi()
  const first = await runFixture(ctx, mock)
  assert.equal(first.report.results[0].listingId, 'new-1')
  assert.equal(first.report.summary.draftsCreated, 1)
  assert.equal(mock.mutations().length, 1)
  ctx.journal = await openJournal(ctx.runs, owner)
  assert.equal((await runFixture(ctx, mock)).report.summary.invalid, 1)
  assert.equal(mock.mutations().length, 1)
})
test('clear create rejection can be corrected and rerun', async (t) => {
  const ctx = await fixture(t)
  let rejected = true
  const mock = mockApi({ hook: (call) => call.method === 'POST' && rejected ? reject(400) : undefined })
  assert.equal((await runFixture(ctx, mock)).report.summary.failed, 1)
  rejected = false
  ctx.entries[0].payload.price = 200
  assert.equal((await runFixture(ctx, mock)).report.summary.created, 1)
  assert.equal(mock.records.size, 1)
})
test('dry-run checks retained draft fields and reports drift without mutations', async (t) => {
  const ctx = await fixture(t)
  const mock = mockApi({ hook: (call) => call.method === 'PUT' ? reject(400) : undefined })
  await runFixture(ctx, mock)
  mock.records.get('new-1').qty_avail = 99
  const before = mock.mutations().length
  const result = await runFixture(ctx, mock, { execute: false, confirmed: false })
  assert.equal(result.report.summary.invalid, 1)
  assert.match(result.report.results[0].reason, /qty_avail/)
  assert.equal(result.report.results[0].listingId, 'new-1')
  assert.equal(mock.mutations().length, before)
})
test('known-id unexpected status blocks all further creation', async (t) => {
  const ctx = await fixture(t)
  const mock = mockApi({ hook: (call) => call.method === 'PUT' ? reject(400) : undefined })
  await runFixture(ctx, mock)
  mock.records.get('new-1').status = 'onsale'
  ctx.entries.push({ index: 1, ...validateEntry(input('New Item')) })
  const before = mock.mutations().length
  const result = await runFixture(ctx, mock)
  assert.equal(result.report.summary.invalid, 1)
  assert.equal(result.report.summary.notAttempted, 1)
  assert.equal(mock.mutations().length, before)
})
test('missing version blocks association rather than using an unconditional PATCH', async (t) => {
  const ctx = await fixture(t)
  const mock = mockApi({ hook: (call, records) => {
    if (call.method === 'GET' && call.path === '/api/v1/listing/new-1') delete records.get('new-1').version
  } })
  assert.equal((await runFixture(ctx, mock)).report.summary.failed, 1)
  assert.ok(!mock.calls.some((call) => call.method === 'PATCH'))
})
test('photo activation failure resumes uploaded photo without a new allocation', async (t) => {
  const ctx = await fixture(t)
  let rejectPatch = true
  const mock = mockApi({ hook: (call) => call.method === 'PATCH' && rejectPatch ? reject(400) : undefined })
  assert.equal((await runFixture(ctx, mock)).report.summary.failed, 1)
  const posts = mock.calls.filter((call) => call.method === 'POST').length
  rejectPatch = false
  assert.equal((await runFixture(ctx, mock)).report.summary.created, 1)
  assert.equal(mock.calls.filter((call) => call.method === 'POST').length, posts)
})
test('CLI default real orchestration uses mock GETs only and does not acquire a lock', async (t) => {
  const ctx = await fixture(t)
  const mock = mockApi({ execute: false, confirmed: false })
  const code = await runUploadCli(['--file', ctx.file], {
    env: { GAMEFLIP_API_KEY: credentials.apiKey, GAMEFLIP_OTP_SECRET: credentials.otpSecret }, loadEnv: () => {},
    makeClient: () => mock.api, directory: ctx.runs, lock: () => assert.fail('No lock in dry-run'), stdout: () => {}, stderr: () => {},
  })
  assert.equal(code, 0)
  assert.equal(mock.mutations().length, 0)
})

test('expired S3 upload authorization is an item failure, not Gameflip account-auth failure', async (t) => {
  const ctx = await fixture(t, [input(), input('Clown Chair')])
  const mock = mockApi({ hook: (call) => call.method === 'PUT' && call.path.startsWith('/new-1/') ? reject(403) : undefined })
  const { report } = await runFixture(ctx, mock)
  assert.equal(report.summary.failed, 1)
  assert.equal(report.summary.created, 1)
  assert.match(report.results[0].reason, /Image storage/)
  assert.equal(mock.records.get('new-1').status, 'draft')
})

test('duplicate-only JSON needs no description, quantity or image', async (t) => {
  const ctx = await fixture(t, [{ name: 'Golden Chair', price_usd: '1.00' }])
  const mock = mockApi({ execute: false, confirmed: false, existing: [{ id: 'existing', name: ' Run A Restaurant - GOLDEN CHAIR ', owner }] })
  const { report } = await runFixture(ctx, mock, { execute: false, confirmed: false, readImage: () => assert.fail('Duplicate must not validate an image') })
  assert.equal(report.summary.skipped, 1)
  assert.equal(report.summary.invalid, 0)
  assert.equal(report.summary.wouldCreate, 0)
  assert.equal(mock.mutations().length, 0)
})

test('missing creation fields still block unknown titles and allow-duplicate execution', async (t) => {
  for (const existing of [[], [{ id: 'existing', name: titleFor(input()), owner }]]) {
    const ctx = await fixture(t, [{ name: 'Golden Chair', price_usd: '1.00' }])
    const mock = mockApi({ existing })
    const { report } = await runFixture(ctx, mock, { allowDuplicate: true })
    assert.equal(report.summary.invalid, 1)
    assert.equal(report.summary.created, 0)
    assert.equal(mock.mutations().length, 0)
  }
})

test('duplicate input title guard remains active for incomplete duplicate-only entries', async (t) => {
  const ctx = await fixture(t, [{ name: 'Golden Chair' }, { name: ' GOLDEN CHAIR ' }])
  const mock = mockApi({ existing: [{ id: 'existing', name: titleFor(input()), owner }] })
  const { report } = await runFixture(ctx, mock, { execute: false, confirmed: false })
  assert.equal(report.summary.invalid, 2)
  assert.equal(report.summary.skipped, 0)
  assert.equal(mock.mutations().length, 0)
})

test('owner-scoped checker follows every page and skips 20 new onsale titles on later pages', async (t) => {
  const names = ['High Tech Table', 'High Tech Chair', 'Golden Table', 'Golden Chair', 'Giant Cowbell',
    'Tackle Box', 'Soccer Set', 'Clown Chair', 'Clown Table', 'Basketball Tip Jar', 'Taco Chair',
    'Taco Table', 'Lifeguard Stand', 'Captain Table', 'Captain Chair', 'Ship in a Bottle Tip Jar',
    'Pirate Fishing Rod', 'Sunken Table', 'Sunken Chair', 'Shipwreck']
  const ctx = await fixture(t, names.map(name => ({ name })))
  const older = Array.from({ length: 3 }, (_, index) => ({ id: `old-${index}`, owner, name: `Unrelated ${index}`, status: 'sold' }))
  const newer = names.map((name, index) => ({ id: `new-title-${index}`, owner, name: `  RUN A RESTAURANT - ${name.toUpperCase()}  `, status: 'onsale' }))
  let page = 0
  const mock = mockApi({ execute: false, confirmed: false, hook: call => {
    if (call.path !== '/api/v1/listing') return undefined
    assert.equal(call.method, 'GET')
    assert.equal(new URL(call.url).searchParams.get('owner'), owner)
    page++
    if (page === 1) return success(older, { next_page: '?start=3' })
    if (page === 2) return success({ listings: newer.slice(0, 10), found: 23, next_page: '/api/v1/listing?start=13' })
    if (page === 3) return success([...newer.slice(10), older[0]], { next_page: '?start=24' })
    assert.equal(page, 4)
    return success(null)
  } })
  const { plan, report } = await runFixture(ctx, mock, { execute: false, confirmed: false, readImage: () => assert.fail('Duplicates never need images') })
  assert.equal(page, 4)
  assert.equal(plan.scanned, 23, 'Repeated listing ID is counted only once')
  assert.equal(report.summary.skipped, 20)
  assert.equal(report.summary.wouldCreate, 0)
  assert.equal(report.summary.invalid, 0)
  assert.equal(mock.mutations().length, 0)
})

test('discovery retains returned draft, ready, unavailable and unrecognized status rows', async (t) => {
  // This tests local handling of returned rows, not whether the server search
  // filters expose every possible status. Those are separate API limitations.
  const statuses = ['draft', 'ready', 'unavailable', 'future_status']
  const ctx = await fixture(t, statuses.map(status => ({ name: `Item ${status}` })))
  let page = 0
  const mock = mockApi({ execute: false, confirmed: false, hook: call => {
    if (call.path !== '/api/v1/listing') return undefined
    page++
    const rows = statuses.slice((page - 1) * 2, page * 2).map(status => ({ id: `id-${status}`, owner, name: `Run A Restaurant - Item ${status}`, status }))
    return success({ listings: rows, found: 4 }, page < 2 ? { next_page: '?start=2' } : {})
  } })
  const { report } = await runFixture(ctx, mock, { execute: false, confirmed: false })
  assert.equal(page, 2)
  assert.equal(report.summary.skipped, 4)
  assert.equal(mock.mutations().length, 0)
})

test('an empty page with a next_page cursor does not stop owner listing traversal', async () => {
  let page = 0
  const mock = mockApi({ execute: false, confirmed: false, hook: call => {
    if (call.path !== '/api/v1/listing') return undefined
    page++
    return page === 1 ? success([], { next_page: '?start=50' }) : success([{ id: 'later', owner, name: 'Run A Restaurant - Golden Chair', status: 'onsale' }])
  } })
  assert.deepEqual((await mock.api.listings()).map(row => row.id), ['later'])
  assert.equal(page, 2)
  assert.equal(mock.mutations().length, 0)
})
