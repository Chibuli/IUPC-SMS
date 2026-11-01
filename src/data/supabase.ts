import { createClient } from '@supabase/supabase-js'
import { initialAuthCallback } from '../lib/auth-callback'

const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? ''
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? ''

export const supabaseConfigured = Boolean(url && publishableKey)

/** Only the publishable key belongs in this browser client; RLS is mandatory. */
export const supabase = supabaseConfigured
  ? createClient(url, publishableKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        storage: typeof window !== 'undefined' ? window.sessionStorage : undefined,
        detectSessionInUrl: true,
        // Admin invitations return an implicit callback; ordinary sign-in and
        // recovery requests retain PKCE. The SDK validates either callback.
        flowType: initialAuthCallback.implicit ? 'implicit' : 'pkce',
      },
      global: { headers: { 'X-Client-Info': 'iupc-academy-web' } },
    })
  : null
