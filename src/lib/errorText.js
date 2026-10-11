// One way to turn a caught error into a sentence fit to show.
//
//   catch (err) { setError(errorText(err, 'Could not save the photo.')) }
//   <ErrorText>{save.error ? errorText(save.error, 'Could not save.') : ''}</ErrorText>
//
// It reads both kinds of error the site meets: the ones src/lib/supabaseRest.js
// throws on the public pages (`status`, `rejected`) and the ones supabase-js
// hands back in the portal (`code`, the database's SQLSTATE). What comes out:
//
//   no answer     the request never got one (offline, a dropped connection, a
//                 timeout): UNREACHED, whatever the browser called it
//   no permission the database's own sentence when it wrote one ("Only the
//                 Executive Board can do this."), otherwise NO_PERMISSION
//   a refusal     the backend said no in a sentence written for people ("This
//                 call has closed."): shown as written
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
// A request given up on: by src/lib/timeoutSignal.js, or as supabase-js words it.
const GAVE_UP = /^(AbortError|TimeoutError)\b/

// The codes the database's functions raise their own sentences with
// (supabase/migrations: `raise exception '…' using errcode = '22023'`; P0001 is
// a raise with no code given).
const REFUSAL_CODES = new Set(['22023', '23505', '40001', 'P0001'])
// Not written for people: Postgres's own words under two of those codes, and
// the stand-in supabaseRest.js uses when a refusal came with no message.
const NOT_FOR_SHOWING = /^(duplicate key value|could not serialize|request failed \(\d+\)$)/i

// Postgres's own words for "you may not", whichever code or status carries them.
const FORBIDDEN = /row-level security|permission denied/i
// Postgres and PostgREST never start a message with a capital and end it with
// a full stop; the sentences in the migrations do.
const SENTENCE = /^[A-Z“"].*[.!?]$/s

export function errorText(err, fallback = WENT_WRONG) {
  if (!err || typeof err !== 'object') return fallback
  const message = typeof err.message === 'string' ? err.message.trim() : ''
  const name = typeof err.name === 'string' ? err.name : ''

  if (name === 'AbortError' || name === 'TimeoutError' || err.status === 0 || GAVE_UP.test(message) || NO_ANSWER.test(message)) {
    return UNREACHED
  }

  const forbidden = FORBIDDEN.test(message)
  if (forbidden || err.code === '42501' || err.status === 401 || err.status === 403) {
    return !forbidden && SENTENCE.test(message) ? message : NO_PERMISSION
  }

  const refused = err.rejected === true || REFUSAL_CODES.has(err.code)
  if (refused && message && !NOT_FOR_SHOWING.test(message)) return message

  return fallback
}
