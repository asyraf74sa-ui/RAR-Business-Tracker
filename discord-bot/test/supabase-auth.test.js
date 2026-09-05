import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addMRStockBundle,
  addStockBundle,
  authenticateSupabase,
  claimFarmCycles,
  findRecordedInventoryOperation,
  findRecordedSale,
  loadActiveItems,
  loadCatalog,
  loadFinancialHistoryRecords,
  loadInventoryEvents,
  loadMonthlyFinancialRecords,
  loadWeeklySalesRecords,
  loadMRActiveItems,
  loadMRCatalog,
  loadMRSetStockSummaries,
  reconcileStockBundle,
  reconcileMRStockBundle,
  recordMRPurchaseBundle,
  recordMRSale,
  recordMRTrade,
  recordPurchaseBundle,
  recordSale,
  recordTrade,
} from '../src/supabase.js'

const NOW = Date.parse('2026-09-03T00:00:00.000Z')
const silentLogger = { info() {}, warn() {} }
const credentials = {
  email: 'bot@example.test',
  password: 'not-a-real-secret',
  logger: silentLogger,
  now: () => NOW,
}

test('a healthy authenticated session runs a protected query without signing in again', async () => {
  const fake = fakeSupabase({ queryHandler: () => ({ data: [{ id: 'item-1' }], error: null }) })
  await authenticateSupabase(fake.client, credentials)

  assert.deepEqual(await loadActiveItems(fake.client), [{ id: 'item-1' }])
  assert.equal(fake.calls.signIn.length, 1)
  assert.equal(fake.calls.getSession, 1)
  assert.equal(fake.calls.query.length, 1)
})

test('missing, expired, invalid, wrong-role, and failed session checks sign in before querying', async (t) => {
  const cases = [
    ['missing', null],
    ['expired', validSession({ expiresAt: Math.floor(NOW / 1000) - 1 })],
    ['invalid', { ...validSession(), access_token: 'not-a-jwt' }],
    ['wrong role', validSession({ role: 'anon' })],
  ]

  for (const [name, unhealthySession] of cases) {
    await t.test(name, async () => {
      const fake = fakeSupabase()
      await authenticateSupabase(fake.client, credentials)
      fake.setSession(unhealthySession)

      await loadActiveItems(fake.client)
      assert.equal(fake.calls.signIn.length, 2)
      assert.equal(fake.calls.query.length, 1)
    })
  }

  await t.test('session check failure', async () => {
    const fake = fakeSupabase()
    await authenticateSupabase(fake.client, credentials)
    fake.failNextSessionCheck(new Error('refresh session failed'))

    await loadActiveItems(fake.client)
    assert.equal(fake.calls.signIn.length, 2)
    assert.equal(fake.calls.query.length, 1)
  })
})

test('an auth-related database failure reauthenticates and retries exactly once', async () => {
  let queryAttempts = 0
  const fake = fakeSupabase({
    queryHandler: () => {
      queryAttempts += 1
      if (queryAttempts === 1) return { data: null, error: { message: 'JWT expired' } }
      return { data: [{ id: 'recovered' }], error: null }
    },
  })
  await authenticateSupabase(fake.client, credentials)

  assert.deepEqual(await loadActiveItems(fake.client), [{ id: 'recovered' }])
  assert.equal(fake.calls.signIn.length, 2)
  assert.equal(queryAttempts, 2)
})

test('the observed protected-table permission failure is treated as a lost authenticated session', async () => {
  let queryAttempts = 0
  const fake = fakeSupabase({
    queryHandler: () => {
      queryAttempts += 1
      if (queryAttempts === 1) {
        return {
          data: null,
          error: { code: '42501', message: 'permission denied for table rar_inventory_events' },
        }
      }
      return { data: [], error: null }
    },
  })
  await authenticateSupabase(fake.client, credentials)

  assert.equal(await findRecordedInventoryOperation(fake.client, ['stable-request']), null)
  assert.equal(fake.calls.signIn.length, 2)
  assert.equal(queryAttempts, 2)
})

test('concurrent recovery shares one in-flight credential sign-in', async () => {
  let releaseRecovery
  const recoveryGate = new Promise((resolve) => { releaseRecovery = resolve })
  const fake = fakeSupabase({
    signInHandler: async ({ attempt }) => {
      if (attempt === 2) await recoveryGate
      return { data: { session: validSession() }, error: null }
    },
  })
  await authenticateSupabase(fake.client, credentials)
  fake.setSession(null)

  const first = loadActiveItems(fake.client)
  const second = loadActiveItems(fake.client)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(fake.calls.signIn.length, 2)

  releaseRecovery()
  await Promise.all([first, second])
  assert.equal(fake.calls.signIn.length, 2)
  assert.equal(fake.calls.query.length, 2)
})

