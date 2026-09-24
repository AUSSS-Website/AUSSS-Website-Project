import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase.js'

// Magazine editor reads and writes (CBSD officers and the EB). Same shape as
// galleryQueries.js. Authorisation lives in the database (row-level security
// on magazine_issues and the `magazine` Storage bucket).
//
// Pages: an edition's page images are `<pages_base>/NNN.jpg`. For editions
// uploaded from the portal the base is a folder in the public `magazine`
// bucket, '<issue id>/pages', and the images are made here in the browser from
// the PDF (pdf.js, 1300 px wide JPEGs, the same size the old build script
// produced).

const BUCKET = 'magazine'
const PAGE_WIDTH = 1300
const PAGE_QUALITY = 0.82
const MAX_PAGES = 400

export const magazineKeys = {
  issues: () => ['magazine', 'issues'],
}

function unwrap({ data, error }) {
  if (error) throw error
  return data
}

const ISSUE_SELECT =
  'id, slug, title, switcher_label, date_label, blurb, status, sort_order, pages_base, page_count, hero_page, download_url, canva_url, created_at, updated_at'

export function pageUrl(issue, n) {
  if (!issue?.pages_base || !issue.page_count) return null
  return `${issue.pages_base}/${String(n).padStart(3, '0')}.jpg`
}

export function storagePagesBase(issueId) {
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(`${issueId}/pages`)
  return data.publicUrl
}

async function fetchIssues() {
  return (
    unwrap(await supabase.from('magazine_issues').select(ISSUE_SELECT).order('sort_order').order('created_at')) ||
    []
  )
}

export function useIssues(enabled = true) {
  return useQuery({ queryKey: magazineKeys.issues(), queryFn: fetchIssues, enabled })
}

async function createIssue(fields) {
  return unwrap(
    await supabase
      .from('magazine_issues')
      .insert({
        title: fields.title,
        slug: fields.slug || '',
        blurb: fields.blurb || '',
        status: fields.status || 'draft',
        // New editions go to the front of the shelf (newest first).
        sort_order: typeof fields.sort_order === 'number' ? fields.sort_order : -1,
      })
      .select(ISSUE_SELECT)
      .single(),
  )
}

async function updateIssue(id, patch) {
  return unwrap(
    await supabase.from('magazine_issues').update(patch).eq('id', id).select(ISSUE_SELECT).single(),
  )
}

// Removes the edition's uploaded pages first (if any live in the bucket), then the row.
async function deleteIssue(issue) {
  await removePages(issue.id)
  unwrap(await supabase.from('magazine_issues').delete().eq('id', issue.id))
  return issue.id
}

async function reorderIssues(ids) {
  for (let i = 0; i < ids.length; i++) {
    unwrap(await supabase.from('magazine_issues').update({ sort_order: i }).eq('id', ids[i]))
  }
  return ids
}

export function useIssueMutations() {
  const qc = useQueryClient()
  const done = () => qc.invalidateQueries({ queryKey: magazineKeys.issues() })
  const create = useMutation({ mutationFn: createIssue, onSuccess: done })
  const update = useMutation({ mutationFn: ({ id, patch }) => updateIssue(id, patch), onSuccess: done })
  const remove = useMutation({ mutationFn: deleteIssue, onSuccess: done })
  const reorder = useMutation({ mutationFn: reorderIssues, onSuccess: done })
  return { create, update, remove, reorder }
}

// ---- pages -----------------------------------------------------------------

async function removePages(issueId) {
  for (;;) {
    const { data, error } = await supabase.storage.from(BUCKET).list(`${issueId}/pages`, { limit: 100 })
    if (error) throw error
    if (!data || data.length === 0) return
    const rm = await supabase.storage.from(BUCKET).remove(data.map((o) => `${issueId}/pages/${o.name}`))
    if (rm.error) throw rm.error
    if (data.length < 100) return
  }
}

async function putPage(issueId, n, blob) {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(`${issueId}/pages/${String(n).padStart(3, '0')}.jpg`, blob, {
      contentType: 'image/jpeg',
      upsert: true,
      cacheControl: '31536000',
    })
  if (error) throw error
}

function canvasToJpeg(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the page'))),
      'image/jpeg',
      PAGE_QUALITY,
    )
  })
}

// pdf.js is ~1 MB, loaded only when an editor actually uploads a PDF.
async function loadPdfJs() {
  const pdfjs = await import('pdfjs-dist')
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  return pdfjs
}

// Renders every page of the PDF to a 1300 px wide JPEG and uploads it as
// NNN.jpg under the edition's folder; old pages beyond the new count are
// removed. `onProgress(done, total)` reports as pages land. Resolves with the
// page count.
export async function uploadPdfPages(issue, file, onProgress) {
  const pdfjs = await loadPdfJs()
  const buf = await file.arrayBuffer()
  const task = pdfjs.getDocument({ data: buf })
  const doc = await task.promise
  const total = Math.min(doc.numPages, MAX_PAGES)
  if (total === 0) throw new Error('That PDF has no pages')
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  for (let n = 1; n <= total; n++) {
    const page = await doc.getPage(n)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: PAGE_WIDTH / base.width })
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport }).promise
    await putPage(issue.id, n, await canvasToJpeg(canvas))
    page.cleanup()
    onProgress?.(n, total)
  }
  // Frees the worker's memory (the loading task owns the document in pdf.js v5).
  await task.destroy()
  await trimPages(issue.id, total)
  return total
}

// Page images picked directly (already rasterised elsewhere), in file-name order.
export async function uploadPageImages(issue, files, onProgress) {
  const list = Array.from(files)
    .filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    .slice(0, MAX_PAGES)
  if (list.length === 0) throw new Error('No page images were picked')
  for (let i = 0; i < list.length; i++) {
    const bitmap = await createImageBitmap(list[i])
    const canvas = document.createElement('canvas')
    const scale = Math.min(1, PAGE_WIDTH / bitmap.width)
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close?.()
    await putPage(issue.id, i + 1, await canvasToJpeg(canvas))
    onProgress?.(i + 1, list.length)
  }
  await trimPages(issue.id, list.length)
  return list.length
}

// Deletes NNN.jpg files numbered above `count` (a re-upload with fewer pages).
async function trimPages(issueId, count) {
  const { data, error } = await supabase.storage.from(BUCKET).list(`${issueId}/pages`, { limit: 1000 })
  if (error) throw error
  const extra = (data || [])
    .filter((o) => {
      const m = /^(\d{3})\.jpg$/.exec(o.name)
      return m && Number(m[1]) > count
    })
    .map((o) => `${issueId}/pages/${o.name}`)
  if (extra.length) {
    const rm = await supabase.storage.from(BUCKET).remove(extra)
    if (rm.error) throw rm.error
  }
}
