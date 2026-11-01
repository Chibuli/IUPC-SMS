const expectedOrigin = 'https://jqwppkakayhxttazenus.supabase.co'

/** Build-time check only. Error messages must never contain configuration values. */
export function validateProductionConfig(env: Record<string, string | undefined>) {
  let origin: string
  try {
    const url = new URL(env.VITE_SUPABASE_URL?.trim() ?? '')
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error()
    origin = url.origin
  } catch { throw new Error('Production requires the approved hosted Supabase URL.') }
  if (origin !== expectedOrigin) throw new Error('Production must target the approved hosted Supabase project.')
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? ''
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
    throw new Error('Production requires a publishable frontend key; database and privileged keys are forbidden.')
  }
  const allowed = new Set(['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'])
  if (Object.keys(env).some(name => name.startsWith('VITE_') && !allowed.has(name))) {
    throw new Error('Unexpected browser-exposed production configuration. Review VITE_ variables before building.')
  }
}