test('overlapping database failures reuse a recovery that completed before the second failure surfaced', async () => {
  let recoveryCompleted
  const recovered = new Promise((resolve) => { recoveryCompleted = resolve })
  const attempts = new Map()
  const fake = fakeSupabase({
    signInHandler: async ({ attempt }) => {
      if (attempt === 2) recoveryCompleted()
      return { data: { session: validSession() }, error: null }
    },
    rpcHandler: async ({ payload }) => {
      const attempt = (attempts.get(payload.p_request_id) || 0) + 1
      attempts.set(payload.p_request_id, attempt)
      if (attempt === 1 && payload.p_request_id === 'second') await recovered
      if (attempt === 1) return { data: null, error: { message: 'invalid JWT' } }
      return { data: 1, error: null }
    },
  })
  await authenticateSupabase(fake.client, credentials)

  assert.deepEqual(await Promise.all([
    recordSale(fake.client, { p_request_id: 'first' }, { attempts: 1 }),
    recordSale(fake.client, { p_request_id: 'second' }, { attempts: 1 }),
  ]), [1, 1])
  assert.equal(fake.calls.signIn.length, 2)
  assert.equal(fake.calls.rpc.length, 4)
})

test('invalid startup credentials fail without running a protected operation', async () => {
  const fake = fakeSupabase({
    signInHandler: async () => ({
      data: { session: null },
      error: { message: 'Invalid login credentials' },
    }),
  })

  await assert.rejects(
    authenticateSupabase(fake.client, credentials),
    /Supabase authentication failed: Invalid login credentials/,
  )
  assert.equal(fake.calls.query.length, 0)
})

test('all mutation helpers reuse the same deterministic request ID across one auth retry', async (t) => {
  const mutations = [
    ['sale', recordSale, 'rar_record_sale'],
    ['purchase', recordPurchaseBundle, 'rar_record_purchase_bundle'],
    ['farm', claimFarmCycles, 'rar_claim_farm_cycles'],
    ['trade', recordTrade, 'rar_record_trade'],
    ['add', addStockBundle, 'rar_add_stock_bundle'],
    ['stock', reconcileStockBundle, 'rar_reconcile_stock_batch'],
    ['MR sale', recordMRSale, 'mr_record_sale'],
    ['MR purchase', recordMRPurchaseBundle, 'mr_record_purchase_bundle'],
    ['MR trade', recordMRTrade, 'mr_record_trade'],
    ['MR add', addMRStockBundle, 'mr_add_stock_bundle'],
    ['MR stock', reconcileMRStockBundle, 'mr_reconcile_stock_batch'],
  ]

  for (const [name, mutate, functionName] of mutations) {
    await t.test(name, async () => {
      let attempts = 0
      const fake = fakeSupabase({
        rpcHandler: ({ functionName: calledFunction }) => {
          attempts += 1
          if (attempts === 1) {
            return { data: null, error: { code: '42501', message: `permission denied for function ${calledFunction}` } }
          }
          return { data: 1, error: null }
        },
      })
      await authenticateSupabase(fake.client, credentials)
      const payload = { p_request_id: `discord-${name}-stable-request-id` }

      assert.equal(await mutate(fake.client, payload, { attempts: 1 }), 1)
      assert.equal(fake.calls.rpc.length, 2)
      assert.equal(fake.calls.rpc[0].functionName, functionName)
      assert.strictEqual(fake.calls.rpc[0].payload, payload)
      assert.strictEqual(fake.calls.rpc[1].payload, payload)
      assert.equal(fake.calls.rpc[0].payload.p_request_id, fake.calls.rpc[1].payload.p_request_id)
      assert.equal(fake.calls.signIn.length, 2)
    })
  }
})

test('generic permission failures are not mistaken for authentication failures', async () => {
  const fake = fakeSupabase({
    rpcHandler: () => ({
      data: null,
      error: { code: '42501', message: 'permission denied for table private_admin' },
    }),
  })
  await authenticateSupabase(fake.client, credentials)

  await assert.rejects(recordSale(fake.client, { p_request_id: 'stable' }, { attempts: 1 }), /permission denied/)
  assert.equal(fake.calls.rpc.length, 1)
  assert.equal(fake.calls.signIn.length, 1)
})

