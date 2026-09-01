import { createClient } from '@supabase/supabase-js'

export const SUPABASE_URL = 'https://aiufjjedsgatmnhocxyz.supabase.co'
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_izEtafPfqUazScWRmBfocw_acP5teS7'

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})

export function readableError(error, fallback = 'Something went wrong. Please try again.') {
  if (!error) return fallback
  const message = error.message || String(error)

  const friendlyMessages = {
    'Invalid login credentials': 'The email or password is incorrect.',
    'Email not confirmed': 'Please confirm your email before signing in.',
    'User already registered': 'An account already exists for this email.',
  }

  return friendlyMessages[message] || message || fallback
}
