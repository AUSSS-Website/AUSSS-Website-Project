import { eventWhen } from '../lib/eventTime.js'
import { STUDY_YEARS } from '../portal/constants.js'
import { clampPage, pageCount, pageOf, toMs } from './sitting.js'

// What a taker's pages show and say, worked out from what the database
// answered: which screen, the sentences of each result, and where in the paper
// the address points. Nothing here touches React or the network, so
// examFlow.test.js proves each line; the screens only lay it out.

const blank = (value) => typeof value !== 'string' || value.trim() === ''
const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

// ---- which screen ---------------------------------------------------------------

// The first of the four details the exam needs that is not there, as
// { field, message } with the sentence the database gives for it, or null when
// all four are. `me` is the door's (full_name, faculty_year, phone, student_id).
const DETAIL_SENTENCES = {
  full_name: 'Enter your full name.',
  faculty_year: 'Choose your year.',
  phone: 'Enter a phone number we can reach you on.',
  student_id: 'Enter your student ID.',
}

// The years a student can be in when they sit the exam: the five years of
// study, then the two intern years (the webmaster, 2026-10-11). The portal's
// profile adds two for members who are not students (graduates, others); the
// exam's form offers the years of study and nothing else.
export const EXAM_YEARS = STUDY_YEARS

// The year the form starts on: the profile's when it is one of those, else
// none, so a member whose profile says something else chooses again.
export function startingYear(me) {
  return EXAM_YEARS.includes(me?.faculty_year) ? me.faculty_year : ''
}

export function missingDetail(me) {
  for (const [field, message] of Object.entries(DETAIL_SENTENCES)) {
    if (blank(me?.[field])) return { field, message }
  }
  return null
}

// The field one of those sentences is about, when the database is the one
// that said it (a name too short, a phone number that is not one); null for
// any other sentence. The form marks that field, and only that one.
export function detailField(message) {
  const found = Object.entries(DETAIL_SENTENCES).find(([, sentence]) => sentence === message)
  return found ? found[0] : null
}

// The one screen to show.
//   user     undefined while the session is being read, null when signed out,
//            else { id, email }. With `unread: true` the session is on this
//            phone but could not be renewed (no connection): `id` is then the
//            account the phone last saw, or null. That is not "signed out".
//   door     { status: 'asking' }, { status: 'answered', data } with
//            rpc/exam_door's answer, or { status: 'failed', error }
//   started  the taker has started here, or this phone holds their paper
//   editing  "Edit my details" is open
//   gone     the sentence of a sitting the database no longer knows
// It answers:
//   wait       nothing to show yet
//   sign-in    the sign-in card
//   unreached  the database did not answer, or cannot make sense of this sitting
//   nothing    no exam at this address
//   sitting    the paper, and what follows it (time up, received)
//   details    the form with the name, year, phone and student ID
//   listed     on the list: before the exam opens, the start code, or closed
export function screenFor({ user, door, started = false, editing = false, gone = '' }) {
  if (user === undefined) return 'wait'
  if (user === null) return 'sign-in'
  if (started) return 'sitting'
  if (!user.id) return 'unreached'
  if (!door || door.status === 'asking') return 'wait'
  if (door.status === 'failed') {
    // A session that could not be renewed is turned away like no session at
    // all, and comes back by itself with the connection: keep trying.
    return door.error?.kind === 'signed_out' && !user.unread ? 'sign-in' : 'unreached'
  }
  const data = door.data
  if (!data?.exam) return 'nothing'
  // A paper the database lists but will not hand over: say so, do not ask in a loop.
  if (data.attempt) return gone ? 'unreached' : 'sitting'
  if (data.registration !== 'held' || missingDetail(data.me) || editing) return 'details'
  return 'listed'
}

// ---- the sentences --------------------------------------------------------------

// 'Saturday 14 November at 6:00 pm', on Cairo's clock; '' for no time.
export function opensInWords(opensAt) {
  // eventWhen gives 'Saturday 14 November 2026, 6:00 pm'.
  const parts = /^(.+?) \d{4}, (.+)$/.exec(eventWhen({ startsAt: toMs(opensAt) }))
  return parts ? `${parts[1]} at ${parts[2]}` : ''
}

// The line for a taker who is on the list before the exam opens.
export function opensLine(exam) {
  const when = opensInWords(exam?.opens_at)
  return when ? `The exam opens on ${when} (Cairo time).` : 'The exam is not open yet.'
}

// What starting means, under the start code.
export function startLine(exam) {
  const questions = count(Number(exam?.questions) || 0, 'question')
  const minutes = count(Number(exam?.minutes) || 0, 'minute')
  return `${questions}, ${minutes}. Your time starts when you start, you have all of it, and the clock does not stop.`
}

