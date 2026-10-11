import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase.js'
import { errorText } from '../lib/errorText.js'

// Magazine editor reads and writes (CBSD officers and the EB). Same shape as
// galleryQueries.js. Authorisation lives in the database (row-level security
// on magazine_issues and the `magazine` Storage bucket).
//
// Pages: an edition's page images are `<pages_base>/NNN.jpg`. For editions
// uploaded from the portal the base is a folder in the public `magazine`
// bucket, and the images are made here in the browser from the PDF (pdf.js,
// 1300 px wide JPEGs, the same size the old build script produced).
//
// Every upload gets a folder of its own, '<issue id>/pages-<when it began>',
// and the edition is pointed at it only once the last page is in. So the
// pages on the site are never written over: an upload that fails or is
// stopped part-way changes nothing, and a page's address never comes to show
// another picture, which is what lets a browser keep it for a year. The
// folder an edition has left stays for a week and is then removed (see
// sweepPages). Editions uploaded before this have theirs in
// '<issue id>/pages'.

const BUCKET = 'magazine'
const PAGE_WIDTH = 1300
const PAGE_QUALITY = 0.82
const MAX_PAGES = 400
// How long a folder the edition no longer reads from is kept.
const KEEP_DAYS = 7
// The paper under a page, where the PDF or the picture is see-through.
const PAPER = '#ffffff'

export const magazineKeys = {
  issues: () => ['magazine', 'issues'],
}

function unwrap({ data, error }) {
  if (error) throw error
  return data
}

// An error with a sentence of our own, written to be shown as it is.
// `rejected` is the mark errorText (src/lib/errorText.js) looks for.
function refusal(message) {
  const err = new Error(message)
  err.rejected = true
  return err
}

// What to show when saving an edition failed. The database refuses a few
// things in its own words (a constraint's name, "link name" for what the form
// calls the ID); those are said here as the form would say them. Anything
// else goes through errorText, with `fallback` for what it cannot put a
// sentence to.
export function issueErrorText(err, fallback) {
  const message = typeof err?.message === 'string' ? err.message : ''
  if (err?.code === '23505' && /slug/.test(message)) {
    return 'Another edition already has that ID. Choose a different one.'
  }
  if (/needs a link name/.test(message)) {
    return 'The ID needs at least one English letter or number, for example vol-8.'
  }
  if (/needs a title/.test(message)) return 'Give the edition a title.'
  if (/magazine_issues_urls/.test(message)) return 'A link has to start with https://.'
  return errorText(err, fallback)
}

const ISSUE_SELECT =
  'id, slug, title, switcher_label, date_label, blurb, status, sort_order, pages_base, page_count, hero_page, download_url, canva_url, created_at, updated_at'

export function pageUrl(issue, n) {
  if (!issue?.pages_base || !issue.page_count) return null
  return `${issue.pages_base}/${String(n).padStart(3, '0')}.jpg`
}

// The public address of one of an edition's page folders: 'pages' for an
// edition uploaded before every upload had a folder of its own.
export function storagePagesBase(issueId, folder = 'pages') {
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(`${issueId}/${folder}`)
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
  await removeAllPages(issue.id)
  unwrap(await supabase.from('magazine_issues').delete().eq('id', issue.id))
  return issue.id
}

// New shelf order: the array of edition ids, first to last. No one call saves
// an order, so every row is written; they go together, and a drop is saved in
// one round trip's time however long the shelf.
async function reorderIssues(ids) {
  const results = await Promise.all(
    ids.map((id, i) => supabase.from('magazine_issues').update({ sort_order: i }).eq('id', id)),
  )
  results.forEach(unwrap)
  return ids
}

// The shelf as it will be once `ids` is saved. If the list changed under the
// drag (an edition added or removed elsewhere), it is left as it is, and the
// reading that follows the save shows what the database holds.
function inOrder(rows, ids) {
  const byId = new Map(rows.map((m) => [m.id, m]))
  if (ids.length !== rows.length || !ids.every((id) => byId.has(id))) return rows
  return ids.map((id, i) => ({ ...byId.get(id), sort_order: i }))
}

// ---- readers ---------------------------------------------------------------

