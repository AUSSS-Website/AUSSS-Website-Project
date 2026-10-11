// One way to turn a caught error into a sentence fit to show.
//
//   catch (err) { setError(errorText(err, 'Could not save the photo.')) }
//   <ErrorText>{save.error ? errorText(save.error, 'Could not save.') : ''}</ErrorText>
//
// It reads both kinds of error the site meets: the ones src/lib/supabaseRest.js
// throws on the public pages (`status`, `rejected`, and the answer's `code`
// when it had one) and the ones supabase-js hands back in the portal (`code`,
// the database's SQLSTATE). What comes out:
//
//   no answer     the request never got one (offline, a dropped connection, a
//                 timeout): UNREACHED, whatever the browser called it. A part
//                 of the site's own code that is fetched when first needed
//                 and did not arrive counts as the same trouble
//   no permission the database's own sentence when it wrote one ("Only the
//                 Executive Board can do this."), otherwise NO_PERMISSION
//   a refusal     the backend said no in a sentence written for people ("This
//                 call has closed."): shown as written. A refusal in a
//                 function's own terms ("decision must be approved or
//                 declined") is not one of those and gives way to `fallback`
//   anything else `fallback`, the caller's own words for what failed
//
// The result is a whole sentence with its own full stop. Show it as it is:
// adding ". Please try again" doubles the stop, and a refusal is not fixed by
// trying again.

export const UNREACHED = 'We couldn’t reach the server. Check your connection and try again.'
export const NO_PERMISSION = 'You don’t have permission to do that.'
export const WENT_WRONG = 'Something went wrong. Please try again.'

// What browsers call a fetch that got no answer (Chrome, Node, Safari,
// Firefox, React Native), also inside supabase-js's "TypeError: Failed to fetch".
const NO_ANSWER = /failed to fetch|fetch failed|load failed|networkerror|network request failed/i
// What they call a part of the site's code that did not arrive: a module
// loaded with import() when it is first needed, such as the one that builds a
// PDF. Chrome says "Failed to fetch dynamically imported module", which the
// line above already knows; these are Firefox's words ("error loading
// dynamically imported module"), Safari's ("Importing a module script
// failed.") and Vite's for the stylesheet that comes with such a module.
const NO_CODE = /dynamically imported module|importing a module script failed|unable to preload css/i
// A request given up on: by src/lib/timeoutSignal.js, or as supabase-js words it.
const GAVE_UP = /^(AbortError|TimeoutError)\b/

// The codes the database's functions raise their own sentences with
// (supabase/migrations: `raise exception '…' using errcode = '22023'`; P0001 is
// a raise with no code given).
const REFUSAL_CODES = new Set(['22023', '23505', '40001', 'P0001'])
// Not written for people: Postgres's own words under two of those codes, and
// the stand-in supabaseRest.js uses when a refusal came with no message.
const NOT_FOR_SHOWING = /^(duplicate key value|could not serialize|request failed \(\d+\)$)/i
// How a refusal written for people opens. Every `raise exception` under
// supabase/migrations was read for this (October 2026), and they fall into
// three kinds.
//
// Most are in the house style and open with a capital, a figure ("2026-27 is
// already the current term.") or a quotation mark. They do not all end with a
// full stop ("Please answer: Why do you want to join"), so the end is not
// asked about.
//
// The gallery's and the magazine's functions write theirs without the capital
// ("an album needs a title", "the link /gallery/aswan already belongs to
// another album", "could not find a free link for aswan", "an edition needs a
// title"). Those open with an article or with "could not find". The gallery's
// get their capital and full stop in src/portal/galleryQueries.js, and the
// magazine's are put into the form's words in magazineQueries.js.
//
// The rest open in lower case with the name of an argument, or with "invalid"
// or "unknown", and are a function speaking of its own call: "decision must
// be approved or declined", "rows must be a JSON array", "session is
// required", "invalid membership status x". They are not shown, and neither
// are Postgres's own words under these codes, which open in lower case too.
const FOR_PEOPLE = /^(?:[\p{Lu}\p{Nd}"“'‘]|(?:an?|the|could not find) )/u
// A row's id. A sentence that carries one ("verification request 3f2a… is
// already approved") was not written to be read on a page.
const ROW_ID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i

// Postgres's own words for "you may not", whichever code or status carries them.
const FORBIDDEN = /row-level security|permission denied/i
// Postgres and PostgREST never start a message with a capital and end it with
// a full stop; the sentences in the migrations do.
const SENTENCE = /^[A-Z“"].*[.!?]$/s

export function errorText(err, fallback = WENT_WRONG) {
  if (!err || typeof err !== 'object') return fallback
  const message = typeof err.message === 'string' ? err.message.trim() : ''
  const name = typeof err.name === 'string' ? err.name : ''

  if (
    name === 'AbortError' ||
    name === 'TimeoutError' ||
    err.status === 0 ||
    GAVE_UP.test(message) ||
    NO_ANSWER.test(message) ||
    NO_CODE.test(message)
  ) {
    return UNREACHED
  }

  const forbidden = FORBIDDEN.test(message)
  if (forbidden || err.code === '42501' || err.status === 401 || err.status === 403) {
    return !forbidden && SENTENCE.test(message) ? message : NO_PERMISSION
  }

  // An error that carries a code is judged by the code alone. supabaseRest.js
  // marks every 4xx answer `rejected`, and PostgREST answers 4xx in its own
  // words as well ("Could not find the function … in the schema cache", a
  // not-null violation); the code is what tells those from a sentence a
  // database function raised. An error with no code is a refusal when it is
  // marked one: a sentence the site's own code threw, or a 4xx with no code.
  const code = typeof err.code === 'string' ? err.code : ''
  const refused = code ? REFUSAL_CODES.has(code) : err.rejected === true
  if (!refused || !message || NOT_FOR_SHOWING.test(message)) return fallback

  // What a server answered is shown only when it was written for people. A
  // sentence the site's own code threw and marked has neither a code nor a
  // status, and is shown as written however it opens: some begin with the
  // name of a file ("minutes.pdf could not be uploaded."), which may be in
  // lower case or look like a row's id.
  const answered = Boolean(code) || typeof err.status === 'number'
  if (answered && (!FOR_PEOPLE.test(message) || ROW_ID.test(message))) return fallback

  return message
}
