import { supabase } from '../lib/supabase.js'
import { examWord, failureKind } from './sitting.js'

// The takers' side of the exam as the database offers it: the five functions a
// taker's account may call (supabase/migrations/20261010120001_exchange_exam.sql),
// the session, and the word to come back to after signing in. The exam's pages
// reach the database only through this file; they hold no AuthProvider and no
// react-query.

export { examWord }

const CALLBACK_PATH = '/exam/callback'

// A call that has not answered by now is given up, so one request stuck on the
// hall's network cannot hold up the answers queued behind it.
const TIMEOUT_MS = 20000

const UNREACHED = 'The exam could not be reached. Check your connection and try again.'
const SIGNED_OUT = 'You are signed out. Sign in again to carry on.'

// Every failure from this file, with a sentence fit to show as its message.
// `kind` says what to do about it (failureKind in sitting.js):
//   refused     the database said no, and `message` is its own sentence
//   signed_out  there is no session, or it was not accepted
//   offline     no answer, a slow one, or a server fault: worth trying again
export class ExamError extends Error {
  constructor(kind, message, code = '') {
    super(message)
    this.name = 'ExamError'
    this.kind = kind
    this.code = code
  }
}

async function call(fn, args, timeout = TIMEOUT_MS) {
  if (!supabase) throw new ExamError('offline', UNREACHED)
  const giveUp = new AbortController()
  const timer = setTimeout(() => giveUp.abort(), timeout)
  let answer
  try {
    answer = await supabase.rpc(fn, args).abortSignal(giveUp.signal)
  } catch {
    // supabase-js hands its failures back; a throw is the browser's own.
    throw new ExamError('offline', UNREACHED)
  } finally {
    clearTimeout(timer)
  }
  const { data, error, status } = answer
  if (!error) return data
  const code = typeof error.code === 'string' ? error.code : ''
  const kind = failureKind(code, status)
  if (kind === 'refused') throw new ExamError(kind, error.message || UNREACHED, code)
  throw new ExamError(kind, kind === 'signed_out' ? SIGNED_OUT : UNREACHED, code)
}

// ---- the five functions -----------------------------------------------------------
// `word` is the last part of the address. Each resolves to the function's JSON
// and rejects with an ExamError.

// What to show: { exam: null }, or { exam: { title, opens_at, closes_at,
// minutes, questions, phase: 'before' | 'open' | 'closed' }, me: { full_name,
// faculty_year, phone, student_id, email }, registration: 'held' | 'none',
// attempt: null | { id, started_at, deadline_at, submitted_at, over }, now }.
export function examDoor(word) {
  return call('exam_door', { p_word: word })
}

// Saves the taker's details and checks the student ID against the list:
// { registration: 'held' | 'not_listed' | 'taken' | 'locked', me }. A detail
// the database will not take is an ExamError of kind 'refused'.
export function examSaveDetails(word, { fullName, facultyYear, phone, studentId } = {}) {
  return call('exam_save_details', {
    p_word: word,
    p_full_name: fullName,
    p_faculty_year: facultyYear,
    p_phone: phone,
    p_student_id: studentId,
  })
}

// Starts the exam with the code read out in the hall: { ok: true, attempt_id },
// or { ok: false, reason: 'not_registered' | 'details' | 'not_open' | 'closed' |
// 'not_ready' | 'locked' | 'code', tries_left }.
export function examStart(word, code) {
  return call('exam_start', { p_word: word, p_code: code })
}

// The taker's paper: { state: 'sitting', exam, attempt, now, questions, answers },
// or { state: 'over', submitted } once it has ended.
export function examPaper(word) {
  return call('exam_paper', { p_word: word })
}

// Saves answers ([{ q, c, f }]; an empty list only asks for the time) and hands
// in when `handIn` is true: { state: 'sitting' | 'over', submitted, saved,
// deadline_at, now }. `timeout` (ms) gives the call up sooner than the usual
// twenty seconds, for the saves that race the end of the exam.
export function examSave(word, answers, handIn = false, { timeout } = {}) {
  return call('exam_save', { p_word: word, p_answers: answers, p_hand_in: handIn }, timeout)
}

// The same two values src/lib/supabase.js makes the client from.
const REST_URL = `${(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '')}/rest/v1`
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