// rpc/magazine_insights: totals plus the reading-depth curve for one edition
// ({ views, likes, downloads, sessions, tracked, finished, median_page,
// reach: [{ page, readers }] }). Editors only; the database checks.
export function useIssueInsights(slug) {
  return useQuery({
    queryKey: ['magazine', 'insights', slug],
    queryFn: async () => unwrap(await supabase.rpc('magazine_insights', { issue: slug })),
    enabled: Boolean(slug),
    staleTime: 60_000,
  })
}

// `update` saves the edition's form and waits for the answer. `change` is for
// one choice that takes effect at once (the status, the cover page) and
// `reorder` for a drop on the shelf: both show the new state the moment it is
// chosen and put the old one back if the save fails.
//
// Changes of one kind are sent one at a time, in the order they were made, so
// two quick ones cannot land the wrong way round (a second cover chosen before
// the first was saved is the one that stands). The shelf is read again only
// after the last of them: a reading taken in between would show the shelf
// without the ones still on their way, and the pill or the row just moved
// would jump back for a moment. So the screen ends on what the database holds.
export function useIssueMutations() {
  const qc = useQueryClient()
  const key = magazineKeys.issues()
  const changeKey = [...key, 'change']
  const orderKey = [...key, 'order']
  const done = () => qc.invalidateQueries({ queryKey: key })
  // Asked from inside a mutation's own callbacks, where that mutation still
  // counts as on its way: 1 means nothing of its kind comes after it.
  const isLast = (mutationKey) => qc.isMutating({ mutationKey }) === 1
  const overlay = (rows, id, fields) => rows.map((m) => (m.id === id ? { ...m, ...fields } : m))

  const create = useMutation({ mutationFn: createIssue, onSuccess: done })
  const update = useMutation({ mutationFn: ({ id, patch }) => updateIssue(id, patch), onSuccess: done })
  const remove = useMutation({ mutationFn: deleteIssue, onSuccess: done })
  const change = useMutation({
    mutationKey: changeKey,
    scope: { id: changeKey.join('/') },
    mutationFn: ({ id, patch }) => updateIssue(id, patch),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: key })
      const rows = qc.getQueryData(key)
      const row = rows?.find((m) => m.id === id)
      if (!row) return undefined
      qc.setQueryData(key, overlay(rows, id, patch))
      // What those fields held, to put back if the save fails.
      return { was: Object.fromEntries(Object.keys(patch).map((k) => [k, row[k]])) }
    },
    onError: (_err, { id, patch }, context) => {
      const rows = qc.getQueryData(key)
      const row = rows?.find((m) => m.id === id)
      if (!context?.was || !row) return
      // Still as this change left it? Then nothing newer is showing, and it goes back.
      if (Object.keys(patch).every((k) => row[k] === patch[k])) qc.setQueryData(key, overlay(rows, id, context.was))
    },
    onSettled: () => {
      if (isLast(changeKey)) done()
    },
  })
  const reorder = useMutation({
    mutationKey: orderKey,
    // A second drop made while the first is still on its way waits for it, so
    // the rows of two orders never mix.
    scope: { id: orderKey.join('/') },
    mutationFn: reorderIssues,
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: key })
      const before = qc.getQueryData(key)
      if (before) qc.setQueryData(key, inOrder(before, ids))
      return { before }
    },
    // A later drop writes every row again, so while one is waiting its order
    // stays on the screen; only the last drop puts the shelf back.
    onError: (_err, _ids, context) => {
      if (context?.before && isLast(orderKey)) qc.setQueryData(key, context.before)
    },
    onSettled: () => {
      if (isLast(orderKey)) done()
    },
  })
  return { create, update, remove, change, reorder }
}

// ---- pages -----------------------------------------------------------------

function newPagesFolder() {
  return `pages-${Date.now()}`
}

// The folder of the bucket an edition's pages are read from, or null when
// they are not in the bucket (an edition built into the site, one with no
// pages). Read from the end of the address, so it still holds if the
// project's own address ever changes.
function liveFolder(issueId, pagesBase) {
  const base = pagesBase || ''
  const tail = `/${BUCKET}/${issueId}/`
  const at = base.lastIndexOf(tail)
  if (at === -1) return null
  const folder = base.slice(at + tail.length)
  return folder && !folder.includes('/') ? folder : null
}

