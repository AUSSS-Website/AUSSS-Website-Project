import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase.js'

// Officer-side reads and writes: site settings (EB), the committee page
// document, Open Calls and their applications. Same shape as queries.js:
// plain async functions first, react-query hooks underneath. Authorisation
// is entirely in the database (row-level security and the RPCs); these
// helpers only decide what to fetch.

const officerKeys = {
  siteSettings: () => ['site-settings'],
  committee: (slug) => ['committee', slug],
  calls: (slug) => ['calls', slug],
  applications: (callId) => ['applications', callId],
}

function unwrap({ data, error }) {
  if (error) throw error
  return data
}

// ---- site settings ---------------------------------------------------------

// Returns { key: value } for every row.
async function fetchSiteSettings() {
  const rows = unwrap(await supabase.from('site_settings').select('key,value,updated_at'))
  const out = {}
  for (const r of rows || []) out[r.key] = r.value
  return out
}

async function upsertSiteSetting(key, value) {
  return unwrap(
    await supabase
      .from('site_settings')
      .upsert({ key, value }, { onConflict: 'key' })
      .select('key,value')
      .single(),
  )
}

export function useSiteSettingsAdmin(enabled = true) {
  return useQuery({
    queryKey: officerKeys.siteSettings(),
    queryFn: fetchSiteSettings,
    enabled,
  })
}

export function useUpsertSiteSetting() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ key, value }) => upsertSiteSetting(key, value),
    onSuccess: (row) => {
      qc.setQueryData(officerKeys.siteSettings(), (prev) => ({
        ...(prev || {}),
        [row.key]: row.value,
      }))
    },
  })
}

// ---- committee page --------------------------------------------------------

const COMMITTEE_SELECT = 'id, slug, name, abbr, kind, color, logo, sort, active, page'

async function fetchCommittees() {
  const rows = unwrap(
    await supabase.from('committees').select(COMMITTEE_SELECT).eq('active', true).order('sort'),
  )
  return rows || []
}

export function useCommittees(enabled = true) {
  return useQuery({
    queryKey: ['committees'],
    queryFn: fetchCommittees,
    enabled,
  })
}

async function fetchCommittee(slug) {
  return unwrap(
    await supabase.from('committees').select(COMMITTEE_SELECT).eq('slug', slug).maybeSingle(),
  )
}

// RPC: the database normalises the document and returns what it stored.
// Pass {} to clear the override.
async function saveCommitteePage(slug, page) {
  return unwrap(await supabase.rpc('save_committee_page', { slug, page }))
}

export function useCommittee(slug) {
  return useQuery({
    queryKey: officerKeys.committee(slug),
    queryFn: () => fetchCommittee(slug),
    enabled: Boolean(slug),
  })
}

export function useSaveCommitteePage(slug) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (page) => saveCommitteePage(slug, page),
    onSuccess: (page) => {
      qc.setQueryData(officerKeys.committee(slug), (prev) => (prev ? { ...prev, page } : prev))
    },
  })
}

// ---- photos (Storage bucket committee-media, path <slug>/<file>) -----------

