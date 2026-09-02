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
    supabase.from('rar_items').select('id,name,stock,kind,active').order('name'),
    supabase.from('rar_platforms').select('id,name,active').order('name'),
  ])

  if (itemResult.error) throw new Error(`Could not load RAR items: ${itemResult.error.message}`)
  if (platformResult.error) throw new Error(`Could not load RAR platforms: ${platformResult.error.message}`)

  return {
    items: itemResult.data || [],
    platforms: platformResult.data || [],
  }
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

export async function recordSale(supabase, payload, { attempts = 3 } = {}) {
  let lastError

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const { data, error } = await supabase.rpc('rar_record_sale', payload)
      if (!error) {
        if (!data) throw new Error('The sale RPC did not return a sale ID.')
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
