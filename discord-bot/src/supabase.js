import { createClient } from '@supabase/supabase-js'

const FINANCIAL_PAGE_SIZE = 1000
const FINANCIAL_CURRENCIES = ['USD', 'MYR', 'PHP', 'IDR']

export function createBotSupabaseClient({ url, publishableKey }) {
  return createClient(url, publishableKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: false,
      persistSession: false,
    },
  })
}

export async function authenticateSupabase(supabase, { email, password }) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`Supabase authentication failed: ${error.message}`)
  if (!data.session) throw new Error('Supabase authentication failed: no session was returned.')

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
  if (sessionError) throw new Error(`Supabase session check failed: ${sessionError.message}`)
  if (!sessionData.session) throw new Error('Supabase session check failed: no active session exists.')

  return sessionData.session
}

export async function loadCatalog(supabase) {
  const [itemResult, platformResult] = await Promise.all([
    supabase.from('rar_items').select('id,name,stock,kind,active').eq('active', true).order('name'),
    supabase.from('rar_platforms').select('id,name,active').eq('active', true).order('name'),
  ])

  if (itemResult.error) throw new Error(`Could not load RAR items: ${itemResult.error.message}`)
  if (platformResult.error) throw new Error(`Could not load RAR platforms: ${platformResult.error.message}`)

  return {
    items: itemResult.data || [],
    platforms: platformResult.data || [],
  }
}

export async function loadActiveItems(supabase) {
  const { data, error } = await supabase
    .from('rar_items')
    .select('id,name,stock,kind,active')
    .eq('active', true)
    .order('name')

  if (error) throw new Error(`Could not refresh active RAR items: ${error.message}`)
  return data || []
}

export async function findRecordedSale(supabase, requestId) {
  const { data, error } = await supabase
    .from('rar_sales')
    .select('id')
    .eq('request_id', requestId)
    .maybeSingle()

  if (error) throw new Error(`Could not check for an existing Discord sale: ${error.message}`)
  return data?.id || null
}

export async function findRecordedInventoryOperation(supabase, requestIds) {
  const ids = [...new Set(requestIds)].filter(Boolean)
  if (ids.length === 0) return null

  const { data, error } = await supabase
    .from('rar_inventory_events')
    .select('request_id,event_type')
    .in('request_id', ids)
    .limit(1)

  if (error) throw new Error(`Could not check for an existing inventory operation: ${error.message}`)
  return data?.[0] || null
}

export async function loadInventoryEvents(supabase, requestId) {
  const { data, error } = await supabase
    .from('rar_inventory_events')
    .select('item_id,event_type,quantity_delta,balance_after,item:rar_items(name)')
    .eq('request_id', requestId)
    .order('item_id')

  if (error) throw new Error(`Could not load recorded inventory results: ${error.message}`)
  return data || []
}

export async function loadMonthlyFinancialRecords(supabase, { startInclusive, endExclusive }) {
  const [sales, inventoryEvents] = await Promise.all([
    loadAllFinancialRows(() => supabase
      .from('rar_sales')
      .select('id,sold_at,net_credit,platform_fee,currency,inventory_applied,classification')
      .in('currency', FINANCIAL_CURRENCIES)
      .gte('sold_at', startInclusive)
      .lt('sold_at', endExclusive)
      .order('sold_at')
      .order('id'), 'RAR monthly sales'),
    loadAllFinancialRows(() => supabase
      .from('rar_inventory_events')
      .select('id,event_at,event_type,cash_amount,cash_currency,request_id')
      .eq('event_type', 'supplier_purchase')
      .not('cash_amount', 'is', null)
      .in('cash_currency', FINANCIAL_CURRENCIES)
      .gte('event_at', startInclusive)
      .lt('event_at', endExclusive)
      .order('event_at')
      .order('id'), 'RAR monthly purchases'),
  ])

  return { sales, inventoryEvents }
}

export async function loadFinancialHistoryRecords(supabase) {
  const [sales, inventoryEvents] = await Promise.all([
    loadAllFinancialRows(() => supabase
      .from('rar_sales')
      .select('id,sold_at,net_credit,platform_fee,currency,inventory_applied,classification')
      .in('currency', FINANCIAL_CURRENCIES)
      .order('sold_at')
      .order('id'), 'RAR sales history'),
    loadAllFinancialRows(() => supabase
      .from('rar_inventory_events')
      .select('id,event_at,event_type,cash_amount,cash_currency,request_id')
      .eq('event_type', 'supplier_purchase')
      .not('cash_amount', 'is', null)
      .in('cash_currency', FINANCIAL_CURRENCIES)
      .order('event_at')
      .order('id'), 'RAR purchase history'),
  ])

  return { sales, inventoryEvents }
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

export async function callRpcWithRetry(supabase, functionName, payload, { attempts = 3 } = {}) {
  let lastError

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const { data, error } = await supabase.rpc(functionName, payload)
      if (!error) {
        if (data === null || data === undefined) throw new Error(`${functionName} did not return a result.`)
        return data
      }

      lastError = error
      if (!isTransientError(error) || attempt === attempts) throw error
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
    if (error) throw new Error(`Could not load ${label}: ${error.message}`)

    const page = data || []
    rows.push(...page)
    if (page.length < FINANCIAL_PAGE_SIZE) return rows
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
