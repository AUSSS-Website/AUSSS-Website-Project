import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase.js'

// Reads and writes behind /portal/admin/roster. roster_entries is EB-only by
// RLS, so none of this is reachable for a plain member even by URL.

export const PAGE_SIZE = 50

export const rosterKeys = {
  all: ['roster'],
  list: () => ['roster', 'list'],
  runs: () => ['roster', 'runs'],
  token: () => ['roster', 'token'],
  sheet: () => ['roster', 'sheet'],
  bulk: () => ['roster', 'bulk'],
  upgrades: () => ['roster', 'upgrades'],
}

const COLUMNS =
  'id, full_name, email, status, joined_year, years_spent, lgas, ngas, current_position, origin, portal_edited_at, profile_id, import_batch, updated_at'

// The columns an officer may type into; everything else is kept by the database
// (years_spent is counted from joined_year and the academic year).
export const EDITABLE = [
  'full_name',
  'email',
  'status',
  'joined_year',
  'lgas',
  'ngas',
  'current_position',
]

function unwrap({ data, error }) {
  if (error) throw error
  return data
}

// The whole roster, in name order. A few hundred rows (about 100 KB): the page
// searches it in the browser (rosterSearch.js) so typing never waits on the
// network. PostgREST caps a response at 1000 rows, hence the loop.
export async function fetchRoster() {
  const rows = []
  for (let from = 0; ; from += 1000) {
    const chunk = unwrap(
      await supabase
        .from('roster_entries')
        .select(COLUMNS)
        .order('full_name', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + 999),
    )
    rows.push(...(chunk || []))
    if (!chunk || chunk.length < 1000) return rows
  }
}

export async function saveRosterEntry({ id, values }) {
  const patch = {}
  for (const k of EDITABLE) {
    if (!(k in values)) continue
    const v = typeof values[k] === 'string' ? values[k].trim() : values[k]
    if (k === 'joined_year') {
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

// ---- bulk updates ----------------------------------------------------------

// lines: text[]. Resolves each to a roster row for review; writes nothing.
export const matchRosterLines = async (lines) =>
  unwrap(await supabase.rpc('match_roster_lines', { lines })) || []

// action: 'lga' | 'nga' | 'status'; label names the event; value is the status.
export const bulkUpdateRoster = async ({ ids, action, label, value }) =>
  unwrap(await supabase.rpc('bulk_update_roster', { ids, action, label, value: value || null }))

export const undoBulkUpdate = async (log_id) =>
  unwrap(await supabase.rpc('undo_roster_bulk_update', { log_id }))

export async function fetchBulkUpdates() {
  return (
    unwrap(
      await supabase
        .from('roster_bulk_updates')
        .select('id, at, action, value, label, changes, undone_at')
        .order('at', { ascending: false })
        .limit(8),
    ) || []
  )
}

// ---- status upgrades --------------------------------------------------------

// Members whose GA counts reach the next tier: [{ id, full_name, email, status,
// next, lgas, ngas }]. The database only proposes; the EB approves.
export const fetchUpgradeCandidates = async () =>
  unwrap(await supabase.rpc('roster_upgrade_candidates')) || []

const byTarget = (rows) => {
  const groups = new Map()
  for (const r of rows) groups.set(r.next, [...(groups.get(r.next) || []), r.id])
  return [...groups.entries()]
}

// One logged (and undoable) bulk update per target status. The minute in the
// label keeps two approvals on the same day apart, since a label applies once.
export async function approveUpgrades(rows) {
  const stamp = new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
  for (const [next, ids] of byTarget(rows)) {
    await bulkUpdateRoster({ ids, action: 'status', value: next, label: `Upgrade to ${next} · ${stamp}` })
  }
}

// "Not now": remembered per target, for the academic year it was said in.
export async function dismissUpgrades(rows) {
  const at = new Date().toISOString()
  for (const [next, ids] of byTarget(rows)) {
    unwrap(
      await supabase
        .from('roster_entries')
        .update({ upgrade_dismissed_for: next, upgrade_dismissed_at: at })
        .in('id', ids),
    )
  }
}

// ---- hooks ----------------------------------------------------------------

export function useRoster() {
  return useQuery({ queryKey: rosterKeys.list(), queryFn: fetchRoster })
}

export function useSyncRuns() {
  return useQuery({ queryKey: rosterKeys.runs(), queryFn: fetchSyncRuns })
}

export function useSheetInfo() {
  return useQuery({ queryKey: rosterKeys.sheet(), queryFn: fetchSheetInfo })
}

export function useUpgradeCandidates() {
  return useQuery({ queryKey: rosterKeys.upgrades(), queryFn: fetchUpgradeCandidates })
}

export function useBulkUpdates() {
  return useQuery({ queryKey: rosterKeys.bulk(), queryFn: fetchBulkUpdates })
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
export const useBulkUpdateRoster = () => useRosterMutation(bulkUpdateRoster)
export const useUndoBulkUpdate = () => useRosterMutation(undoBulkUpdate)
export const useApproveUpgrades = () => useRosterMutation(approveUpgrades)
export const useDismissUpgrades = () => useRosterMutation(dismissUpgrades)
export const useSetSheet = () => useRosterMutation(setSheet)
export const useSyncSheetNow = () => useRosterMutation(syncSheetNow)