// What to say when rpc/exam_save_details did not find the ID free on the list.
// '' when the registration is held.
export function detailsProblem(registration) {
  if (registration === 'held') return ''
  if (registration === 'not_listed') {
    return 'That student ID is not on the list for this exam. Check it and try again, or tell the exchange team.'
  }
  if (registration === 'taken') {
    return 'That student ID is already in use by another account. If it is yours, tell the exchange team.'
  }
  if (registration === 'locked') return 'Too many tries. Wait an hour, or tell the exchange team.'
  return 'Your student ID could not be checked. Try again.'
}

const LOCKED = 'Too many wrong tries. Wait ten minutes, or ask an invigilator.'

// What to say when rpc/exam_start said no. '' for the answers the door
// explains better than a sentence here (not_open, closed, details,
// not_registered): ask the door again.
export function startProblem(result) {
  if (result?.reason === 'code') {
    const left = Number(result.tries_left)
    if (!Number.isFinite(left)) return 'That is not the start code.'
    if (left <= 0) return `That is not the start code. ${LOCKED}`
    return `That is not the start code. ${count(left, 'try', 'tries')} left.`
  }
  if (result?.reason === 'locked') return LOCKED
  if (result?.reason === 'not_ready') return 'The exam is not ready yet. Tell an invigilator.'
  return ''
}

// The save state in the sitting's header, from saveStatus in sitting.js.
// `connected` is false while the database is not answering; `onPhone` is false
// when the phone's storage refused the last copy.
export function saveWords(save, { connected = true, onPhone = true } = {}) {
  if (save?.kind === 'offline') {
    const n = Number(save.count) || 0
    const waiting = `No connection: ${count(n, 'answer')} waiting.`
    if (!onPhone) return `${waiting} Keep going, and do not close this page.`
    return `${waiting} Keep going, ${n === 1 ? 'it is' : 'they are'} kept on this phone.`
  }
  if (save?.kind === 'saving') return 'Saving…'
  return connected ? 'All answers saved' : 'All answers saved. No connection just now.'
}

// What a screen reader is told once when the connection goes and once when it
// is back. It promises a copy on the phone only when the phone keeps one.
export function connectionNote(connected, onPhone = true) {
  if (connected) return 'The connection is back.'
  return `No connection. Keep going. ${onPhone ? 'Your answers are kept on this phone.' : 'Do not close this page.'}`
}

// The line on the "Time is up." screen while the last answers go out. `save`
// is the sitting's save state; `connected` is false while the database is not
// answering. With nothing waiting and no answer, every answer was saved before
// the time ran out and only the database's word that the exam is over is
// missing: the line says so, where "checking" alone would look stuck.
export function timeUpWords(save, onPhone = true, connected = true) {
  const n = Number(save?.count) || 0
  if (save?.kind !== 'offline') {
    if (n > 0) return 'Sending your last answers…'
    return connected
      ? 'Checking that everything arrived…'
      : 'No connection just now. Your answers are saved. Keep this page open until it says they were received.'
  }
  const waiting = `No connection: ${n === 1 ? '1 answer is' : `${n} answers are`} still waiting to be sent. Keep this page open.`
  if (!onPhone) return waiting
  return `${waiting} ${n === 1 ? 'It is' : 'They are'} kept on this phone.`
}

// What the review says after a hand-in that did not go through. `note` is the
// sitting's handInNote:
//   offline   it could not be sent at all: nothing has changed
//   checking  it left the phone and no answer came back, so nobody here knows
//             whether the database took it. No answer is taken until it says.
//   not_yet   the database has answered since: the exam is still running
export function handInWords(note, onPhone = true) {
  if (note === 'offline') {
    const kept = onPhone ? 'Your answers are kept on this phone.' : 'Keep this page open.'
    return `No connection, so your exam is not handed in yet. ${kept} Tap “Hand in” again when the connection is back.`
  }
  if (note === 'checking') {
    return 'The connection dropped while your exam was being handed in. This page is checking whether it arrived. Keep it open.'
  }
  if (note === 'not_yet') return 'Your exam was not handed in. Tap “Hand in” again.'
  return ''
}

// The same wait, said in the bar that stays above the paper, where taps do
// nothing meanwhile. Kept this short on purpose: the bar holds two lines on a
// 320px phone, and a third would push every question down.
export const HAND_IN_CHECKING = 'Checking whether your exam was handed in. You cannot change answers until then.'

