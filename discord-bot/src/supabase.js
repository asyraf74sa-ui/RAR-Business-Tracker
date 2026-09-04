import { createClient } from '@supabase/supabase-js'

const FINANCIAL_PAGE_SIZE = 1000
const FINANCIAL_CURRENCIES = ['USD', 'MYR', 'PHP', 'IDR']
const authStates = new WeakMap()

export function createBotSupabaseClient({ url, publishableKey }) {
  return createClient(url, publishableKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: false,
      persistSession: false,
    },
  })
}

export async function authenticateSupabase(
  supabase,
  { email, password, logger = console, now = () => Date.now() },
) {
  const state = {
    authenticatedOnce: false,
    email,
    generation: 0,
    logger,
    now,
    password,
    reauthentication: null,
  }
  authStates.set(supabase, state)

  try {
    return await reauthenticateSupabase(supabase, state)
  } catch (error) {
    authStates.delete(supabase)
    throw error
  }
}

export async function loadCatalog(supabase) {
  return withSupabaseAuthRetry(supabase, 'RAR catalog load', async () => {
    const [itemResult, platformResult] = await Promise.all([
      supabase.from('rar_items').select('id,name,stock,kind,active').eq('active', true).order('name'),
      supabase.from('rar_platforms').select('id,name,active').eq('active', true).order('name'),
    ])

    if (itemResult.error) throw databaseError('Could not load RAR items', itemResult.error)
    if (platformResult.error) throw databaseError('Could not load RAR platforms', platformResult.error)

    return {
      items: itemResult.data || [],
      platforms: platformResult.data || [],
    }
  })
}

export async function loadMRCatalog(supabase) {
  return withSupabaseAuthRetry(supabase, 'MR catalog load', async () => {
    const [itemResult, familyResult, platformResult] = await Promise.all([
      supabase
        .from('mr_items')
        .select('id,name,category,unit,current_quantity,is_archived,aliases')
        .eq('is_archived', false)
        .order('name'),
      supabase
        .from('mr_set_families')
        .select('id,name,aliases,table_item_id,chair_item_id,chairs_per_set,active')
        .eq('active', true)
        .order('name'),
      supabase.from('rar_platforms').select('id,name,active').eq('active', true).order('name'),
    ])

    if (itemResult.error) throw databaseError('Could not load MR items', itemResult.error)
    if (familyResult.error) throw databaseError('Could not load MR set families', familyResult.error)
    if (platformResult.error) throw databaseError('Could not load sales platforms', platformResult.error)
    return {
      items: itemResult.data || [],
      setFamilies: familyResult.data || [],
      platforms: platformResult.data || [],
    }
  })
}

export async function loadActiveItems(supabase) {
  return withSupabaseAuthRetry(supabase, 'active RAR item load', async () => {
    const { data, error } = await supabase
      .from('rar_items')
      .select('id,name,stock,kind,active')
      .eq('active', true)
      .order('name')

    if (error) throw databaseError('Could not refresh active RAR items', error)
    return data || []
  })
}

export async function loadMRActiveItems(supabase) {
  return withSupabaseAuthRetry(supabase, 'active MR item load', async () => {
    const { data, error } = await supabase
      .from('mr_items')
      .select('id,name,category,unit,current_quantity,is_archived,aliases')
      .eq('is_archived', false)
      .order('name')
    if (error) throw databaseError('Could not refresh active MR items', error)
    return (data || []).map((item) => ({
      ...item,
      active: !item.is_archived,
      kind: 'item',
      stock: item.current_quantity,
    }))
  })
}

export async function loadMRSetStockSummaries(supabase) {
  return withSupabaseAuthRetry(supabase, 'MR set stock summary load', async () => {
    const { data, error } = await supabase
      .from('mr_set_stock_summary')
      .select('family_id,name,tables,chairs,chairs_per_set,completed_sets,excess_tables,excess_chairs')
      .order('name')
    if (error) throw databaseError('Could not load MR set stock summaries', error)
    return data || []
  })
}

