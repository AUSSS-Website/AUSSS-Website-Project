import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { readJson } from '../lib/localCache.js'
import { examPaper, examSave, examSaveLast, onAuthStateChange } from './examApi.js'
import {
  HEARTBEAT_MS,
  HURRY_EVERY_MS,
  HURRY_TIMEOUT_MS,
  SEND_AFTER_MS,
  answeredCount,
  canChoose,
  clearAnswer,
  clocksDisagree,
  emptyHeld,
  examWord,
  flaggedNumbers,
  heldClock,
  holdClock,
  lateSaveOpen,
  mergeAnswers,
  pageCount,
  pageQuestions,
  pageSummaries,
  remaining,
  retryDelay,
  saveStatus,
  setAnswer,
  settleBatch,
  syncClock,
  takeBatch,
  tidyHeld,
  tidyPaper,
  timeUp,
  toMs,
  toggleFlag,
  unansweredNumbers,
  waitAgain,
} from './sitting.js'
import { claimTab } from './tabLock.js'

// A taker's sitting, for the exam's pages: the paper, the answers, the queue
// that sends them and the clock. The rules are sitting.js's (and tested
// there); this file gives them the network, the phone's storage and timers.
//
// It is in two parts. createSitting is the sitting itself, with no React in
// it: one object that holds the only copy of the answers, so nothing it sends
// can come from a stale render (useSitting.test.js runs it against a scripted
// database). useSitting is the thin hook that shows it to a page.

// ---- what the phone keeps -------------------------------------------------------
//
// Two entries per attempt, so a refresh, a closed tab or a dead connection
// loses nothing:
//   ausss-exam-paper:<attempt id>   the paper as the database gave it, with the
//                                   address word and the account it is for
//   ausss-exam:<attempt id>         the answers, which of them still wait to be
//                                   sent, and the clock
// Both go once the exam is over and nothing is left waiting.

const PAPER_KEY = 'ausss-exam-paper:'
const ANSWERS_KEY = 'ausss-exam:'

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    // Private mode, blocked or full storage: the page is told (`onPhone`).
    return false
  }
}

function drop(key) {
  try {
    localStorage.removeItem(key)
  } catch {
    // Nothing was kept, so there is nothing to remove.
  }
}

// The papers this phone holds for one address and one account, newest first.
// More than one only when an officer deleted a paper and the student started
// again; the older copies are forgotten when the database next answers.
function heldPapers(word, uid) {
  const found = []
  try {
    const keys = []
    for (let i = 0; i < localStorage.length; i += 1) keys.push(localStorage.key(i))
    for (const key of keys) {
      if (!key || !key.startsWith(PAPER_KEY)) continue
      const copy = readJson(key, null)
      if (!copy || copy.word !== word || copy.uid !== uid) continue
      const paper = tidyPaper(copy)
      if (paper && PAPER_KEY + paper.attempt.id === key) found.push(paper)
    }
  } catch {
    // No storage on this phone: nothing is held.
  }
  return found.sort((a, b) => (toMs(b.attempt.started_at) || 0) - (toMs(a.attempt.started_at) || 0))
}

const phone = {
  paper: (word, uid) => heldPapers(word, uid)[0] || null,
  answers: (attemptId) => readJson(ANSWERS_KEY + attemptId, null),
  keepPaper: (word, uid, paper) => write(PAPER_KEY + paper.attempt.id, { word, uid, ...paper }),
  keepAnswers: (attemptId, value) => write(ANSWERS_KEY + attemptId, value),
  forget(attemptId) {
    drop(ANSWERS_KEY + attemptId)
    drop(PAPER_KEY + attemptId)
  },
  // Every copy for this address and account but `keepId` (null: every copy).
  forgetOthers(word, uid, keepId) {
    for (const paper of heldPapers(word, uid)) {
      if (paper.attempt.id !== keepId) phone.forget(paper.attempt.id)
    }
  },
}

