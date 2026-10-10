import { describe, expect, it } from 'vitest'
import {
  HAND_IN_CHECKING,
  callbackProblem,
  clockNotice,
  clockTone,
  connectionNote,
  detailField,
  detailsProblem,
  handInWords,
  hashFor,
  inAppBrowser,
  missingDetail,
  opensInWords,
  opensLine,
  pageLabel,
  placeFromHash,
  receivedWords,
  saveWords,
  screenFor,
  signedOutWords,
  startLine,
  startProblem,
  timeUpWords,
} from './examFlow.js'

const user = { id: 'u1', email: 'student@example.com' }
const me = { full_name: 'Sample Student', faculty_year: 'Year 4', phone: '01000000000', student_id: '20231234', email: 'student@example.com' }
const exam = { title: 'Exchange exam', opens_at: '2026-11-14T16:00:00+00:00', closes_at: '2026-11-14T16:30:00+00:00', minutes: 120, questions: 100, phase: 'open' }
const answered = (data) => ({ status: 'answered', data: { exam, me, registration: 'held', attempt: null, now: exam.opens_at, ...data } })
const failed = (kind) => ({ status: 'failed', error: { kind, message: 'x' } })

describe('which screen', () => {
  it('waits while the session or the door is being read', () => {
    expect(screenFor({ user: undefined, door: { status: 'asking' } })).toBe('wait')
    expect(screenFor({ user, door: { status: 'asking' } })).toBe('wait')
  })

  it('asks a signed-out taker to sign in, whatever the door said before', () => {
    expect(screenFor({ user: null, door: { status: 'asking' } })).toBe('sign-in')
    expect(screenFor({ user: null, door: answered(), started: true })).toBe('sign-in')
  })

  it('asks for a new sign-in when the database did not accept the session', () => {
    expect(screenFor({ user, door: failed('signed_out') })).toBe('sign-in')
  })

  it('says so when the database did not answer', () => {
    expect(screenFor({ user, door: failed('offline') })).toBe('unreached')
    expect(screenFor({ user, door: failed('refused') })).toBe('unreached')
  })

  it('carries on from the phone when the taker had started', () => {
    expect(screenFor({ user, door: failed('offline'), started: true })).toBe('sitting')
    expect(screenFor({ user, door: { status: 'asking' }, started: true })).toBe('sitting')
  })

  it('does not call a session that could not be renewed "signed out"', () => {
    // its hour ran out with no connection, and the page was opened again
    const unread = { id: 'u1', email: '', unread: true }
    // the phone holds this account's paper: on with it
    expect(screenFor({ user: unread, door: { status: 'asking' }, started: true })).toBe('sitting')
    // it does not: wait for the door, and keep trying when it is turned away
    expect(screenFor({ user: unread, door: { status: 'asking' } })).toBe('wait')
    expect(screenFor({ user: unread, door: failed('signed_out') })).toBe('unreached')
    expect(screenFor({ user: unread, door: failed('offline') })).toBe('unreached')
    // the phone remembers no account at all: there is nobody to ask as
    expect(screenFor({ user: { id: null, email: '', unread: true }, door: { status: 'asking' } })).toBe('unreached')
    // never the Google button, which leads to an error page without a connection
    for (const door of [{ status: 'asking' }, failed('signed_out'), failed('offline')]) {
      expect(screenFor({ user: unread, door })).not.toBe('sign-in')
    }
  })

  it('shows nothing here for an address with no exam', () => {
    expect(screenFor({ user, door: answered({ exam: null }) })).toBe('nothing')
    expect(screenFor({ user, door: { status: 'answered', data: null } })).toBe('nothing')
  })

  it('goes to the sitting for a paper, running or over', () => {
    expect(screenFor({ user, door: answered({ attempt: { id: 'a1', over: false } }) })).toBe('sitting')
    expect(screenFor({ user, door: answered({ attempt: { id: 'a1', over: true } }) })).toBe('sitting')
  })

  it('does not go round in circles over a paper the database will not hand over', () => {
    const door = answered({ attempt: { id: 'a1', over: false } })
    expect(screenFor({ user, door, gone: 'You have not started this exam.' })).toBe('unreached')
    // once the paper is no longer listed the sentence is only a note on the next screen
    expect(screenFor({ user, door: answered(), gone: 'You have not started this exam.' })).toBe('listed')
  })

  it('asks for the details until the ID is held and nothing is missing', () => {
    expect(screenFor({ user, door: answered({ registration: 'none' }) })).toBe('details')
    expect(screenFor({ user, door: answered({ me: { ...me, phone: '' } }) })).toBe('details')
    expect(screenFor({ user, door: answered({ me: null }) })).toBe('details')
    expect(screenFor({ user, door: answered(), editing: true })).toBe('details')
  })

  it('shows the list screen in every phase', () => {
    for (const phase of ['before', 'open', 'closed']) {
      expect(screenFor({ user, door: answered({ exam: { ...exam, phase } }) })).toBe('listed')
    }
  })
})