export async function findRecordedSale(supabase, requestId, game = 'RAR') {
  return withSupabaseAuthRetry(supabase, `existing ${game || 'Discord'} sale check`, async () => {
    const tables = game === null ? ['rar_sales', 'mr_sales'] : [game === 'MR' ? 'mr_sales' : 'rar_sales']
    for (const table of tables) {
      const { data, error } = await supabase.from(table).select('id').eq('request_id', requestId).maybeSingle()
      if (error) throw databaseError('Could not check for an existing Discord sale', error)
      if (data?.id) return data.id
    }
    return null
  })
}

export async function findRecordedInventoryOperation(supabase, requestIds, game = 'RAR') {
  const ids = [...new Set(requestIds)].filter(Boolean)
  if (ids.length === 0) return null

  return withSupabaseAuthRetry(supabase, `existing ${game} inventory operation check`, async () => {
    const table = game === 'MR' ? 'mr_inventory_events' : 'rar_inventory_events'
    const { data, error } = await supabase
      .from(table)
      .select('request_id,event_type')
      .in('request_id', ids)
      .limit(1)

    if (error) throw databaseError('Could not check for an existing inventory operation', error)
    return data?.[0] || null
  })
}

export async function loadInventoryEvents(supabase, requestId, game = 'RAR') {
  return withSupabaseAuthRetry(supabase, `${game} inventory result load`, async () => {
    const table = game === 'MR' ? 'mr_inventory_events' : 'rar_inventory_events'
    const relation = game === 'MR' ? 'mr_items' : 'rar_items'
    const { data, error } = await supabase
      .from(table)
      .select(`item_id,event_type,quantity_delta,balance_after,item:${relation}(name)`)
      .eq('request_id', requestId)
      .order('item_id')

    if (error) throw databaseError('Could not load recorded inventory results', error)
    return data || []
  })
}

export async function loadMonthlyFinancialRecords(supabase, { startInclusive, endExclusive }, game = 'RAR') {
  return withSupabaseAuthRetry(supabase, `${game} monthly report load`, async () => {
    const prefix = game === 'MR' ? 'mr' : 'rar'
    const [sales, inventoryEvents] = await Promise.all([
      loadAllFinancialRows(() => supabase
        .from(`${prefix}_sales`)
        .select('id,sold_at,platform,net_credit,platform_fee,currency,inventory_applied,classification')
        .in('currency', FINANCIAL_CURRENCIES)
        .gte('sold_at', startInclusive)
        .lt('sold_at', endExclusive)
        .order('sold_at')
        .order('id'), `${game} monthly sales`),
      loadAllFinancialRows(() => supabase
        .from(`${prefix}_inventory_events`)
        .select('id,event_at,event_type,cash_amount,cash_currency,request_id')
        .eq('event_type', 'supplier_purchase')
        .not('cash_amount', 'is', null)
        .in('cash_currency', FINANCIAL_CURRENCIES)
        .gte('event_at', startInclusive)
        .lt('event_at', endExclusive)
        .order('event_at')
        .order('id'), `${game} monthly purchases`),
    ])

    return { sales, inventoryEvents }
  })
}

export async function loadFinancialHistoryRecords(supabase, game = 'RAR') {
  return withSupabaseAuthRetry(supabase, `${game} monthly history load`, async () => {
    const prefix = game === 'MR' ? 'mr' : 'rar'
    const [sales, inventoryEvents] = await Promise.all([
      loadAllFinancialRows(() => supabase
        .from(`${prefix}_sales`)
        .select('id,sold_at,platform,net_credit,platform_fee,currency,inventory_applied,classification')
        .in('currency', FINANCIAL_CURRENCIES)
        .order('sold_at')
        .order('id'), `${game} sales history`),
      loadAllFinancialRows(() => supabase
        .from(`${prefix}_inventory_events`)
        .select('id,event_at,event_type,cash_amount,cash_currency,request_id')
        .eq('event_type', 'supplier_purchase')
        .not('cash_amount', 'is', null)
        .in('cash_currency', FINANCIAL_CURRENCIES)
        .order('event_at')
        .order('id'), `${game} purchase history`),
    ])

    return { sales, inventoryEvents }
  })
}