test('a repeated auth failure stops after one retry instead of looping', async () => {
  const fake = fakeSupabase({
    rpcHandler: () => ({ data: null, error: { message: 'invalid JWT' } }),
  })
  await authenticateSupabase(fake.client, credentials)

  await assert.rejects(recordSale(fake.client, { p_request_id: 'stable' }, { attempts: 1 }), /invalid JWT/)
  assert.equal(fake.calls.rpc.length, 2)
  assert.equal(fake.calls.signIn.length, 2)
})

test('a future-issued JWT retries once and then reports actionable clock guidance', async () => {
  const fake = fakeSupabase({
    rpcHandler: () => ({ data: null, error: { message: 'JWT issued at future' } }),
  })
  await authenticateSupabase(fake.client, credentials)

  await assert.rejects(
    recordSale(fake.client, { p_request_id: 'stable' }, { attempts: 1 }),
    /Synchronize the bot host system clock \(Windows Date & time\)/,
  )
  assert.equal(fake.calls.rpc.length, 2)
  assert.equal(fake.calls.signIn.length, 2)
})

test('every read path used by messages and slash commands recovers from an auth failure', async (t) => {
  const range = {
    startInclusive: '2026-09-01T00:00:00.000Z',
    endExclusive: '2026-10-01T00:00:00.000Z',
  }
  const reads = [
    ['sale duplicate check', (client) => findRecordedSale(client, 'sale-request')],
    ['inventory duplicate check', (client) => findRecordedInventoryOperation(client, ['inventory-request'])],
    ['catalog for sale, purchase, trade, add, and stock', (client) => loadCatalog(client)],
    ['inventory result details', (client) => loadInventoryEvents(client, 'inventory-request')],
    ['/stock and /help active items', (client) => loadActiveItems(client)],
    ['/monthly records', (client) => loadMonthlyFinancialRecords(client, range)],
    ['/months history', (client) => loadFinancialHistoryRecords(client)],
    ['weekly sales records', (client) => loadWeeklySalesRecords(client, range)],
    ['MR catalog', (client) => loadMRCatalog(client)],
    ['MR active items', (client) => loadMRActiveItems(client)],
    ['MR set summaries', (client) => loadMRSetStockSummaries(client)],
  ]

  for (const [name, read] of reads) {
    await t.test(name, async () => {
      let queryAttempts = 0
      const fake = fakeSupabase({
        queryHandler: () => {
          queryAttempts += 1
          if (queryAttempts === 1) return { data: null, error: { message: 'invalid JWT' } }
          return { data: [], error: null }
        },
      })
      await authenticateSupabase(fake.client, credentials)

      await read(fake.client)
      assert.equal(fake.calls.signIn.length, 2)
      assert.ok(queryAttempts >= 2)
    })
  }
})

function fakeSupabase({
  queryHandler = () => ({ data: [], error: null }),
  rpcHandler = () => ({ data: 1, error: null }),
  signInHandler = async () => ({ data: { session: validSession() }, error: null }),
} = {}) {
  const calls = { getSession: 0, query: [], rpc: [], signIn: [] }
  let currentSession = null
  let nextSessionError = null

  const client = {
    auth: {
      async getSession() {
        calls.getSession += 1
        if (nextSessionError) {
          const error = nextSessionError
          nextSessionError = null
          return { data: { session: currentSession }, error }
        }
        return { data: { session: currentSession }, error: null }
      },
      async signInWithPassword(receivedCredentials) {
        calls.signIn.push(receivedCredentials)
        const result = await signInHandler({
          attempt: calls.signIn.length,
          credentials: receivedCredentials,
        })
        if (result.data?.session) currentSession = result.data.session
        return result
      },
    },
    from(table) {
      const chain = []
      const builder = {}
      for (const method of ['eq', 'gte', 'in', 'limit', 'lt', 'maybeSingle', 'not', 'order', 'range', 'select']) {
        builder[method] = (...args) => {
          chain.push([method, ...args])
          return builder
        }
      }
      builder.then = (resolve, reject) => {
        const call = { table, chain }
        calls.query.push(call)
        return Promise.resolve(queryHandler(call)).then(resolve, reject)
      }
      return builder
    },
    async rpc(functionName, payload) {
      const call = { functionName, payload }
      calls.rpc.push(call)
      return rpcHandler(call)
    },
  }

  return {
    calls,
    client,
    failNextSessionCheck(error) { nextSessionError = error },
    setSession(session) { currentSession = session },
  }
}

function validSession({
  expiresAt = Math.floor(NOW / 1000) + 3600,
  role = 'authenticated',
} = {}) {
  const claims = Buffer.from(JSON.stringify({ exp: expiresAt, role })).toString('base64url')
  return {
    access_token: `header.${claims}.signature`,
    expires_at: expiresAt,
    refresh_token: 'test-refresh-token',
  }
}