describe('the four details', () => {
  it('names the first one missing, in the database’s words', () => {
    expect(missingDetail(me)).toBe(null)
    expect(missingDetail({ ...me, full_name: '  ' })).toEqual({ field: 'full_name', message: 'Enter your full name.' })
    expect(missingDetail({ ...me, faculty_year: null })).toEqual({ field: 'faculty_year', message: 'Choose your year.' })
    expect(missingDetail({ ...me, phone: '' })).toEqual({ field: 'phone', message: 'Enter a phone number we can reach you on.' })
    expect(missingDetail({ ...me, student_id: undefined })).toEqual({ field: 'student_id', message: 'Enter your student ID.' })
    expect(missingDetail(null).field).toBe('full_name')
  })

  it('finds the field a refusal from the database is about, and only then', () => {
    expect(detailField('Enter your full name.')).toBe('full_name')
    expect(detailField('Choose your year.')).toBe('faculty_year')
    expect(detailField('Enter a phone number we can reach you on.')).toBe('phone')
    expect(detailField('Enter your student ID.')).toBe('student_id')
    for (const other of [
      'Your student ID is confirmed and cannot be changed here. Ask an exchange officer if it is wrong.',
      'The exam could not be reached. Check your connection and try again.',
      '',
      undefined,
    ]) {
      expect(detailField(other)).toBe(null)
    }
  })
})

describe('the opening time in words', () => {
  it('is on Cairo’s clock, in winter and in summer', () => {
    expect(opensInWords('2026-11-14T16:00:00+00:00')).toBe('Saturday 14 November at 6:00 pm')
    expect(opensInWords('2027-07-10T07:30:00+00:00')).toBe('Saturday 10 July at 10:30 am')
  })

  it('reads the database’s own spelling of a time', () => {
    expect(opensInWords('2026-11-14 16:00:00.123456+00')).toBe('Saturday 14 November at 6:00 pm')
  })

  it('makes the line for the page', () => {
    expect(opensLine(exam)).toBe('The exam opens on Saturday 14 November at 6:00 pm (Cairo time).')
    expect(opensLine({ ...exam, opens_at: null })).toBe('The exam is not open yet.')
    expect(opensLine(null)).toBe('The exam is not open yet.')
  })
})

describe('what starting means', () => {
  it('counts the questions and the minutes', () => {
    expect(startLine(exam)).toBe(
      '100 questions, 120 minutes. Your time starts when you start, you have all of it, and the clock does not stop.',
    )
    expect(startLine({ questions: 1, minutes: 5 })).toMatch(/^1 question, 5 minutes\. /)
  })
})

describe('the ID check', () => {
  it('has a sentence for each miss and none for a held ID', () => {
    expect(detailsProblem('held')).toBe('')
    expect(detailsProblem('not_listed')).toBe(
      'That student ID is not on the list for this exam. Check it and try again, or tell the exchange team.',
    )
    expect(detailsProblem('taken')).toBe(
      'That student ID is already in use by another account. If it is yours, tell the exchange team.',
    )
    expect(detailsProblem('locked')).toBe('Too many tries. Wait an hour, or tell the exchange team.')
  })

  it('never passes an answer it does not know as a held ID', () => {
    expect(detailsProblem(undefined)).not.toBe('')
    expect(detailsProblem('none')).not.toBe('')
  })
})