export function recordSale(supabase, payload, options) {
  return callRpcWithRetry(supabase, 'rar_record_sale', payload, options)
}

export function recordPurchaseBundle(supabase, payload, options) {
  return callRpcWithRetry(supabase, 'rar_record_purchase_bundle', payload, options)
}

export function claimFarmCycles(supabase, payload, options) {
  return callRpcWithRetry(supabase, 'rar_claim_farm_cycles', payload, options)
}

export function recordTrade(supabase, payload, options) {
  return callRpcWithRetry(supabase, 'rar_record_trade', payload, options)
}

export function addStockBundle(supabase, payload, options) {
  return callRpcWithRetry(supabase, 'rar_add_stock_bundle', payload, options)
}

export function reconcileStockBundle(supabase, payload, options) {
  return callRpcWithRetry(supabase, 'rar_reconcile_stock_batch', payload, options)
}

export function recordMRSale(supabase, payload, options) {
  return callRpcWithRetry(supabase, 'mr_record_sale', payload, options)
}

export function recordMRPurchaseBundle(supabase, payload, options) {
  return callRpcWithRetry(supabase, 'mr_record_purchase_bundle', payload, options)
}

export function recordMRTrade(supabase, payload, options) {
  return callRpcWithRetry(supabase, 'mr_record_trade', payload, options)
}

export function addMRStockBundle(supabase, payload, options) {
  return callRpcWithRetry(supabase, 'mr_add_stock_bundle', payload, options)
}

export function reconcileMRStockBundle(supabase, payload, options) {
  return callRpcWithRetry(supabase, 'mr_reconcile_stock_batch', payload, options)
}

export async function callRpcWithRetry(supabase, functionName, payload, { attempts = 3 } = {}) {
  return withSupabaseAuthRetry(supabase, `authenticated RPC ${functionName}`, () => (
    callRpcWithTransientRetry(supabase, functionName, payload, { attempts })
  ))
}

async function callRpcWithTransientRetry(supabase, functionName, payload, { attempts }) {
  let lastError

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const { data, error } = await supabase.rpc(functionName, payload)
      if (!error) {
        if (data === null || data === undefined) throw new Error(`${functionName} did not return a result.`)
        return data
      }

      lastError = error
      if (!isTransientError(error) || attempt === attempts) {
        throw databaseError(`Could not run ${functionName}`, error)
      }
    } catch (error) {
      lastError = error
      if (!isTransientError(error) || attempt === attempts) throw error
    }

    await delay(500 * 2 ** (attempt - 1))
  }

  throw lastError
}