// The sign-in card for a taker whose session ended under them (not one who
// pressed "Sign out"). `kept` is true when this phone holds their paper.
export function signedOutWords(kept = false) {
  const words = 'You were signed out. Sign in again with the same Google account.'
  return kept ? `${words} Your answers are kept on this phone.` : words
}

// ---- signing in -----------------------------------------------------------------

// What /exam/callback says when the sign-in came back with an error, from the
// address's ?query and #hash; '' when it carries none. The address's own words
// are never shown: anyone can write an address, and it would be read as ours.
export function callbackProblem(search = '', hash = '') {
  const query = new URLSearchParams(String(search || ''))
  const fragment = new URLSearchParams(String(hash || '').replace(/^#/, ''))
  const read = (name) => query.get(name) || fragment.get(name) || ''
  const error = read('error')
  if (!error && !read('error_description') && !read('error_code')) return ''
  if (error === 'access_denied') return 'You cancelled the sign-in.'
  return 'The sign-in did not finish. It may have been cancelled or left open too long.'
}

// True inside the browsers that apps open links in (Facebook, Messenger,
// Instagram and the like). Google refuses to sign anyone in there, with an
// error page of its own that does not say what to do.
export function inAppBrowser(userAgent) {
  const ua = String(userAgent || '')
  if (/FBAN|FBAV|FB_IAB|FBIOS|Instagram|Messenger|Line\/|MicroMessenger|Snapchat|TikTok|musical_ly|LinkedInApp/i.test(ua)) return true
  // Any Android app's own web view says "wv"; an iPhone's leaves "Safari" out.
  if (/Android/.test(ua) && /;\s*wv\)/.test(ua)) return true
  return /iPhone|iPad|iPod/.test(ua) && /AppleWebKit/.test(ua) && !/Safari\//.test(ua)
}

// The received screen: its heading and, when some answers never arrived, the
// line that says so. `why` is 'handed_in' or 'time'; `unsent` is how many
// answers the clock beat.
export function receivedWords(why, unsent = 0) {
  if (why === 'handed_in') return { title: 'Your exam was received.', note: '' }
  if (unsent > 0) {
    return {
      title: 'Time is up.',
      note: `${count(unsent, 'answer')} did not reach us before the time ran out. Your other answers were received. Tell an invigilator before you leave.`,
    }
  }
  return { title: 'Time is up. Your answers were received.', note: '' }
}

// ---- the clock ------------------------------------------------------------------

const MINUTE = 60 * 1000

// How the clock is drawn: 'plenty', 'low' in the last five minutes, 'last' in
// the last one.
export function clockTone(left) {
  if (left === null || left === undefined) return 'plenty'
  if (left <= MINUTE) return 'last'
  return left <= 5 * MINUTE ? 'low' : 'plenty'
}

// What a screen reader is told as the time runs down; '' until ten minutes
// are left. It changes three times, so it is read out three times.
export function clockNotice(left) {
  if (left === null || left === undefined || left > 10 * MINUTE) return ''
  if (left <= 0) return 'Time is up.'
  if (left <= MINUTE) return '1 minute left.'
  return left <= 5 * MINUTE ? '5 minutes left.' : '10 minutes left.'
}

// ---- where in the paper ---------------------------------------------------------
//
// The part of the address after the # says where the taker is: '#p3' is page
// 3, '#q27' is question 27 (on its page), '#review' is the review. So a
// refresh comes back to the same page, and the phone's back button goes to the
// page before, not out of the exam.

// { view: 'page' | 'review', page, question }. `page` is always a page of the
// paper (the last one on the review); `question` is a number to go to, or null.
export function placeFromHash(hash, total) {
  const text = String(hash || '').replace(/^#/, '')
  if (text === 'review') return { view: 'review', page: pageCount(total), question: null }
  const question = /^q(\d{1,4})$/.exec(text)
  if (question) {
    const n = Math.min(Math.max(Number(question[1]), 1), Math.max(1, Number(total) || 0))
    return { view: 'page', page: pageOf(n), question: n }
  }
  const page = /^p(\d{1,4})$/.exec(text)
  return { view: 'page', page: clampPage(page ? Number(page[1]) : 1, total), question: null }
}

export function hashFor(place) {
  if (place?.view === 'review') return '#review'
  return place?.question ? `#q${place.question}` : `#p${place?.page || 1}`
}

// A page button's name for a screen reader, from a row of pageSummaries.
export function pageLabel(row) {
  const answered = row.unanswered === 0 ? 'all answered' : `${row.unanswered} not answered`
  const flagged = row.flagged > 0 ? `, ${row.flagged} flagged` : ''
  return `Page ${row.page}, questions ${row.from} to ${row.to}: ${answered}${flagged}`
}