// Whether this phone holds a paper for this address and account. The door asks
// as soon as it knows who is signed in: a taker who had started sees their
// paper from the phone at once, and the database is asked behind it.
export function hasHeldPaper(word, userId) {
  const address = examWord(word)
  return Boolean(address && userId && phone.paper(address, userId))
}

// For a taker who signs out on this phone: nothing of their paper stays behind
// for whoever holds the phone next. A copy with answers that still wait to be
// sent is kept, because it is all there is of them.
export function forgetHeldPapers(word, userId) {
  const address = examWord(word)
  if (!address || !userId) return
  for (const paper of heldPapers(address, userId)) {
    const kept = tidyHeld(phone.answers(paper.attempt.id), paper.questions)
    if (kept.waiting.length === 0) phone.forget(paper.attempt.id)
  }
}

// ---- one tab at a time ----------------------------------------------------------
//
// Two tabs of one account would each hold their own answers, write them over
// each other's in the two entries above, and each send what it holds. So a
// sitting first takes the browser's lock for its address and account
// (claimTab in tabLock.js). A second tab finds it taken and says the exam is
// open elsewhere; it may take the lock over, and then the first tab is the one
// that is told.

const LOCK_NAME = 'ausss-exam-tab:'

// ---- the sitting ----------------------------------------------------------------

const phoneClock = () => ({
  wall: Date.now(),
  mono: typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : NaN,
})

// False only when the phone itself says it has no connection. True proves
// nothing: a hall's Wi-Fi can be up and lead nowhere.
const phoneOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false

const pageHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden'

// While the phone says the time is up and the database has not yet agreed, ask
// it again this often.
const ASK_AGAIN_MS = 1000
// After the time ran out the page still asks whether it is over, once a
// heartbeat, this many times (half an hour); after that only when the taker
// comes back to the page.
const LOOKS_AFTER = 30
// The same answers are not sent twice as the page leaves within this long
// (going to the background and closing both say so).
const LEAVING_GAP_MS = 5000

const NO_QUESTIONS = Object.freeze([])
const NO_ANSWERS = Object.freeze({})

