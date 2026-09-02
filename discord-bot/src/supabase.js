import { createClient } from '@supabase/supabase-js'

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

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
