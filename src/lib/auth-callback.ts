/** URL intent selects a screen only; an Auth session is still required. */
export function readAuthCallbackIntent(search: string, hash: string) {
  const query = new URLSearchParams(search)
  const fragment = new URLSearchParams(hash.replace(/^#/, ''))
  const error = ['error', 'error_code', 'error_description'].some(key => query.has(key) || fragment.has(key))
  return {
    error,
    implicit: fragment.has('access_token') && fragment.has('refresh_token'),
    pkce: Boolean(query.get('code')),
    setup: !error && (
      (query.get('setup') === '1' && Boolean(query.get('code'))) ||
      (fragment.has('access_token') && fragment.has('refresh_token') && ['invite', 'recovery'].includes(fragment.get('type') ?? ''))
    ),
  }
}

// Capture intent before the SDK consumes callback parameters. Tokens are never
// copied here; the existing Supabase client performs the exchange/validation.
export const initialAuthCallback = typeof window === 'undefined'
  ? { error: false, setup: false, implicit: false, pkce: false }
  : readAuthCallbackIntent(window.location.search, window.location.hash)