// Which of an edition's folders can go. `names` are the folders under
// '<issue id>/', `live` is the one the edition reads from (null for none) and
// `now` is the time in ms. Every page folder but the live one is on its way
// out: the pages an upload replaced, or what an upload left behind when its
// tab was closed. It is kept for KEEP_DAYS after the later of its own start
// and the live folder's, because for a while it may still be wanted: the
// pre-rendered page and its link preview name the old pages until the site is
// rebuilt, a reader may be half-way through them, and an upload that began a
// minute ago in another editor's browser is not the live one yet.
export function stalePagesFolders(names, live, now) {
  const began = (name) => Number(/^pages-(\d+)$/.exec(name || '')?.[1] || 0)
  const cutoff = now - KEEP_DAYS * 86400000
  return names.filter(
    (name) => name !== live && /^pages(-\d+)?$/.test(name) && Math.max(began(name), began(live)) < cutoff,
  )
}

async function listUnder(path, limit) {
  const { data, error } = await supabase.storage.from(BUCKET).list(path, { limit })
  if (error) throw error
  return data || []
}

// The folders under '<issue id>/'. In a listing a folder has no id of its own.
async function listFolders(issueId) {
  return (await listUnder(issueId, 1000)).filter((o) => o.id == null).map((o) => o.name)
}

// Everything in one of an edition's folders, in pages of 100. It stops when a
// round removes nothing, so a refusal can never keep it going round.
async function removeFolder(issueId, folder) {
  for (;;) {
    const files = await listUnder(`${issueId}/${folder}`, 100)
    if (files.length === 0) return
    const rm = await supabase.storage.from(BUCKET).remove(files.map((o) => `${issueId}/${folder}/${o.name}`))
    if (rm.error) throw rm.error
    if (files.length < 100 || !rm.data?.length) return
  }
}

// Every folder of the edition, for when the edition itself goes.
async function removeAllPages(issueId) {
  for (const folder of await listFolders(issueId)) await removeFolder(issueId, folder)
}

// Where the edition reads its pages from at this moment, or null if the
// edition is gone.
async function readPagesBase(issueId) {
  const row = unwrap(await supabase.from('magazine_issues').select('pages_base').eq('id', issueId).maybeSingle())
  return row ? row.pages_base : null
}

// Removes the folders the edition has left, once they are a week old
// (stalePagesFolders). Runs when an editor opens the edition and after an
// upload, so the bucket tidies itself without a scheduled job. Resolves with
// how many folders went. The edition is read again here and not taken from
// the caller: what a screen holds may be days old, and the folder it names
// may no longer be the live one.
export async function sweepPages(issueId) {
  const base = await readPagesBase(issueId)
  if (base == null) return 0
  const stale = stalePagesFolders(await listFolders(issueId), liveFolder(issueId, base), Date.now())
  for (const folder of stale) await removeFolder(issueId, folder)
  return stale.length
}

async function putPage(issueId, folder, n, blob) {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(`${issueId}/${folder}/${String(n).padStart(3, '0')}.jpg`, blob, {
      contentType: 'image/jpeg',
      // The folder is new, so there is nothing here to write over.
      upsert: false,
      cacheControl: '31536000',
    })
  if (error) throw error
}

// The editor pressed Stop: the upload ends at the next page. The page that
// shows the outcome tells this from a failure by `stopped`.
function stopIfAsked(signal) {
  if (!signal?.aborted) return
  const err = new Error('The upload was stopped.')
  err.stopped = true
  throw err
}

