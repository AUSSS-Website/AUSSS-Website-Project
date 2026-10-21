import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase.js'
import { resizeImage } from '../lib/resizeImage.js'
import { PDF_SAFE_OPTIONS, loadPdfJs } from '../lib/loadPdfJs.js'
import { fileSize } from '../lib/documents.js'

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
//
// A file the browser cannot read as a picture never reaches the server, and
// trying again would not help. That error is marked `rejected`, which
// errorText (src/lib/errorText.js) shows as written; a failed upload is left
// as the storage answered it.
export async function uploadContentImage(key, file, maxPx = 1600) {
  let blob
  try {
    blob = await resizeImage(file, maxPx)
  } catch {
    const unreadable = new Error('That file could not be read as a picture. Choose a JPEG, PNG or WebP file.')
    unreadable.rejected = true
    throw unreadable
  }
  const path = `${key}/${crypto.randomUUID()}.jpg`
  const { error } = await supabase.storage.from('content-media').upload(path, blob, {
    contentType: 'image/jpeg',
    upsert: false,
    cacheControl: '31536000',
  })
  if (error) throw error
  return supabase.storage.from('content-media').getPublicUrl(path).data.publicUrl
}

// ---- PDFs ------------------------------------------------------------------

// The most the `content-files` bucket takes (migration 20261021111130).
export const PDF_MAX_BYTES = 25 * 1024 * 1024

// An error the person can act on, shown as written (see uploadContentImage).
function refused(message) {
  const e = new Error(message)
  e.rejected = true
  return e
}

// A PDF says so in its first bytes ("%PDF-"), nearly always at the very start.
function looksLikePdf(bytes) {
  const head = bytes.subarray(0, 1024)
  let text = ''
  for (const b of head) text += String.fromCharCode(b)
  return text.includes('%PDF-')
}

async function countPages(bytes) {
  const pdfjs = await loadPdfJs()
  // pdf.js takes the bytes it is given to its worker, so it gets a copy.
  const task = pdfjs.getDocument({ data: bytes.slice(), ...PDF_SAFE_OPTIONS })
  try {
    const doc = await task.promise
    return doc.numPages
  } finally {
    task.destroy().catch(() => {})
  }
}

// A PDF for a pdf field: checked and read in the browser (is it a PDF, is it
// small enough, can it be opened, how many pages), then stored in the public
// `content-files` bucket under the block's folder with a name of its own. A
// new version is always a new file, so nobody is ever served a cached copy of
// the old one under the new address. Returns what the document keeps:
// { url, name, pages, bytes }.
//
// A file that fails a check never reaches the server; those errors are
// marked `rejected` and say what to do.
export async function uploadContentPdf(key, file) {
  if (file.size > PDF_MAX_BYTES) {
    throw refused(`That file is ${fileSize(file.size)}, and the most the site takes is 25 MB. Save a smaller copy of the PDF and choose that.`)
  }
  let bytes
  try {
    bytes = new Uint8Array(await file.arrayBuffer())
  } catch {
    throw refused('That file could not be read. Choose it again.')
  }
  if (!looksLikePdf(bytes)) {
    throw refused('That file is not a PDF. Save or export the document as a PDF and choose that.')
  }
  let pages
  try {
    pages = await countPages(bytes)
  } catch {
    throw refused('That PDF could not be opened. It may be damaged or locked with a password. Save a fresh copy without a password and choose that.')
  }
  const path = `${key}/${crypto.randomUUID()}.pdf`
  // The bytes that were checked, labelled as a PDF. supabase-js sends a file
  // under the type the browser guessed from its name, ignoring contentType,
  // and the bucket takes application/pdf alone.
  const body = new Blob([bytes], { type: 'application/pdf' })
  const { error } = await supabase.storage.from('content-files').upload(path, body, {
    contentType: 'application/pdf',
    upsert: false,
    cacheControl: '31536000',
  })
  if (error) throw error
  return {
    url: supabase.storage.from('content-files').getPublicUrl(path).data.publicUrl,
    name: file.name,
    pages,
    bytes: file.size,
  }
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