// One more copy of the waiting answers, sent as the page goes to the
// background or is closed. A request marked `keepalive` is finished by the
// browser after the page has gone, which an ordinary one is not, so an answer
// tapped a moment before the tab was closed still arrives. It is the same
// rpc/exam_save, asked for directly because there is no time to wait for
// supabase-js to look the session up; nothing is read back. The answers stay
// marked as waiting on the phone, and a page that lives sends and settles
// them in the ordinary way. Returns whether a request went out.
export function examSaveLast(word, answers) {
  if (!supabase || !accessToken || typeof fetch !== 'function') return false
  try {
    fetch(`${REST_URL}/rpc/exam_save`, {
      method: 'POST',
      keepalive: true,
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_word: word, p_answers: answers, p_hand_in: false }),
    }).catch(() => {})
    return true
  } catch {
    return false
  }
}

// ---- the session ------------------------------------------------------------------

// Two notes are kept of the session as supabase-js reports it:
//   - the access token, in memory, for examSaveLast above;
//   - the account's id, on the phone, for the one case in which the session
//     cannot be read: its hour ran out while there was no connection, and the
//     page was opened again. The session is still on the phone then, but
//     supabase-js hands over nobody until it can renew it. The id says whose
//     paper the phone may carry on with meanwhile. It goes when that account
//     signs out.
const USER_KEY = 'ausss-exam-user'
let accessToken = ''

function noteSession(event, session) {
  accessToken = session?.access_token || ''
  try {
    if (session?.user?.id) localStorage.setItem(USER_KEY, session.user.id)
    else if (event === 'SIGNED_OUT') localStorage.removeItem(USER_KEY)
  } catch {
    // No storage: the phone remembers no account, and the door says so.
  }
}

// From the first import, for as long as the page lives. It only takes notes
// and asks supabase-js for nothing, so it may run inside its lock (see
// onAuthStateChange below).
if (supabase) supabase.auth.onAuthStateChange(noteSession)

// The id of the account this phone last saw signed in on an exam page, or null.
export function lastUserId() {
  try {
    return localStorage.getItem(USER_KEY) || null
  } catch {
    return null
  }
}

// The session this phone holds, or null when nobody is signed in. It rejects
// (an ExamError of kind 'offline') when a session is there but could not be
// renewed for want of a connection: that is not "signed out", and the sign-in
// card must not be shown for it. supabase-js names that failure
// AuthRetryableFetchError (its isAuthRetryableFetchError tests the same name);
// any other failure to renew means the session is gone.
export async function getSession() {
  if (!supabase) return null
  const { data, error } = await supabase.auth.getSession()
  const session = data?.session ?? null
  if (!session && error?.name === 'AuthRetryableFetchError') throw new ExamError('offline', UNREACHED)
  if (session) noteSession('', session)
  return session
}

// Calls back with (event, session) whenever the session changes; session is
// null when signed out. Returns the function that stops it.
// The call is put off by a tick: supabase-js holds a lock while it tells its
// listeners, and a listener that asks the database from inside it deadlocks
// (see src/auth/AuthProvider.jsx). Put off, a listener may call anything here.
export function onAuthStateChange(callback) {
  if (!supabase) return () => {}
  let listening = true
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((event, session) => {
    setTimeout(() => {
      if (listening) callback(event, session ?? null)
    }, 0)
  })
  return () => {
    listening = false
    subscription.unsubscribe()
  }
}

// Google only: an email link would spend the day's email allowance. The word
// is remembered first, because the round trip through Google drops everything
// but the fixed callback address.
export async function signInWithGoogle(word) {
  if (!supabase) throw new ExamError('offline', UNREACHED)
  rememberWord(word)
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + CALLBACK_PATH },
  })
  if (error) throw new ExamError('offline', UNREACHED)
}

// Signs out this browser only (supabase-js signs out every device unless
// told otherwise): a taker who signs out on the laptop they checked their ID
// on must not find their phone signed out in the middle of the exam.
export async function signOut() {
  if (!supabase) return
  const { error } = await supabase.auth.signOut({ scope: 'local' })
  if (error) throw new ExamError('offline', UNREACHED)
}

// ---- the word to come back to -----------------------------------------------------

// Lives in sessionStorage, as the portal's `next` does (src/portal/constants.js).
// Only a word that could be an exam's is ever stored or read back, so the
// callback page can never be sent anywhere but /exam/<word>.
const WORD_KEY = 'ausss-exam-word'

export function rememberWord(value) {
  const word = examWord(value)
  try {
    if (word) sessionStorage.setItem(WORD_KEY, word)
    else sessionStorage.removeItem(WORD_KEY)
  } catch {
    // Private mode or blocked storage: the callback page goes to the home page.
  }
}

// Read-and-clear, so a stale word never leaks into a later sign-in. Null when
// none is remembered.
export function takeWord() {
  try {
    const value = sessionStorage.getItem(WORD_KEY)
    sessionStorage.removeItem(WORD_KEY)
    return examWord(value)
  } catch {
    return null
  }
}