// One upload from start to finish. `render(put)` makes the pages, hands each
// to `put(n, blob)` and resolves with how many there are. They go into a new
// folder, and only when all of them are in is the edition pointed at it:
// until then the site shows the pages it had. If anything fails, or the
// editor stops it, the new folder is removed and nothing has changed (the one
// failure whose outcome cannot be known is marked `unsure`, see below).
// Resolves with the page count.
async function replacePages(issue, signal, render) {
  const folder = newPagesFolder()
  const base = storagePagesBase(issue.id, folder)
  // Nothing reads from the new folder, so what reached it can go. If that
  // fails as well (the connection is down), sweepPages takes it in a week.
  const discard = () => removeFolder(issue.id, folder).catch(() => {})
  let count
  try {
    count = await render((n, blob) => putPage(issue.id, folder, n, blob))
    stopIfAsked(signal)
  } catch (err) {
    await discard()
    throw err
  }
  try {
    await updateIssue(issue.id, { pages_base: base, page_count: count })
  } catch (err) {
    // The change may have been made and only its answer lost on the way back,
    // so the edition is read again. If it is reading from the new folder, the
    // upload did succeed. If it is not, the folder goes and nothing has
    // changed. If it cannot be read either, nobody knows which pages it shows:
    // the folder stays (sweepPages takes it in a week if it was never used)
    // and the editor is told as much, by an error marked `unsure`.
    const now = await readPagesBase(issue.id).catch(() => undefined)
    if (now === undefined) {
      throw Object.assign(
        refusal(
          'The new pages were uploaded, but we couldn’t see whether the edition switched to them. Check your connection, then reload this page.',
        ),
        { unsure: true },
      )
    }
    if (now !== base) {
      await discard()
      throw err
    }
  }
  // Tidying up is no part of the upload: if it fails, the next visit does it.
  await sweepPages(issue.id).catch(() => {})
  return count
}

function canvasToJpeg(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(refusal('Could not encode the page.'))),
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

// pdf.js says why it could not open a file in its own terms ("Invalid PDF
// structure."); the editor is told what to do about it.
async function openPdf(task) {
  try {
    return await task.promise
  } catch (err) {
    throw refusal(
      err?.name === 'PasswordException'
        ? 'That PDF is locked with a password. Save a copy without one and upload that.'
        : 'That file couldn’t be read as a PDF.',
    )
  }
}

async function readImage(file) {
  try {
    return await createImageBitmap(file)
  } catch {
    throw refusal(`${file.name} couldn’t be read as an image.`)
  }
}

// Renders every page of the PDF to a 1300 px wide JPEG and uploads it as
// NNN.jpg into a new folder, then points the edition at that folder (see
// replacePages). `onProgress(done, total)` reports once the PDF is open and
// as each page lands. `options.signal` is an AbortSignal: once it is aborted
// the upload stops before the next page and nothing is changed. Resolves with
// the page count.
export async function uploadPdfPages(issue, file, onProgress, { signal } = {}) {
  return replacePages(issue, signal, async (put) => {
    const pdfjs = await loadPdfJs()
    const task = pdfjs.getDocument({ data: await file.arrayBuffer() })
    try {
      const doc = await openPdf(task)
      const total = Math.min(doc.numPages, MAX_PAGES)
      if (total === 0) throw refusal('That PDF has no pages.')
      onProgress?.(0, total)
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      for (let n = 1; n <= total; n++) {
        stopIfAsked(signal)
        const page = await doc.getPage(n)
        const unit = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({ scale: PAGE_WIDTH / unit.width })
        canvas.width = Math.round(viewport.width)
        canvas.height = Math.round(viewport.height)
        ctx.fillStyle = PAPER
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        await page.render({ canvasContext: ctx, viewport }).promise
        await put(n, await canvasToJpeg(canvas))
        page.cleanup()
        onProgress?.(n, total)
      }
      return total
    } finally {
      // Frees the worker's memory (the loading task owns the document in
      // pdf.js), whether the upload finished or not.
      await task.destroy().catch(() => {})
    }
  })
}

// Page images picked directly (already rasterised elsewhere), in file-name
// order. Otherwise as uploadPdfPages.
export async function uploadPageImages(issue, files, onProgress, { signal } = {}) {
  const list = Array.from(files)
    .filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    .slice(0, MAX_PAGES)
  if (list.length === 0) throw refusal('No page images were picked.')
  return replacePages(issue, signal, async (put) => {
    onProgress?.(0, list.length)
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    for (let i = 0; i < list.length; i++) {
      stopIfAsked(signal)
      const bitmap = await readImage(list[i])
      const scale = Math.min(1, PAGE_WIDTH / bitmap.width)
      canvas.width = Math.round(bitmap.width * scale)
      canvas.height = Math.round(bitmap.height * scale)
      // A see-through picture gets white paper under it, as a PDF page does;
      // saved as a JPEG it would turn black there.
      ctx.fillStyle = PAPER
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      bitmap.close?.()
      await put(i + 1, await canvasToJpeg(canvas))
      onProgress?.(i + 1, list.length)
    }
    return list.length
  })
}