// `status` is where the sitting stands:
//   loading    no paper yet (the database has not answered and the phone holds none)
//   sitting    the exam is running and answers are taken
//   ending     the clock has run out on this phone: no more answers are taken,
//              what waits is being sent and the database is asked. It goes back
//              to sitting if the database says there is time left (the officers
//              moved the deadline, or the phone's clock had jumped).
//   over       the database says it has ended; `why` is 'handed_in' or 'time'.
//              After 'time' it is still asked now and then, and the paper
//              comes back if the officers make the exam longer.
//   gone       the database knows no such sitting (the paper or the exam was
//              deleted); `problem` is its sentence. Ask the door again.
//   elsewhere  another tab of this browser has the exam open. Nothing is
//              shown, held or sent here until this tab takes it over.
//
// `attemptId` is the paper the database has just named for this taker (it made
// it, or the door listed it), or null when nobody has asked yet. The phone's
// copy is shown only if it is of that paper: a copy of another is what is left
// of a paper the officers deleted before the taker started again.
//
// `api`, `store`, `readClock`, `online` and `claim` are the outside world,
// passed in so the queue can be run against a script.
export function createSitting({
  word,
  userId,
  attemptId = null,
  onChange,
  api = { examPaper, examSave, examSaveLast },
  store = phone,
  readClock = phoneClock,
  online = phoneOnline,
  claim = claimTab,
}) {
  const address = examWord(word) || String(word || '')

  let alive = false
  let status = 'loading'
  let why = null
  let problem = ''
  let paper = null
  let fromDatabase = false // the paper on screen is the database's, not only the phone's copy
  let held = emptyHeld()
  let clock = null
  let paperOnPhone = true // the phone's storage took the paper ...
  let answersOnPhone = true // ... and the latest answers
  let failures = 0 // calls in a row the database did not answer
  let busy = false // a call is in flight; there is never a second
  let asking = 'paper' // what that call is: 'paper' or 'save'
  let carried = [] // ... the answers it carries ...
  let sentFinal = false // ... and whether it carries the hand-in
  let sending = false // it carries answers or a hand-in (for the save state)
  let owed = false // a call is due even with nothing waiting: a heartbeat, the time running out
  let handIn = null // { promise, resolve } from the tap on "Hand in" until it is settled
  let handInNote = '' // what became of a hand-in that did not go through: see handInWords in examFlow.js
  let doubt = new Set() // questions carried by a save whose outcome nobody knows
  let doubtRipe = false // ... and a whole heartbeat has passed since the last of them
  let era = 0 // goes up when the sitting begins afresh or is taken over: an answer to an earlier call is ignored
  let claims = 0 // the same, for asking for the tab's lock
  let letGo = null // gives the tab's lock back
  let lastLeft = null // the answers last sent as the page left, and when
  let looks = 0 // how often the database was asked since the time ran out
  let sendTimer = null
  let retryTimer = null
  let beatTimer = null
  let tickTimer = null
  let afterTimer = null

  const ended = () => status === 'over' || status === 'gone' || status === 'elsewhere'

  function view() {
    const showing = status === 'sitting' || status === 'ending'
    return {
      status,
      over: status === 'over',
      why,
      problem,
      exam: paper?.exam ?? null,
      attempt: paper?.attempt ?? null,
      questions: showing && paper ? paper.questions : NO_QUESTIONS,
      answers: showing ? held.answers : NO_ANSWERS,
      save: saveStatus({ waiting: held.waiting.length, sending, failures, online: online() }),
      connected: failures === 0 && online(),
      fromPhone: Boolean(paper) && !fromDatabase,
      onPhone: paperOnPhone && answersOnPhone,
      clock: showing ? clock : null,
      handingIn: Boolean(handIn),
      handInNote,
      locked: Boolean(handIn) || handInNote === 'checking',
      unsent: status === 'over' ? held.waiting.length : 0,
    }
  }

  function emit() {
    if (alive) onChange(view())
  }

  function keep() {
    if (paper) answersOnPhone = store.keepAnswers(paper.attempt.id, { ...held, clock: holdClock(clock) })
  }

  function stopTimers() {
    clearTimeout(sendTimer)
    clearTimeout(retryTimer)
    clearInterval(beatTimer)
    clearInterval(tickTimer)
    clearInterval(afterTimer)
    sendTimer = retryTimer = beatTimer = tickTimer = afterTimer = null
  }

  function startClocks() {
    beatTimer = setInterval(beat, HEARTBEAT_MS)
    tickTimer = setInterval(tick, 1000)
  }

  function unlock() {
    if (letGo) letGo()
    letGo = null
  }

  function settleHandIn(result) {
    if (!handIn) return
    const { resolve } = handIn
    handIn = null
    resolve(result)
  }

  // The clock has run out on this phone. Only the database ends the exam for
  // good: it is asked, with whatever still waits, until it says which it is.
  function timeIsUp() {
    status = 'ending'
    why = 'time'
  }

  function sit() {
    status = 'sitting'
    why = null
    if (timeUp(clock, readClock()) === 'yes') timeIsUp()
  }

  // Answers wait and the thirty seconds after the deadline are running: every
  // second counts (HURRY_EVERY_MS in sitting.js).
  const hurrying = () => status === 'ending' && held.waiting.length > 0 && lateSaveOpen(clock, readClock())

  function finish(reason) {
    status = 'over'
    why = reason
    handInNote = ''
    // A hand-in carried everything that waited. What this phone still marks as
    // waiting went with a hand-in whose answer got lost on the way back.
    if (reason === 'handed_in') held = { answers: held.answers, waiting: [] }
    // Answers the clock beat stay on the phone and are counted in `unsent`;
    // otherwise nothing of the exam is left behind.
    const keepId = paper && held.waiting.length > 0 ? paper.attempt.id : null
    if (keepId) keep()
    else if (paper) store.forget(paper.attempt.id)
    store.forgetOthers(address, userId, keepId)
    stopTimers()
    settleHandIn({ ok: true })
    // A hand-in is final. Time that ran out is not quite: see lookAgain.
    if (reason === 'time') watchAfter()
    else unlock()
    emit()
  }

  function takePhoneCopy() {
    const copy = store.paper(address, userId)
    if (!copy) return false
    // Not the paper the database named: it is forgotten when the database
    // hands the real one over, and never shown meanwhile.
    if (attemptId && copy.attempt.id !== attemptId) return false
    const kept = store.answers(copy.attempt.id)
    paper = copy
    held = tidyHeld(kept, copy.questions)
    clock = heldClock(kept?.clock, readClock())
    return true
  }

  async function load() {
    const mine = era
    asking = 'paper'
    carried = []
    sentFinal = false
    const sent = readClock()
    let reply
    try {
      reply = await api.examPaper(address)
    } catch (error) {
      // The database did not answer: carry on from this phone's copy until it does.
      if (alive && mine === era && error?.kind !== 'refused' && !paper && takePhoneCopy()) sit()
      throw error
    }
    if (!alive || mine !== era) return
    failures = 0
    if (reply?.state === 'over') {
      if (!paper) takePhoneCopy()
      if (paper && held.waiting.length > 0 && !reply.submitted) {
        // The time is up, but the database takes a late save for thirty
        // seconds: what this phone still holds is sent before giving up.
        fromDatabase = true
        status = 'ending'
        why = 'time'
        emit()
        return
      }
      finish(reply.submitted ? 'handed_in' : 'time')
      return
    }
    const fresh = tidyPaper(reply)
    if (!fresh) throw new Error('The database sent something that is not a paper.')
    // Answers waiting on the phone win over the database's; the rest follows it.
    const own = paper && paper.attempt.id === fresh.attempt.id ? held : store.answers(fresh.attempt.id)
    paper = fresh
    fromDatabase = true
    held = mergeAnswers(own, reply.answers, fresh.questions)
    clock = syncClock(fresh.attempt.deadline_at, reply.now, readClock(), sent) || clock
    paperOnPhone = store.keepPaper(address, userId, fresh)
    store.forgetOthers(address, userId, fresh.attempt.id)
    keep()
    sit()
    emit()
  }

  async function send(batch, final) {
    const mine = era
    asking = 'save'
    carried = batch
    sentFinal = final
    owed = false
    sending = batch.length > 0 || final
    if (sending) emit()
    const sent = readClock()
    let reply
    try {
      reply = await api.examSave(address, batch, final, hurrying() ? { timeout: HURRY_TIMEOUT_MS } : undefined)
    } finally {
      sending = false
    }
    if (!alive || mine !== era) return
    // Only a real answer settles anything: an empty one would pass for "saved".
    if (reply?.state !== 'sitting' && reply?.state !== 'over') {
      throw new Error('The database sent something that is not an answer to a save.')
    }
    failures = 0
    held = settleBatch(held, batch, reply)
    clock = syncClock(reply.deadline_at, reply.now, readClock(), sent) || clock
    if (paper && reply.deadline_at && reply.deadline_at !== paper.attempt.deadline_at) {
      // The officers moved the end of the exam.
      paper = { ...paper, attempt: { ...paper.attempt, deadline_at: reply.deadline_at } }
    }
    keep()
    if (reply.state === 'over') {
      // Past the deadline the database still saves for thirty seconds. A call
      // that carried nothing (a heartbeat) says nothing about that, and one
      // whose answers all landed says the thirty seconds are still running:
      // either way, what waits on this phone goes out before giving up. The
      // next call carries answers, so its `saved` ends this one way or the other.
      const landed = batch.length === 0 || Number(reply.saved) >= batch.length
      const more = !reply.submitted && landed && held.waiting.length > 0
      if (!more) {
        finish(reply.submitted ? 'handed_in' : 'time')
        return
      }
      status = 'ending'
      why = 'time'
    } else {
      // The exam is still running: a hand-in in doubt did not arrive.
      if (final) settleHandIn({ ok: false, reason: 'offline' })
      if (final || handInNote === 'checking') handInNote = 'not_yet'
      sit()
    }
    emit()
  }

  function fail(error) {
    if (error?.kind === 'refused') {
      // The database's own no: this sitting is not there any more. Asked for
      // the paper, that is certain, and the phone's copy of it is stale.
      if (asking === 'paper') store.forgetOthers(address, userId, null)
      status = 'gone'
      why = null
      problem = error.message || ''
      handInNote = ''
      stopTimers()
      settleHandIn({ ok: false, reason: 'gone' })
      unlock()
      emit()
      return
    }
    // No answer. Nothing was settled, so nothing is lost: the answers wait on
    // the phone and the next try sends whatever is latest by then.
    failures += 1
    owed = true
    // Whether a save that got no answer reached the database, nobody here
    // knows. (One turned away for its session did not: it never ran.)
    const unknown = asking === 'save' && error?.kind !== 'signed_out'
    if (unknown && carried.length > 0) {
      for (const item of carried) doubt.add(item.q)
      doubtRipe = false
    }
    // A hand-in is not tried again on its own. If it never left, the taker is
    // told and taps again. If it left, no answer is taken until the database
    // has said whether the exam is over: a change made meanwhile would be
    // dropped without a word if it is.
    if (handIn) handInNote = unknown && sentFinal ? 'checking' : 'offline'
    settleHandIn({ ok: false, reason: handInNote === 'checking' ? 'unsure' : 'offline' })
    retryTimer = setTimeout(pump, hurrying() ? HURRY_EVERY_MS : retryDelay(failures))
    emit()
  }

  // The one place that talks to the database, and never twice at once: a call
  // that finds another in flight leaves, and the one in flight looks again
  // when it is done. Each save takes its batch at the moment it leaves, so it
  // always carries the latest answers.
  async function pump() {
    // Not before this tab holds the exam (`letGo` is the lock's other end).
    if (!alive || busy || ended() || !letGo) return
    busy = true
    const mine = era
    clearTimeout(sendTimer)
    clearTimeout(retryTimer)
    sendTimer = retryTimer = null
    try {
      while (alive && mine === era && !ended()) {
        if (!fromDatabase) {
          await load()
          continue
        }
        const batch = takeBatch(held)
        // The hand-in goes with the batch that empties the queue.
        const final = Boolean(handIn) && batch.length === held.waiting.length
        if (batch.length === 0 && !final && !owed) break
        await send(batch, final)
      }
    } catch (error) {
      if (alive && mine === era) fail(error)
    }
    busy = false
    if (!alive) return
    if (mine !== era) {
      // The sitting began afresh while that call was out: its turn now.
      pump()
      return
    }
    if (status === 'ending' && retryTimer === null) {
      owed = true
      retryTimer = setTimeout(pump, ASK_AGAIN_MS)
    }
  }

  function change(next) {
    if (next === held) return
    held = next
    handInNote = ''
    keep()
    emit()
    clearTimeout(sendTimer)
    sendTimer = setTimeout(pump, SEND_AFTER_MS)
  }

  // Answers are taken while the exam runs, no hand-in is on its way and none
  // is in doubt.
  const taking = () => alive && status === 'sitting' && !handIn && handInNote !== 'checking'

  function tick() {
    if (status !== 'sitting' || !clock) return
    const now = readClock()
    const up = timeUp(clock, now)
    if (up === 'yes') {
      timeIsUp()
      owed = true
      emit()
      pump()
    } else if (failures === 0 && !busy && (up === 'unsure' || clocksDisagree(clock, now))) {
      // The phone's time was changed, or it slept: the database says what is
      // left. Until it does the paper stays open, even at zero on the phone's
      // wall clock (timeUp in sitting.js). While it does not answer, the
      // retries do the asking.
      owed = true
      pump()
    }
  }

  function beat() {
    // A save nobody knows the outcome of may still land, late, on top of a
    // newer answer to the same question. Once the queue has stood empty for a
    // heartbeat, the questions it carried go out once more.
    if (doubt.size > 0 && status === 'sitting' && failures === 0 && !busy && held.waiting.length === 0) {
      if (doubtRipe) {
        held = waitAgain(held, doubt)
        doubt = new Set()
        keep()
        emit()
      } else {
        doubtRipe = true
      }
    }
    owed = true
    pump()
  }

  // ---- after the time ran out ---------------------------------------------------
  //
  // The officers can make the exam longer after a phone has shown "Time is up"
  // (the hall lost its network for the last minutes). The database counts the
  // paper as running again from that moment, so the page keeps asking: once a
  // heartbeat for the first half hour while it is on screen, and whenever the
  // taker comes back to it. Answers the clock beat are still held, and go out
  // if the paper comes back.

  function watchAfter() {
    looks = 0
    afterTimer = setInterval(() => {
      looks += 1
      if (looks >= LOOKS_AFTER) {
        clearInterval(afterTimer)
        afterTimer = null
      }
      lookAgain()
    }, HEARTBEAT_MS)
  }

  async function lookAgain() {
    if (!alive || busy || status !== 'over' || why !== 'time' || pageHidden()) return
    busy = true
    const mine = era
    let reply = null
    try {
      reply = await api.examSave(address, [], false)
    } catch {
      // Still over, as far as this phone knows. The next look asks again.
    }
    busy = false
    if (!alive || mine !== era || status !== 'over' || reply?.state !== 'sitting') return
    // Running again: fetch the paper as on a fresh page, keeping what is held.
    clearInterval(afterTimer)
    afterTimer = null
    status = 'loading'
    why = null
    fromDatabase = false
    failures = 0
    startClocks()
    emit()
    pump()
  }

  // ---- the tab's lock -----------------------------------------------------------

  function begin() {
    era += 1
    stopTimers()
    paper = null
    fromDatabase = false
    held = emptyHeld()
    clock = null
    failures = 0
    owed = false
    handInNote = ''
    doubt = new Set()
    problem = ''
    status = 'loading'
    why = null
    startClocks()
    // What the phone holds is shown at once, and the database is asked behind
    // it: a refresh on a slow network costs the taker no time.
    if (takePhoneCopy()) sit()
    emit()
    pump()
  }

  // Another tab took the exam over. What this one held is on the phone (every
  // change is written there as it is made), and that tab reads it from there.
  // Only where the phone's storage refused is there nothing to read: what
  // waits here is then sent on its way out.
  function taken() {
    if (!alive) return
    if (!answersOnPhone) leaving()
    era += 1
    letGo = null
    status = 'elsewhere'
    why = null
    stopTimers()
    settleHandIn({ ok: false, reason: 'elsewhere' })
    emit()
  }

  async function enter(steal) {
    claims += 1
    const mine = claims
    let got
    try {
      got = await claim(`${LOCK_NAME}${address}:${userId}`, {
        steal,
        onTaken: () => {
          if (mine === claims) taken()
        },
      })
    } catch {
      // The browser would not say: carry on as the only tab.
      got = () => {}
    }
    if (!alive || mine !== claims) {
      if (got) got()
      return
    }
    if (!got) {
      if (status !== 'elsewhere') {
        status = 'elsewhere'
        emit()
      }
      return
    }
    letGo = got
    begin()
  }

  // ---- the page comes and goes --------------------------------------------------

  // The page is going to the background, or away for good: the browser may
  // never run it again. What waits is sent in a request that outlives the
  // page (examSaveLast in examApi.js). Its outcome is not known here, so the
  // questions it carried are sent once more later, like any save in doubt.
  function leaving() {
    if (!alive || !fromDatabase || (status !== 'sitting' && status !== 'ending')) return
    if (typeof api.examSaveLast !== 'function' || !online()) return
    const batch = takeBatch(held)
    if (batch.length === 0) return
    const text = JSON.stringify(batch)
    const at = readClock().wall
    if (lastLeft && lastLeft.text === text && Math.abs(at - lastLeft.at) < LEAVING_GAP_MS) return
    lastLeft = { text, at }
    if (!api.examSaveLast(address, batch)) return
    for (const item of batch) doubt.add(item.q)
    doubtRipe = false
  }

  function hidden() {
    // Do not sit on an answer for the 400 ms.
    if (sendTimer !== null) pump()
    leaving()
  }

  function shown() {
    if (!alive) return
    if (status === 'elsewhere') {
      // The other tab may have been closed since.
      enter(false)
      return
    }
    if (status === 'over') {
      lookAgain()
      return
    }
    owed = true
    tick()
    pump()
  }

  function backOnline() {
    if (!alive) return
    if (status === 'over') {
      lookAgain()
      return
    }
    owed = true
    emit()
    pump()
  }

  const onVisibility = () => (pageHidden() ? hidden() : shown())

  return {
    view,

    start() {
      if (alive) return
      alive = true
      if (typeof window !== 'undefined') {
        window.addEventListener('online', backOnline)
        window.addEventListener('offline', emit)
        window.addEventListener('pagehide', leaving)
        document.addEventListener('visibilitychange', onVisibility)
      }
      emit()
      enter(false)
    },

    stop() {
      if (!alive) return
      alive = false
      claims += 1
      stopTimers()
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', backOnline)
        window.removeEventListener('offline', emit)
        window.removeEventListener('pagehide', leaving)
        document.removeEventListener('visibilitychange', onVisibility)
      }
      settleHandIn({ ok: false, reason: 'offline' })
      unlock()
    },

    choose(id, c) {
      if (taking() && c !== null && canChoose(paper.questions, id, c)) change(setAnswer(held, id, c))
    },

    clear(id) {
      if (taking() && canChoose(paper.questions, id)) change(clearAnswer(held, id))
    },

    flag(id) {
      if (taking() && canChoose(paper.questions, id)) change(toggleFlag(held, id))
    },

    // Resolves when the database has answered or failed to: { ok: true } once
    // the exam is over (see `status` and `why`), or { ok: false, reason }
    // with 'offline' (it was not sent: say so and keep the button), 'unsure'
    // (it was sent and no answer came: `handInNote` is 'checking' until the
    // database says), 'gone', 'elsewhere', or the status when there is
    // nothing to hand in ('loading', 'ending'). The page shows `handInNote`.
    handIn() {
      if (!alive || status !== 'sitting') return Promise.resolve({ ok: status === 'over', reason: status })
      if (handIn) return handIn.promise
      if (!online()) {
        // The phone itself says it has no connection: nothing is sent, so
        // nothing is in doubt.
        handInNote = 'offline'
        emit()
        return Promise.resolve({ ok: false, reason: 'offline' })
      }
      handInNote = ''
      let resolve
      const promise = new Promise((r) => {
        resolve = r
      })
      handIn = { promise, resolve }
      emit()
      pump()
      return promise
    },

    // Try the database now, whatever the wait was going to be.
    retry() {
      if (!alive || ended()) return
      owed = true
      pump()
    },

    // The session was renewed (it had run out while there was no connection):
    // calls that were turned away will pass now, so do not wait for the next try.
    sessionBack() {
      if (!alive || ended() || failures === 0) return
      owed = true
      pump()
    },

    // "Use this tab", on the screen that says the exam is open in another one.
    takeOver() {
      if (alive && status === 'elsewhere') enter(true)
    },

    // What the page's events call, by name for a script to call too.
    pageHidden: hidden,
    pageShown: shown,
    pageLeaving: leaving,
    backOnline,
  }
}