export function isTransientError(error) {
  const message = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`
  return /(fetch|network|timeout|timed out|econn|socket|502|503|504|520)/i.test(message)
}

async function loadAllFinancialRows(buildQuery, label) {
  const rows = []

  for (let offset = 0; ; offset += FINANCIAL_PAGE_SIZE) {
    const { data, error } = await buildQuery().range(offset, offset + FINANCIAL_PAGE_SIZE - 1)
    if (error) throw databaseError(`Could not load ${label}`, error)

    const page = data || []
    rows.push(...page)
    if (page.length < FINANCIAL_PAGE_SIZE) return rows
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function withSupabaseAuthRetry(supabase, operationName, operation) {
  const state = authStates.get(supabase)
  if (!state) return operation()

  await ensureAuthenticatedSupabase(supabase, state, operationName)
  const operationGeneration = state.generation

  try {
    return await operation()
  } catch (error) {
    if (!isRecoverableAuthError(error)) throw error

    state.logger?.warn?.(`[Supabase auth] Authentication-related failure during ${operationName}; re-authenticating.`)

    if (state.generation === operationGeneration) {
      try {
        await reauthenticateSupabase(supabase, state)
      } catch (reauthenticationError) {
        if (isJwtIssuedInFuture(error) || isJwtIssuedInFuture(reauthenticationError)) {
          throw clockSkewError(reauthenticationError)
        }
        throw reauthenticationError
      }
    }
    state.logger?.info?.(`[Supabase auth] Retrying ${operationName} once.`)

    try {
      return await operation()
    } catch (retryError) {
      if (isJwtIssuedInFuture(retryError)) throw clockSkewError(retryError)
      throw retryError
    }
  }
}

async function ensureAuthenticatedSupabase(supabase, state, operationName) {
  let sessionResult
  try {
    sessionResult = await supabase.auth.getSession()
  } catch (error) {
    sessionResult = { error }
  }

  const issue = sessionResult.error
    ? 'session check failed'
    : sessionIssue(sessionResult.data?.session, state.now())
  if (!issue) return sessionResult.data.session

  state.logger?.warn?.(`[Supabase auth] Re-authenticating before ${operationName}: ${issue}.`)
  return reauthenticateSupabase(supabase, state)
}

async function reauthenticateSupabase(supabase, state) {
  if (!state.reauthentication) {
    const isRecovery = state.authenticatedOnce
    const prefix = isRecovery
      ? 'Supabase reauthentication failed'
      : 'Supabase authentication failed'

    state.reauthentication = (async () => {
      let result
      try {
        result = await supabase.auth.signInWithPassword({
          email: state.email,
          password: state.password,
        })
      } catch (error) {
        throw databaseError(prefix, error)
      }

      if (result.error) throw databaseError(prefix, result.error)

      const issue = sessionIssue(result.data?.session, state.now())
      if (issue) throw new Error(`${prefix}: ${issue}.`)

      state.authenticatedOnce = true
      state.generation += 1
      if (isRecovery) state.logger?.info?.('[Supabase auth] Re-authenticated successfully.')
      return result.data.session
    })()
  }

  const pending = state.reauthentication
  try {
    return await pending
  } finally {
    if (state.reauthentication === pending) state.reauthentication = null
  }
}

function sessionIssue(session, nowMilliseconds) {
  if (!session) return 'no active session exists'
  if (!session.access_token) return 'the session has no access token'

  const claims = decodeJwtClaims(session.access_token)
  if (!claims) return 'the session access token is invalid'

  const expiresAt = Number(session.expires_at ?? claims.exp)
  if (!Number.isFinite(expiresAt)) return 'the session has no valid expiry time'
  if (expiresAt <= Math.floor(nowMilliseconds / 1000)) return 'the session has expired'

  if (claims.role !== 'authenticated') return 'the session has lost the authenticated role'
  return null
}

function decodeJwtClaims(token) {
  try {
    const [, payload] = token.split('.')
    if (!payload) return null
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

function isRecoverableAuthError(error) {
  const text = errorText(error)
  if (/(?:jwt|access token|bearer token).*(?:expired|invalid|malformed|missing|future|not yet valid)/i.test(text)) return true
  if (/(?:expired|invalid|missing|failed).*(?:jwt|access token|refresh token|auth session)/i.test(text)) return true
  if (/authentication required|not authenticated|no active session|refresh[_ ]token.*(?:not found|revoked|reuse)/i.test(text)) return true
  if (/\bPGRST30[13]\b/i.test(text)) return true

  return /permission denied for (?:table|function|sequence|schema)\s+(?:public\.)?(?:rar|mr)_[a-z0-9_]+/i.test(text)
}

function isJwtIssuedInFuture(error) {
  return /(?:jwt|token).*(?:issued (?:in the|at) future|not yet valid)|(?:issued (?:in the|at) future|not yet valid).*(?:jwt|token)/i
    .test(errorText(error))
}

function errorText(error) {
  const parts = []
  const seen = new Set()
  for (let current = error; current && !seen.has(current); current = current.cause) {
    seen.add(current)
    parts.push(current.message, current.code, current.details, current.hint, current.status)
  }
  return parts.filter(Boolean).join(' ')
}

function databaseError(label, error) {
  const message = error?.message || String(error)
  const wrapped = new Error(`${label}: ${message}`, { cause: error })
  for (const property of ['code', 'details', 'hint', 'status']) {
    if (error?.[property] !== undefined) wrapped[property] = error[property]
  }
  return wrapped
}

function clockSkewError(cause) {
  return new Error(
    'Supabase rejected a newly authenticated JWT because it was issued in the future. '
      + 'Synchronize the bot host system clock (Windows Date & time), then try again.',
    { cause },
  )
}