// Uploads a Blob/File and returns its public URL. Officers may only write
// under their committee's folder (storage policy); the bucket allows images
// up to 5 MB, so callers should downscale first (see resizeImageToBlob).
export async function uploadCommitteePhoto(slug, blob, { hint = 'photo', ext = 'jpg' } = {}) {
  const safeHint = String(hint).replace(/[^a-z0-9_-]+/gi, '-').slice(0, 40) || 'photo'
  const path = `${slug}/${safeHint}-${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('committee-media').upload(path, blob, {
    contentType: blob.type || 'image/jpeg',
    upsert: false,
    cacheControl: '31536000',
  })
  if (error) throw error
  const { data } = supabase.storage.from('committee-media').getPublicUrl(path)
  return data.publicUrl
}

// Downscale a picked image to a JPEG blob before upload (longest side `max`).
export function resizeImageToBlob(file, max = 512, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = reject
    reader.onload = () => {
      const img = new Image()
      img.onerror = reject
      img.onload = () => {
        let { width, height } = img
        if (width >= height && width > max) {
          height = Math.round((height * max) / width)
          width = max
        } else if (height > max) {
          width = Math.round((width * max) / height)
          height = max
        }
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        canvas.getContext('2d').drawImage(img, 0, 0, width, height)
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode image'))),
          'image/jpeg',
          quality,
        )
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}

// ---- calls (officer view) --------------------------------------------------

// Every column, including notify_email, plus the application count. RLS
// returns the committee's calls only for its officers/EB; others would see
// just the live ones, but the UI never sends them here.
const CALL_SELECT =
  'id, committee_id, status, title, kind, summary, description, commitment, deadline, notify_email, positions, questions, created_by, created_at, updated_at, applications(count)'

// Same rule as the database view: open + past deadline = expired.
function effectiveStatus(call) {
  if (!call) return 'draft'
  if (call.status !== 'open') return call.status
  if (call.deadline && call.deadline < todayCairo()) return 'expired'
  return 'open'
}

// YYYY-MM-DD in Africa/Cairo, matching app.today_cairo().
export function todayCairo() {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Cairo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

function normalizeCallRow(row) {
  const count = Array.isArray(row.applications) ? row.applications[0]?.count ?? 0 : 0
  const { applications, ...rest } = row
  return {
    ...rest,
    deadline: rest.deadline || '',
    notify_email: rest.notify_email || '',
    applications: count,
    effectiveStatus: effectiveStatus(rest),
  }
}

async function fetchCommitteeCalls(committeeId) {
  const rows = unwrap(
    await supabase
      .from('calls')
      .select(CALL_SELECT)
      .eq('committee_id', committeeId)
      .order('created_at', { ascending: false }),
  )
  return (rows || []).map(normalizeCallRow)
}

// fields: { title, kind, summary, description, commitment, deadline ('' → null),
//           notify_email ('' → null), positions[], questions[], status }
function toCallRow(fields) {
  return {
    title: fields.title,
    kind: fields.kind || '',
    summary: fields.summary || '',
    description: fields.description || '',
    commitment: fields.commitment || '',
    deadline: fields.deadline || null,
    notify_email: fields.notify_email || null,
    positions: Array.isArray(fields.positions) ? fields.positions : [],
    questions: Array.isArray(fields.questions) ? fields.questions : [],
    status: fields.status || 'open',
  }
}

async function createCall(committeeId, fields) {
  const row = unwrap(
    await supabase
      .from('calls')
      .insert({ committee_id: committeeId, ...toCallRow(fields) })
      .select(CALL_SELECT)
      .single(),
  )
  return normalizeCallRow(row)
}

async function updateCall(id, fields) {
  const row = unwrap(
    await supabase.from('calls').update(toCallRow(fields)).eq('id', id).select(CALL_SELECT).single(),
  )
  return normalizeCallRow(row)
}

async function setCallStatus(id, status) {
  const row = unwrap(
    await supabase.from('calls').update({ status }).eq('id', id).select(CALL_SELECT).single(),
  )
  return normalizeCallRow(row)
}

async function deleteCall(id) {
  unwrap(await supabase.from('calls').delete().eq('id', id))
  return id
}

export function useCommitteeCalls(slug, committeeId) {
  return useQuery({
    queryKey: officerKeys.calls(slug),
    queryFn: () => fetchCommitteeCalls(committeeId),
    enabled: Boolean(committeeId),
  })
}

// One hook, four mutations; all of them invalidate the committee's list.
export function useCallMutations(slug, committeeId) {
  const qc = useQueryClient()
  const done = () => qc.invalidateQueries({ queryKey: officerKeys.calls(slug) })
  const create = useMutation({ mutationFn: (fields) => createCall(committeeId, fields), onSuccess: done })
  const update = useMutation({ mutationFn: ({ id, fields }) => updateCall(id, fields), onSuccess: done })
  const status = useMutation({ mutationFn: ({ id, status }) => setCallStatus(id, status), onSuccess: done })
  const remove = useMutation({ mutationFn: (id) => deleteCall(id), onSuccess: done })
  return { create, update, status, remove }
}

// ---- applications ----------------------------------------------------------

const APPLICATION_SELECT =
  'id, ref, call_id, committee_id, call_title, name, email, phone, year, positions, motivation, answers, status, notes, created_at'

async function fetchApplications(callId) {
  const rows = unwrap(
    await supabase
      .from('applications')
      .select(APPLICATION_SELECT)
      .eq('call_id', callId)
      .order('created_at', { ascending: false }),
  )
  return rows || []
}

async function updateApplication(id, patch) {
  return unwrap(
    await supabase
      .from('applications')
      .update(patch)
      .eq('id', id)
      .select(APPLICATION_SELECT)
      .single(),
  )
}

export function useApplications(callId) {
  return useQuery({
    queryKey: officerKeys.applications(callId),
    queryFn: () => fetchApplications(callId),
    enabled: Boolean(callId),
  })
}

export function useUpdateApplication(callId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }) => updateApplication(id, patch),
    onSuccess: (row) => {
      qc.setQueryData(officerKeys.applications(callId), (prev) =>
        Array.isArray(prev) ? prev.map((a) => (a.id === row.id ? row : a)) : prev,
      )
    },
  })
}
