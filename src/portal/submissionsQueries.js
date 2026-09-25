import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase.js'

// Reads and writes for the Submissions page: merch orders, exchange stories and
// the recruitment waitlist, the three public forms that used to land in Google
// Sheets. Same shape as officerQueries.js. Who sees what is decided in the
// database (app.can_triage): the EB reads all three, the exchange officers
// read stories; a person without access simply gets an empty list.

const RECEIPTS_BUCKET = 'receipts'
const LIMIT = 500

export const submissionKeys = {
  list: (kind) => ['submissions', kind],
  counts: () => ['submissions', 'counts'],
}

function unwrap({ data, error }) {
  if (error) throw error
  return data
}

export const TABLES = {
  orders: 'orders',
  stories: 'stories',
  signups: 'signups',
}

const SELECT = {
  orders:
    'id, ref, status, name, email, phone, is_member, lc, year, payment_method, items, subtotal, client_subtotal, price_flag, notes, officer_notes, receipt_path, created_at, updated_at',
  stories:
    'id, ref, status, name, email, phone, destination, programme, year, story, notes, created_at, updated_at',
  signups: 'id, kind, status, name, email, phone, notes, created_at, updated_at',
}

async function fetchList(kind) {
  return (
    unwrap(
      await supabase
        .from(TABLES[kind])
        .select(SELECT[kind])
        .order('created_at', { ascending: false })
        .limit(LIMIT),
    ) || []
  )
}

export function useSubmissions(kind, enabled = true) {
  return useQuery({
    queryKey: submissionKeys.list(kind),
    queryFn: () => fetchList(kind),
    enabled,
  })
}

// How many of each are still 'new': the nav badge and the dashboard panel.
async function fetchCounts() {
  const count = async (table) => {
    const { count: n, error } = await supabase
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('status', 'new')
    if (error) throw error
    return n || 0
  }
  const [orders, stories, signups] = await Promise.all([
    count('orders'),
    count('stories'),
    count('signups'),
  ])
  return { orders, stories, signups }
}

export function useSubmissionCounts(enabled = true) {
  return useQuery({ queryKey: submissionKeys.counts(), queryFn: fetchCounts, enabled })
}

async function patchRow(kind, id, patch) {
  return unwrap(
    await supabase.from(TABLES[kind]).update(patch).eq('id', id).select(SELECT[kind]).single(),
  )
}

// An order's receipt goes with it (the EB may delete in the bucket); a failure
// there is not fatal, the file would just linger.
async function deleteRow(kind, id, receiptPath) {
  if (kind === 'orders' && receiptPath) {
    await supabase.storage.from(RECEIPTS_BUCKET).remove([receiptPath])
  }
  unwrap(await supabase.from(TABLES[kind]).delete().eq('id', id))
  return id
}

export function useSubmissionMutations(kind) {
  const qc = useQueryClient()
  const key = submissionKeys.list(kind)
  const update = useMutation({
    mutationFn: ({ id, patch }) => patchRow(kind, id, patch),
    onSuccess: (row) => {
      qc.setQueryData(key, (prev) =>
        Array.isArray(prev) ? prev.map((r) => (r.id === row.id ? row : r)) : prev,
      )
      qc.invalidateQueries({ queryKey: submissionKeys.counts() })
    },
  })
  const remove = useMutation({
    mutationFn: ({ id, receiptPath }) => deleteRow(kind, id, receiptPath),
    onSuccess: (id) => {
      qc.setQueryData(key, (prev) => (Array.isArray(prev) ? prev.filter((r) => r.id !== id) : prev))
      qc.invalidateQueries({ queryKey: submissionKeys.counts() })
    },
  })
  return { update, remove }
}

// A short-lived link to the buyer's receipt (the bucket is private).
export async function receiptUrl(path) {
  const { data, error } = await supabase.storage.from(RECEIPTS_BUCKET).createSignedUrl(path, 600)
  if (error) throw error
  return data.signedUrl
}

// ---- exports ---------------------------------------------------------------
// (the CSV / PDF builders are in exportFile.js; this is the one order-specific formatter)

// One readable line per order item, for a spreadsheet cell.
export function itemsSummary(items) {
  return (Array.isArray(items) ? items : [])
    .map((it) => {
      const variant = [it.size, it.design].filter(Boolean).join(' / ')
      return `${it.qty}× ${it.name}${variant ? ` (${variant})` : ''} = ${it.line_total} EGP`
    })
    .join('\n')
}