// ---- the hook -------------------------------------------------------------------

const LOADING = Object.freeze({
  status: 'loading',
  over: false,
  why: null,
  problem: '',
  exam: null,
  attempt: null,
  questions: NO_QUESTIONS,
  answers: NO_ANSWERS,
  save: Object.freeze({ kind: 'saved', count: 0 }),
  connected: true,
  fromPhone: false,
  onPhone: true,
  clock: null,
  handingIn: false,
  handInNote: '',
  locked: false,
  unsent: 0,
})

// The sitting at /exam/<word> for the signed-in account. Mount it once the
// door says the taker has started, or when hasHeldPaper says the phone holds
// their paper. `attemptId` is the paper's id when the database has just said
// it (see createSitting); it is read when the sitting is made, and a later
// change never starts the sitting again. What it returns:
//
//   status, why, problem   see createSitting; `over` is status === 'over'
//   exam, attempt          { title, minutes }, { id, started_at, deadline_at }
//   questions              this taker's paper: [{ id, body, options }]
//   answers                { [question id]: { c, f } }; read one with answerOf
//   total, answered        how many questions, how many have an answer
//   unanswered, flagged    question numbers (from 1) for the review
//   pageCount, pages       pageSummaries: one row per page for its button
//   questionsOn(page)      the questions of a page (from 1), each with its `n`
//   save                   { kind: 'saved' | 'saving' | 'offline', count }
//   connected              false while the database is not answering
//   fromPhone              the paper is the phone's copy; the database has not answered yet
//   onPhone                false when the phone's storage refused the last write
//   clock                  for useTimeLeft
//   handingIn              a hand-in is on its way
//   handInNote             '' | 'offline' | 'checking' | 'not_yet': a hand-in
//                          that did not go through (handInWords in examFlow.js)
//   locked                 answers are not taken just now (a hand-in is on its
//                          way, or nobody knows yet whether it arrived)
//   unsent                 once over: answers the database never received
//   setAnswer(id, c), clearAnswer(id), toggleFlag(id), handIn(), retry(),
//   takeOver()
export function useSitting({ word, userId, attemptId = null }) {
  const [state, setState] = useState(LOADING)
  // The one sitting. Everything the callbacks below do goes through it, so
  // none of them can act on answers from an earlier render.
  const sitting = useRef(null)
  const named = useRef(attemptId)
  named.current = attemptId

  useEffect(() => {
    if (!word || !userId) {
      setState(LOADING)
      return undefined
    }
    const made = createSitting({ word, userId, attemptId: named.current, onChange: setState })
    sitting.current = made
    made.start()
    const stopListening = onAuthStateChange((event) => {
      if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') made.sessionBack()
    })
    return () => {
      stopListening()
      made.stop()
      if (sitting.current === made) sitting.current = null
    }
  }, [word, userId])

  const { questions, answers } = state
  const lists = useMemo(
    () => ({
      total: questions.length,
      answered: answeredCount(questions, answers),
      unanswered: unansweredNumbers(questions, answers),
      flagged: flaggedNumbers(questions, answers),
      pageCount: pageCount(questions.length),
      pages: pageSummaries(questions, answers),
    }),
    [questions, answers],
  )
  const questionsOn = useCallback((page) => pageQuestions(questions, page), [questions])

  const choose = useCallback((id, c) => sitting.current?.choose(id, c), [])
  const clear = useCallback((id) => sitting.current?.clear(id), [])
  const flag = useCallback((id) => sitting.current?.flag(id), [])
  const retry = useCallback(() => sitting.current?.retry(), [])
  const takeOver = useCallback(() => sitting.current?.takeOver(), [])
  const handIn = useCallback(
    () => (sitting.current ? sitting.current.handIn() : Promise.resolve({ ok: false, reason: 'loading' })),
    [],
  )

  return {
    ...state,
    ...lists,
    questionsOn,
    setAnswer: choose,
    clearAnswer: clear,
    toggleFlag: flag,
    handIn,
    retry,
    takeOver,
  }
}

// Milliseconds left on the sitting's clock, in whole seconds, or null while it
// is not known. A hook of its own so that only the clock on the page is drawn
// again each second, not the ten questions under it. Show it with formatClock.
export function useTimeLeft(clock) {
  const read = useCallback(() => {
    const now = phoneClock()
    // Only the phone's wall clock says the time is up (it was set ahead, or
    // the phone slept): not known until the database answers.
    if (timeUp(clock, now) === 'unsure') return null
    const left = remaining(clock, now)
    return left === null ? null : Math.ceil(left / 1000) * 1000
  }, [clock])
  const [left, setLeft] = useState(read)

  useEffect(() => {
    setLeft(read())
    const timer = setInterval(() => setLeft(read()), 250)
    return () => clearInterval(timer)
  }, [read])

  return left
}