describe('the start code', () => {
  it('counts the tries left', () => {
    expect(startProblem({ ok: false, reason: 'code', tries_left: 7 })).toBe('That is not the start code. 7 tries left.')
    expect(startProblem({ ok: false, reason: 'code', tries_left: 1 })).toBe('That is not the start code. 1 try left.')
  })

  it('says to wait once none is left', () => {
    const locked = 'Too many wrong tries. Wait ten minutes, or ask an invigilator.'
    expect(startProblem({ ok: false, reason: 'code', tries_left: 0 })).toBe(`That is not the start code. ${locked}`)
    expect(startProblem({ ok: false, reason: 'locked' })).toBe(locked)
    expect(startProblem({ ok: false, reason: 'code' })).toBe('That is not the start code.')
  })

  it('says when the exam is not ready', () => {
    expect(startProblem({ ok: false, reason: 'not_ready' })).toBe('The exam is not ready yet. Tell an invigilator.')
  })

  it('leaves the rest to the door', () => {
    for (const reason of ['not_open', 'closed', 'details', 'not_registered', undefined]) {
      expect(startProblem({ ok: false, reason })).toBe('')
    }
    expect(startProblem(null)).toBe('')
  })
})

describe('the save state in words', () => {
  it('has the three states', () => {
    expect(saveWords({ kind: 'saved', count: 0 })).toBe('All answers saved')
    expect(saveWords({ kind: 'saving', count: 2 })).toBe('Saving…')
    expect(saveWords({ kind: 'offline', count: 3 })).toBe(
      'No connection: 3 answers waiting. Keep going, they are kept on this phone.',
    )
  })

  it('counts one answer as one', () => {
    expect(saveWords({ kind: 'offline', count: 1 })).toBe(
      'No connection: 1 answer waiting. Keep going, it is kept on this phone.',
    )
  })

  it('does not promise a copy the phone could not keep', () => {
    expect(saveWords({ kind: 'offline', count: 3 }, { onPhone: false })).toBe(
      'No connection: 3 answers waiting. Keep going, and do not close this page.',
    )
  })

  it('says when the connection is down with nothing waiting', () => {
    expect(saveWords({ kind: 'saved', count: 0 }, { connected: false })).toBe('All answers saved. No connection just now.')
  })

  // The bar above the paper keeps room for two lines, so that no question
  // moves when what it says changes. On a 320px phone two lines hold about
  // eighty characters (seen in a browser: a sentence of 97 took a third line
  // and pushed the whole paper down).
  it('keeps every sentence of the bar short enough for two lines on a 320px phone', () => {
    const sentences = [
      HAND_IN_CHECKING,
      saveWords({ kind: 'saved', count: 0 }, { connected: false }),
      ...[1, 9, 10, 100, 300].flatMap((count) => [
        saveWords({ kind: 'offline', count }),
        saveWords({ kind: 'offline', count }, { onPhone: false }),
      ]),
    ]
    for (const sentence of sentences) expect(sentence.length, sentence).toBeLessThanOrEqual(80)
  })

  it('tells a screen reader the same, and promises a copy only where the phone keeps one', () => {
    expect(connectionNote(true)).toBe('The connection is back.')
    expect(connectionNote(false)).toBe('No connection. Keep going. Your answers are kept on this phone.')
    expect(connectionNote(false, false)).toBe('No connection. Keep going. Do not close this page.')
  })
})

describe('the time-up screen', () => {
  it('says what is happening to the last answers', () => {
    expect(timeUpWords({ kind: 'saved', count: 0 })).toBe('Checking that everything arrived…')
    expect(timeUpWords({ kind: 'saving', count: 2 })).toBe('Sending your last answers…')
    expect(timeUpWords({ kind: 'offline', count: 3 })).toBe(
      'No connection: 3 answers are still waiting to be sent. Keep this page open. They are kept on this phone.',
    )
  })

  it('counts one answer as one, all the way through the sentence', () => {
    expect(timeUpWords({ kind: 'offline', count: 1 })).toBe(
      'No connection: 1 answer is still waiting to be sent. Keep this page open. It is kept on this phone.',
    )
  })

  it('does not promise a copy the phone could not keep', () => {
    expect(timeUpWords({ kind: 'offline', count: 2 }, false)).toBe(
      'No connection: 2 answers are still waiting to be sent. Keep this page open.',
    )
  })

  it('says so when nothing waits and the exam cannot be reached', () => {
    expect(timeUpWords({ kind: 'saved', count: 0 }, true, false)).toBe(
      'No connection just now. Your answers are saved. Keep this page open until it says they were received.',
    )
    // answers that wait are the more urgent news, connection or not
    expect(timeUpWords({ kind: 'saving', count: 1 }, true, false)).toBe('Sending your last answers…')
    expect(timeUpWords({ kind: 'offline', count: 1 }, true, false)).toBe(
      'No connection: 1 answer is still waiting to be sent. Keep this page open. It is kept on this phone.',
    )
  })
})

