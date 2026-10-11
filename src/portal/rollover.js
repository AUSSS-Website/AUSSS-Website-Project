// Pure helpers for the term rollover page (src/portal/pages/admin/RolloverPage.jsx).
// The database checks all of this again in rpc/roll_over_term; these only let the
// page say what is wrong before anyone presses the button. The one thing here
// the database does not ask for is the name typed a second time (startBlocker):
// that is the page's own guard against a slip.

export const STORAGE_LIMIT_BYTES = 1024 ** 3 // the free plan's 1 GB
export const STORAGE_WARN_BYTES = 600 * 1024 ** 2

// '' when the new term can be started, else a sentence for the page.
export function termProblem({ label, startsOn, endsOn }, current) {
  if (!/^\d{4}-\d{2}$/.test((label || '').trim())) return 'Name the term like 2027-28.'
  if (!startsOn || !endsOn) return 'Give the new term a first and a last day.'
  if (endsOn <= startsOn) return 'The last day must come after the first.'
  if (current && startsOn <= current.starts_on) {
    return `The new term must start after ${current.label} started.`
  }
  if (current && label.trim() === current.label) return `${label.trim()} is already the current term.`
  return ''
}

// What happens to one officer's, board or webmaster position at the switch.
//   keeps          the work account exists: it holds the position in the new term
//   first-sign-in  the address has no account yet: it holds it from its first sign-in
//   no-email       no work email is set: nobody holds it until one is set and invited
export function workAccountState(row) {
  if (!row.email) return 'no-email'
  return row.has_account ? 'keeps' : 'first-sign-in'
}

// Would anyone still hold the board's access after the switch? The database
// refuses a rollover that leaves the society without a board.
export function boardKept(accounts) {
  return accounts.some((row) => (row.level === 'eb' || row.level === 'webmaster') && workAccountState(row) === 'keeps')
}

// Why the Start button is off, as a sentence for the page, or '' when it can
// be pressed. `problem` is termProblem's answer and `board` is boardKept's.
// `typed` is what the box above the button holds: the switch cannot be undone,
// so the new term's name has to be typed there, exactly, before the button
// works. Spaces around either are not counted. While the typing is still on
// its way to the name it is only asked for; once it has gone another way the
// page says so.
export function startBlocker({ problem, board, label, typed }) {
  if (problem) return `Part 1 is not ready. ${problem}`
  if (!board) return 'Nobody on the board would keep their access, so the new term cannot start. See part 2.'
  const name = (label || '').trim()
  const got = (typed || '').trim()
  if (got === name) return ''
  if (name.startsWith(got)) return `Type ${name} in the box to use the button.`
  return `That is not ${name}. Type the name exactly as part 1 has it.`
}

// What the switch deletes of one exam: '396 registered IDs and 388 papers'.
// '' when the exam holds neither, so there is nothing to lose.
export function examLoss(exam) {
  const ids = exam.registrations || 0
  const papers = exam.attempts || 0
  if (ids === 0 && papers === 0) return ''
  return `${ids} registered ${ids === 1 ? 'ID' : 'IDs'} and ${papers} ${papers === 1 ? 'paper' : 'papers'}`
}

// '56 MB', '1.2 GB'.
export function formatBytes(bytes) {
  const mb = bytes / 1024 ** 2
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
  return `${(mb / 1024).toFixed(1).replace(/\.0$/, '')} GB`
}

// '1 September 2027' from '2027-09-01'.
export function formatDay(iso) {
  if (!iso) return ''
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}
