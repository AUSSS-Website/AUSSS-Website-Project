import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase.js'
import { resizeImage } from '../lib/resizeImage.js'

// The content editor's reads and writes (public.content_blocks) and the
// webmaster's audit log. Row-level security decides which blocks a person
// sees; the three write functions check the same rule again.

const contentKeys = {
  blocks: () => ['content-blocks'],
  block: (key) => ['content-block', key],
  audit: (filters) => ['audit-log', filters],
}

function unwrap({ data, error }) {
  if (error) throw error
  return data
}

const BLOCK_SELECT =
  'key, editors, draft, published, draft_saved_at, draft_saved_by, published_at, published_by, updated_at'

// The blocks this person may edit, without their documents.
export function useContentBlocks() {
  return useQuery({
    queryKey: contentKeys.blocks(),
    queryFn: async () =>
      unwrap(
        await supabase
          .from('content_blocks')
          .select('key, editors, has_draft:draft_saved_at, published_at, updated_at')
          .order('key'),
      ) || [],
  })
}

// One block with its working copy and its published copy; null when the
// person may not edit it (or it does not exist).
export function useContentBlock(key) {
  return useQuery({
    queryKey: contentKeys.block(key),
    queryFn: async () =>
      unwrap(await supabase.from('content_blocks').select(BLOCK_SELECT).eq('key', key).maybeSingle()),
    enabled: Boolean(key),
  })
}

// action: 'save' keeps a draft, 'publish' puts the document on the site,
// 'discard' throws the draft away. `base` is the updated_at the editor
// loaded, so a save over someone else's newer version is refused.
async function writeBlock({ action, key, doc, base }) {
  if (action === 'discard') return unwrap(await supabase.rpc('discard_content_draft', { p_key: key }))
  const fn = action === 'publish' ? 'publish_content' : 'save_content_draft'
  return unwrap(await supabase.rpc(fn, { p_key: key, p_doc: doc, p_base: base || null }))
}

export function useWriteContentBlock() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: writeBlock,
    onSuccess: (row) => {
      if (row?.key) qc.setQueryData(contentKeys.block(row.key), row)
      qc.invalidateQueries({ queryKey: contentKeys.blocks() })
    },
  })
}

// A picture for an image field: shrunk in the browser, stored in the public
// `content-media` bucket under the block's own folder, returned as the
// address the document keeps.
export async function uploadContentImage(key, file, maxPx = 1600) {
  const blob = await resizeImage(file, maxPx)
  const path = `${key}/${crypto.randomUUID()}.jpg`
  const { error } = await supabase.storage.from('content-media').upload(path, blob, {
    contentType: 'image/jpeg',
    upsert: false,
    cacheControl: '31536000',
  })
  if (error) throw error
  return supabase.storage.from('content-media').getPublicUrl(path).data.publicUrl
}

// ---- audit log (webmaster) --------------------------------------------------

export const AUDIT_PAGE_SIZE = 40

// One page of the log, newest first. `table` and `action` narrow it.
async function fetchAudit({ table, action, page }) {
  let q = supabase
    .from('audit_log')
    .select('id, at, actor, table_name, row_id, action, before, after')
    .order('at', { ascending: false })
    .order('id', { ascending: false })
    .range(page * AUDIT_PAGE_SIZE, page * AUDIT_PAGE_SIZE + AUDIT_PAGE_SIZE - 1)
  if (table) q = q.eq('table_name', table)
  if (action) q = q.eq('action', action)
  const { data, error } = await q
  if (error) throw error
  return { rows: data || [] }
}

export function useAuditLog(filters) {
  return useQuery({
    queryKey: contentKeys.audit(filters),
    queryFn: () => fetchAudit(filters),
    placeholderData: (prev) => prev,
  })
}