describe('a hand-in that did not go through', () => {
  it('says nothing when there was none', () => {
    expect(handInWords('')).toBe('')
    expect(handInWords(undefined)).toBe('')
  })

  it('says it was not sent, and what is kept', () => {
    expect(handInWords('offline')).toBe(
      'No connection, so your exam is not handed in yet. Your answers are kept on this phone. Tap “Hand in” again when the connection is back.',
    )
    expect(handInWords('offline', false)).toBe(
      'No connection, so your exam is not handed in yet. Keep this page open. Tap “Hand in” again when the connection is back.',
    )
  })

  it('does not say "not handed in" while nobody knows', () => {
    expect(handInWords('checking')).toBe(
      'The connection dropped while your exam was being handed in. This page is checking whether it arrived. Keep it open.',
    )
    expect(handInWords('checking')).not.toMatch(/not handed in/)
    expect(HAND_IN_CHECKING).toMatch(/cannot change answers/)
  })

  it('says to tap again once the database has said it did not arrive', () => {
    expect(handInWords('not_yet')).toBe('Your exam was not handed in. Tap “Hand in” again.')
  })
})

describe('signing in', () => {
  it('tells a taker whose session ended under them, and whether the phone has their answers', () => {
    expect(signedOutWords()).toBe('You were signed out. Sign in again with the same Google account.')
    expect(signedOutWords(true)).toBe(
      'You were signed out. Sign in again with the same Google account. Your answers are kept on this phone.',
    )
  })

  it('has its own sentence for a sign-in that came back with an error', () => {
    expect(callbackProblem('', '')).toBe('')
    expect(callbackProblem('', '#access_token=abc&refresh_token=def')).toBe('')
    expect(callbackProblem('?error=access_denied&error_description=User+denied', '')).toBe('You cancelled the sign-in.')
    expect(callbackProblem('', '#error=access_denied')).toBe('You cancelled the sign-in.')
    expect(callbackProblem('?error=server_error', '')).toBe(
      'The sign-in did not finish. It may have been cancelled or left open too long.',
    )
    expect(callbackProblem('', '#error_code=otp_expired')).toMatch(/^The sign-in did not finish\./)
  })

  it('never repeats what the address says', () => {
    const planted = 'Your exam was cancelled. Call 0100 000 0000 to rebook.'
    for (const address of [
      [`?error_description=${encodeURIComponent(planted)}`, ''],
      ['', `#error_description=${encodeURIComponent(planted)}`],
      [`?error=${encodeURIComponent(planted)}`, ''],
      [`?error=access_denied&error_description=${'x'.repeat(180)}`, ''],
    ]) {
      const said = callbackProblem(...address)
      expect(said).not.toBe('')
      expect(said).not.toMatch(/cancelled\. Call|0100|xxx/)
    }
  })

  it('knows the browsers inside apps, where Google will not sign anyone in', () => {
    const facebook =
      'Mozilla/5.0 (Linux; Android 13; SM-A536E Build/TP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/470.0.0.0;]'
    const instagram =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 337.0.0 (iPhone14,5; iOS 17_5)'
    const otherAppOnAndroid =
      'Mozilla/5.0 (Linux; Android 12; M2101K6G Build/SKQ1; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/125.0 Mobile Safari/537.36'
    const otherAppOnIphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
    for (const inside of [facebook, instagram, otherAppOnAndroid, otherAppOnIphone]) expect(inAppBrowser(inside)).toBe(true)

    const chromeOnAndroid =
      'Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
    const safari =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
    const chromeOnIphone =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1'
    const desktop = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
    for (const browser of [chromeOnAndroid, safari, chromeOnIphone, desktop, '', undefined]) expect(inAppBrowser(browser)).toBe(false)
  })
})

