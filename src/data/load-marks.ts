import type { SupabaseClient } from '@supabase/supabase-js'

const PAGE_SIZE = 500
type MarkRow = Record<string, any> & { id: string; school_id: string }

/** Read through the signed-in user's RLS context. A school snapshot is committed
 * only when this returns the complete authorized set, never a partial page.
 * Keyset pagination avoids offset shifts and uses immutable, unique mark IDs.
 */
export async function loadAuthorizedMarks(client: SupabaseClient, schoolId: string, assertScope: () => Promise<void>): Promise<MarkRow[]> {
  const rows: MarkRow[] = []
  let cursor: string | undefined
  let expected: number | undefined
  let pageSize = PAGE_SIZE
  let pageBudget = 1
  for (let page = 0; page < pageBudget; page++) {
    await assertScope()
    let query = client.from('marks').select('*', page === 0 ? { count: 'exact' } : undefined)
      .eq('school_id', schoolId).order('id', { ascending: true }).limit(pageSize)
    if (cursor) query = query.gt('id', cursor)
    const result = await query
    if (result.error || !Array.isArray(result.data)) throw new Error('Unable to load all authorized marks. Retry before using reports.')
    await assertScope()
    if (page === 0) {
      if (!Number.isSafeInteger(result.count) || result.count! < 0) throw new Error('Unable to verify the complete mark count. Retry before using reports.')
      expected = result.count!
      // Honor a lower server cap too; a short first page is not proof of EOF.
      pageSize = Math.min(PAGE_SIZE, result.data.length || PAGE_SIZE)
      pageBudget = Math.max(1, Math.ceil(expected / pageSize))
    }
    if (result.data.length > pageSize || rows.length + result.data.length > expected!) throw new Error('Mark data changed while loading. Refresh to get a complete report.')
    for (const row of result.data) {
      if (typeof row.id !== 'string' || row.school_id !== schoolId || (cursor && row.id <= cursor)) throw new Error('Invalid, duplicate or out-of-order mark page. Refresh before using reports.')
      rows.push(row as MarkRow)
      cursor = row.id
    }
    if (rows.length === expected) break
    if (!result.data.length) throw new Error('Incomplete mark retrieval. Refresh before using reports.')
  }
  if (rows.length !== expected) throw new Error('Incomplete mark retrieval. Refresh before using reports.')
  await assertScope()
  // Concurrent additions (or changed RLS visibility) must not silently produce
  // a complete-looking result. Mark IDs cannot be edited/deleted by clients.
  const final = await client.from('marks').select('id', { count: 'exact', head: true }).eq('school_id', schoolId)
  if (final.error || final.count !== expected) throw new Error('Authorized marks changed while loading. Refresh before using reports.')
  await assertScope()
  return rows
}
