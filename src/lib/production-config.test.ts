import { describe, expect, it } from 'vitest'
import { validateProductionConfig } from './production-config'

const valid = { VITE_SUPABASE_URL: 'https://jqwppkakayhxttazenus.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fictional_test_only' }
describe('production build configuration', () => {
  it('accepts the approved hosted target and a publishable key', () => {
    expect(() => validateProductionConfig(valid)).not.toThrow()
  })
  it.each(['http://localhost:54321', 'http://127.0.0.1:54321', 'https://another-project.supabase.co', 'https://jqwppkakayhxttazenus.supabase.co/?password=fictional'])('rejects an incorrect production endpoint', url => {
    expect(() => validateProductionConfig({ ...valid, VITE_SUPABASE_URL: url })).toThrow()
  })
  it.each(['', 'sb_secret_fictional', 'postgresql://fictional', 'eyJ.fictional.legacy'])('rejects non-publishable keys without echoing them', key => {
    expect(() => validateProductionConfig({ ...valid, VITE_SUPABASE_PUBLISHABLE_KEY: key })).toThrow('Production requires a publishable frontend key')
  })
  it('rejects accidental browser exposure of additional secrets', () => {
    expect(() => validateProductionConfig({ ...valid, VITE_DATABASE_PASSWORD: 'fictional' })).toThrow('Unexpected browser-exposed')
  })
})