describe('the received screen', () => {
  it('has a heading for a hand-in and one for the clock', () => {
    expect(receivedWords('handed_in')).toEqual({ title: 'Your exam was received.', note: '' })
    expect(receivedWords('time')).toEqual({ title: 'Time is up. Your answers were received.', note: '' })
    expect(receivedWords('time', 0)).toEqual({ title: 'Time is up. Your answers were received.', note: '' })
  })

  it('does not say every answer arrived when some did not', () => {
    const words = receivedWords('time', 3)
    expect(words.title).toBe('Time is up.')
    expect(words.note).toMatch(/^3 answers did not reach us/)
    expect(receivedWords('time', 1).note).toMatch(/^1 answer did not reach us/)
  })
})

describe('the clock’s tone', () => {
  it('changes in the last five minutes and in the last one', () => {
    expect(clockTone(null)).toBe('plenty')
    expect(clockTone(2 * 60 * 60 * 1000)).toBe('plenty')
    expect(clockTone(5 * 60 * 1000 + 1000)).toBe('plenty')
    expect(clockTone(5 * 60 * 1000)).toBe('low')
    expect(clockTone(61 * 1000)).toBe('low')
    expect(clockTone(60 * 1000)).toBe('last')
    expect(clockTone(0)).toBe('last')
  })

  it('is read out at ten, five and one minute', () => {
    expect(clockNotice(null)).toBe('')
    expect(clockNotice(11 * 60 * 1000)).toBe('')
    expect(clockNotice(10 * 60 * 1000)).toBe('10 minutes left.')
    expect(clockNotice(5 * 60 * 1000)).toBe('5 minutes left.')
    expect(clockNotice(60 * 1000)).toBe('1 minute left.')
    expect(clockNotice(0)).toBe('Time is up.')
  })
})

describe('where in the paper the address points', () => {
  it('opens on the first page', () => {
    expect(placeFromHash('', 100)).toEqual({ view: 'page', page: 1, question: null })
    expect(placeFromHash('#access_token=abc', 100)).toEqual({ view: 'page', page: 1, question: null })
  })

  it('reads a page and keeps it inside the paper', () => {
    expect(placeFromHash('#p3', 100)).toEqual({ view: 'page', page: 3, question: null })
    expect(placeFromHash('#p99', 100).page).toBe(10)
    expect(placeFromHash('#p0', 100).page).toBe(1)
    expect(placeFromHash('#p2', 7).page).toBe(1)
  })

  it('reads a question as its page and the question to go to', () => {
    expect(placeFromHash('#q27', 100)).toEqual({ view: 'page', page: 3, question: 27 })
    expect(placeFromHash('#q10', 100)).toEqual({ view: 'page', page: 1, question: 10 })
    expect(placeFromHash('#q500', 95)).toEqual({ view: 'page', page: 10, question: 95 })
    expect(placeFromHash('#q0', 95)).toEqual({ view: 'page', page: 1, question: 1 })
  })

  it('reads the review, which comes after the last page', () => {
    expect(placeFromHash('#review', 95)).toEqual({ view: 'review', page: 10, question: null })
  })

  it('writes what it reads', () => {
    for (const hash of ['#p1', '#p7', '#q27', '#review']) {
      expect(hashFor(placeFromHash(hash, 100))).toBe(hash)
    }
    expect(hashFor({ view: 'page', page: 4, question: null })).toBe('#p4')
  })
})

describe('a page button’s name', () => {
  it('says what is left on the page', () => {
    expect(pageLabel({ page: 3, from: 21, to: 30, unanswered: 4, flagged: 1 })).toBe(
      'Page 3, questions 21 to 30: 4 not answered, 1 flagged',
    )
    expect(pageLabel({ page: 1, from: 1, to: 10, unanswered: 0, flagged: 0 })).toBe('Page 1, questions 1 to 10: all answered')
  })
})
