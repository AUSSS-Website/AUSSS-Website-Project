import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase.js'

// Reads and writes behind /portal/admin/roster. roster_entries is EB-only by
// RLS, so none of this is reachable for a plain member even by URL.

export const PAGE_SIZE = 50

export const rosterKeys = {
  all: ['roster'],
  list: (params) => ['roster', 'list', params],
  runs: () => ['roster', 'runs'],
  token: () => ['roster', 'token'],
  sheet: () => ['roster', 'sheet'],
}

const COLUMNS =
  'id, full_name, email, status, joined_year, years_spent, lgas, ngas, current_position, origin, portal_edited_at, profile_id, import_batch, updated_at'

// The columns an officer may type into; everything else is kept by the database.
export const EDITABLE = [
  'full_name',
  'email',
  'status',
  'joined_year',
  'years_spent',
  'lgas',
  'ngas',
  'current_position',
]

function unwrap({ data, error }) {
  if (error) throw error
  return data
}

// PostgREST reads , ( ) as syntax inside or=(); % and * are wildcards.
const safeTerm = (q) => q.toLowerCase().replace(/[,()%*\\]/g, ' ').replace(/\s+/g, ' ').trim()

export async function fetchRoster({ q = '', status = '', page = 0 }) {
  let query = supabase
    .from('roster_entries')
    .select(COLUMNS, { count: 'exact' })
    .order('full_name', { ascending: true })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
  const term = safeTerm(q)
  if (term) {
    query = query.or(`name_normalized.ilike.%${term}%,email_normalized.ilike.%${term}%`)
  }
  if (status === 'none') query = query.is('status', null)
  else if (status === 'portal') query = query.not('portal_edited_at', 'is', null)
  else if (status) query = query.ilike('status', `%${status}%`)
  const { data, error, count } = await query
  if (error) throw error
  return { rows: data || [], total: count ?? 0 }
}

export async function saveRosterEntry({ id, values }) {
  const patch = {}
  for (const k of EDITABLE) {
    if (!(k in values)) continue
    const v = typeof values[k] === 'string' ? values[k].trim() : values[k]
    if (k === 'joined_year' || k === 'years_spent') {
      patch[k] = v === '' || v == null ? null : Number(v)
    } else {
      patch[k] = v === '' ? null : v
    }
  }
  const q = id
    ? supabase.from('roster_entries').update(patch).eq('id', id)
    : supabase.from('roster_entries').insert(patch)
  return unwrap(await q.select(COLUMNS).single())
}

export async function deleteRosterEntry(id) {
  return unwrap(await supabase.from('roster_entries').delete().eq('id', id))
}

// Hand a portal-owned row back to the spreadsheet: the next import may
// overwrite it again.
export async function releaseRosterEntry(id) {
  return unwrap(
    await supabase
      .from('roster_entries')
      .update({ portal_edited_at: null, portal_edited_by: null })
      .eq('id', id)
      .select(COLUMNS)
      .single(),
  )
}

export async function importRoster({ rows, batch }) {
  return unwrap(await supabase.rpc('import_roster', { rows, batch }))
}

export async function fetchSyncRuns() {
  return (
    unwrap(
      await supabase
        .from('roster_sync_runs')
        .select('id, at, source, batch, result')
        .order('at', { ascending: false })
        .limit(5),
    ) || []
  )
}

export const fetchTokenInfo = async () => unwrap(await supabase.rpc('roster_sync_token_info'))
export const rotateToken = async () => unwrap(await supabase.rpc('rotate_roster_sync_token'))
export const revokeToken = async () => unwrap(await supabase.rpc('revoke_roster_sync_token'))

export const fetchSheetInfo = async () => unwrap(await supabase.rpc('roster_sheet_info'))
// sheet: a Google Sheets link or id; null disconnects.
export const setSheet = async (sheet) => unwrap(await supabase.rpc('set_roster_sheet', { sheet }))

// Asks the roster-sheet-sync Edge Function to pull the connected sheet now. It
// lets this call in because the session belongs to an EB member.
export async function syncSheetNow() {
  const { data, error } = await supabase.functions.invoke('roster-sheet-sync', { body: {} })
  if (error) {
    // FunctionsHttpError keeps the JSON body on .context (a Response).
    const body = await error.context?.json?.().catch(() => null)
    throw new Error(body?.error || error.message)
  }
  if (!data?.ok) throw new Error(data?.error || data?.skipped || 'The sync did not run.')
  return data.result
}

// ---- hooks ----------------------------------------------------------------

export function useRoster(params) {
  return useQuery({
    queryKey: rosterKeys.list(params),
    queryFn: () => fetchRoster(params),
    placeholderData: (prev) => prev,
  })
}

export function useSyncRuns() {
  return useQuery({ queryKey: rosterKeys.runs(), queryFn: fetchSyncRuns })
}

export function useSheetInfo() {
  return useQuery({ queryKey: rosterKeys.sheet(), queryFn: fetchSheetInfo })
}

export function useTokenInfo() {
  return useQuery({ queryKey: rosterKeys.token(), queryFn: fetchTokenInfo })
}

// Every write can move rows between filters and change linked profiles, so
// they all drop the whole roster cache rather than patching one list.
function useRosterMutation(mutationFn) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: rosterKeys.all })
      qc.invalidateQueries({ queryKey: ['profile'] })
    },
  })
}

export const useSaveRosterEntry = () => useRosterMutation(saveRosterEntry)
export const useDeleteRosterEntry = () => useRosterMutation(deleteRosterEntry)
export const useReleaseRosterEntry = () => useRosterMutation(releaseRosterEntry)
export const useImportRoster = () => useRosterMutation(importRoster)
export const useRotateToken = () => useRosterMutation(rotateToken)
export const useRevokeToken = () => useRosterMutation(revokeToken)
export const useSetSheet = () => useRosterMutation(setSheet)
export const useSyncSheetNow = () => useRosterMutation(syncSheetNow)
