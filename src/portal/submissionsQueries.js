import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase.js'

// Reads and writes for the Submissions page: merch orders, exchange stories and
// the recruitment waitlist, the three public forms that used to land in Google
// Sheets. Same shape as officerQueries.js. Who sees what is decided in the
// database (app.can_triage): the EB reads all three, the exchange officers
// read stories; a person without access simply gets an empty list.
//
// The same rows are on the Merch page (OrdersPanel.jsx), through the same
// hooks: a change to how a write behaves here is a change there too.

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
    'id, ref, status, name, email, phone, destination, programme, year, story, notes, featured, public_name, public_story, published_at, created_at, updated_at',
  signups: 'id, kind, status, name, email, phone, notes, created_at, updated_at',
}

async function fetchList(kind) {
  const rows =
    unwrap(
      await supabase
        .from(TABLES[kind])
        .select(SELECT[kind])
        .order('created_at', { ascending: false })
        .limit(LIMIT),
    ) || []
  return withFlights(kind, rows)
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

// One row's changes reach the database one after another, in the order they
// were made. Two sent at the same moment could land the other way round, and
// the earlier choice would be the one that stays.
const turns = new Map()

function inTurn(rowKey, write) {
  const turn = (turns.get(rowKey) || Promise.resolve()).then(write, write)
  turns.set(rowKey, turn)
  const done = () => {
    if (turns.get(rowKey) === turn) turns.delete(rowKey)
  }
  turn.then(done, done)
  return turn
}

// The rows with a change on screen that the database has not answered yet.
// For each: the row as the database last gave it, and the changes still on
// their way, oldest first. The list shows the first with the others laid over
// it, so an answer or a refusal only takes its own change out. Nothing springs
// back while a later change is still on its way, and a refused change leaves
// no trace.
const flights = new Map()

function rowInFlight(flight) {
  return Object.assign({}, flight.server, ...flight.patches)
}

// A list read while a change is on its way knows nothing of it, or not yet.
// The change is laid over the row the read brings, so a read never takes a
// change off the screen.
function withFlights(kind, rows) {
  if (flights.size === 0) return rows
  return rows.map((row) => {
    const flight = flights.get(`${kind}:${row.id}`)
    return flight ? Object.assign({}, row, ...flight.patches) : row
  })
}

// update.mutateAsync({ id, patch }) shows the change in the list at once and
// tells the database after: a status select that waited for the answer sprang
// back to the old value in between. If the write fails, that one change is
// taken out again. With `wait: true` the list changes only when the database
// has answered, for a change that should not be seen before it is true
// (publishing a story) or that the screen already holds (typed notes).
// Either way it resolves with the row as the database now has it.
export function useSubmissionMutations(kind) {
  const qc = useQueryClient()
  const key = submissionKeys.list(kind)
  const putRow = (row) =>
    qc.setQueryData(key, (prev) =>
      Array.isArray(prev) ? prev.map((r) => (r.id === row.id ? row : r)) : prev,
    )
  // A change has been answered: `patch` is the one to take off the screen (none
  // for a change that waited), `row` the database's row when the write worked.
  const land = (id, patch, row) => {
    const rowKey = `${kind}:${id}`
    const flight = flights.get(rowKey)
    if (!flight) {
      if (row) putRow(row)
      return
    }
    const at = patch ? flight.patches.indexOf(patch) : -1
    if (at >= 0) flight.patches.splice(at, 1)
    if (row) flight.server = row
    putRow(rowInFlight(flight))
    if (flight.patches.length === 0) flights.delete(rowKey)
  }
  const update = useMutation({
    mutationFn: ({ id, patch }) => inTurn(`${kind}:${id}`, () => patchRow(kind, id, patch)),
    onMutate: async ({ id, patch, wait = false }) => {
      // A read still on its way was asked for before this change. It could
      // come back after the change's own answer with the row as it was, and
      // put the old row back on the screen, so it is dropped.
      await qc.cancelQueries({ queryKey: key })
      if (wait) return undefined
      const rowKey = `${kind}:${id}`
      let flight = flights.get(rowKey)
      if (!flight) {
        const list = qc.getQueryData(key)
        const server = Array.isArray(list) ? list.find((r) => r.id === id) : null
        if (!server) return undefined
        flight = { server, patches: [] }
        flights.set(rowKey, flight)
      }
      flight.patches.push(patch)
      putRow(rowInFlight(flight))
      return { patch }
    },
    onError: (_error, { id }, context) => {
      land(id, context?.patch, null)
    },
    onSuccess: (row, { id }, context) => {
      land(id, context?.patch, row)
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
