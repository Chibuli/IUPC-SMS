const expectedOrigin = 'https://jqwppkakayhxttazenus.supabase.co'

/**
 * Vercel injects this into every build for its own observability SDK. It is a
 * public client-side value that this application never reads, so it has to sit
 * in the build environment without being mistaken for application
 * configuration. Exempt it by exact name only: a `VITE_VERCEL_` prefix rule
 * would silently approve any future vendor variable, including a real secret.
 */
const vendorBuildVariable = 'VITE_VERCEL_OBSERVABILITY_CLIENT_CONFIG'

/** Build-time check only. Error messages must never contain configuration values. */
export function validateProductionConfig(env: Record<string, string | undefined>) {
  const config = Object.fromEntries(Object.entries(env).filter(([name]) => name !== vendorBuildVariable))
  let origin: string
  try {
    const url = new URL(config.VITE_SUPABASE_URL?.trim() ?? '')
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error()
    origin = url.origin
  } catch { throw new Error('Production requires the approved hosted Supabase URL.') }
  if (origin !== expectedOrigin) throw new Error('Production must target the approved hosted Supabase project.')
  const key = config.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? ''
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
    throw new Error('Production requires a publishable frontend key; database and privileged keys are forbidden.')
  }
  const allowed = new Set(['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'])
  if (Object.keys(config).some(name => name.startsWith('VITE_') && !allowed.has(name))) {
    throw new Error('Unexpected browser-exposed production configuration. Review VITE_ variables before building.')
  }
}
