import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSitting, forgetHeldPapers, hasHeldPaper } from './useSitting.js'

// createSitting, run against a scripted database, a phone's storage held in
// memory, a clock moved by hand and Vitest's timers. The rules it leans on
// are proved in sitting.test.js; this proves the queue: what goes out, when,
// and what the page is told.

const T0 = Date.parse('2026-11-14T08:00:00Z')
const SECOND = 1000
const MINUTE = 60 * SECOND
const iso = (ms) => new Date(ms).toISOString()
const copy = (value) => JSON.parse(JSON.stringify(value))

const paperOf = (n) =>
  Array.from({ length: n }, (_, i) => ({ id: `q${i + 1}`, body: `Question ${i + 1}`, options: ['a', 'b', 'c', 'd'] }))

// The phone's two entries per attempt. Two tabs given the same store are two
// tabs of one browser. `refuse` makes it a phone whose storage takes nothing.
function makeStore() {
  const papers = new Map()
  const kept = new Map()
  const store = {
    papers,
    kept,
    refuse: false,
    paper: (word, uid) => copy([...papers.values()].find((p) => p.word === word && p.uid === uid) || null),
    answers: (id) => (kept.has(id) ? copy(kept.get(id)) : null),
    keepPaper(word, uid, paper) {
      if (store.refuse) return false
      papers.set(paper.attempt.id, copy({ word, uid, ...paper }))
      return true
    },
    keepAnswers(id, value) {
      if (store.refuse) return false
      kept.set(id, copy(value))
      return true
    },
    forget(id) {
      kept.delete(id)
      papers.delete(id)
    },
    forgetOthers(word, uid, keepId) {
      for (const p of [...papers.values()]) {
        if (p.word === word && p.uid === uid && p.attempt.id !== keepId) store.forget(p.attempt.id)
      }
    },
  }
  return store
}

// The database as rpc/exam_paper and rpc/exam_save behave (contract 2.4).
// Each call stays in flight until the script settles it:
//   answer(at)  the database answers, its clock reading `at`
//   drop()      no answer, and the call never reached the database
//   lose(at)    the database took the call, and its answer never arrived
//   refuse(m)   the database's own no, in its sentence
function makeDb({ deadline, questions = paperOf(5) }) {
  const db = { rows: {}, submitted: false, deadline, calls: [], last: [], pending: [] }
  const wait = (call) => new Promise((resolve, reject) => db.pending.push({ ...call, resolve, reject }))
  db.api = {
    examPaper: () => wait({ kind: 'paper' }),
    examSave(word, batch, final, options) {
      db.calls.push({ batch: copy(batch), final, timeout: options?.timeout })
      return wait({ kind: 'save', batch: copy(batch), final })
    },
    examSaveLast(word, batch) {
      db.last.push(copy(batch))
      return true
    },
  }
  const reply = (call, at) => {
    if (call.kind === 'paper') {
      if (db.submitted || at >= db.deadline) return { state: 'over', submitted: db.submitted }
      return {
        state: 'sitting',
        exam: { title: 'Mock exam', minutes: 120 },
        attempt: { id: 'a1', started_at: iso(T0), deadline_at: iso(db.deadline) },
        now: iso(at),
        questions,
        answers: Object.entries(db.rows).map(([q, v]) => ({ q, ...v })),
      }
    }
    const times = { deadline_at: iso(db.deadline), now: iso(at) }
    if (db.submitted) return { state: 'over', submitted: true, saved: 0, ...times }
    if (at > db.deadline + 30 * SECOND) return { state: 'over', submitted: false, saved: 0, ...times }
    for (const item of call.batch) db.rows[item.q] = { c: item.c, f: item.f }
    if (call.final) db.submitted = true
    return { state: call.final || at >= db.deadline ? 'over' : 'sitting', submitted: call.final, saved: call.batch.length, ...times }
  }
  const next = () => {
    const call = db.pending.shift()
    if (!call) throw new Error('No call is in flight.')
    return call
  }
  const failed = (kind, message = 'The exam could not be reached.') => Object.assign(new Error(message), { kind })
  db.answer = (at) => {
    const call = next()
    call.resolve(reply(call, at))
  }
  db.drop = (kind = 'offline') => next().reject(failed(kind))
  db.lose = (at) => {
    const call = next()
    reply(call, at)
    call.reject(failed('offline'))
  }
  db.refuse = (message) => next().reject(failed('refused', message))
  return db
}

// The browser's lock for the exam, shared by the tabs given it.
function makeLocks() {
  let holder = null
  return (name, { steal, onTaken }) => {
    if (holder && !steal) return Promise.resolve(null)
    const loser = holder
    const mine = { onTaken }
    holder = mine
    if (loser) loser.onTaken()
    return Promise.resolve(() => {
      if (holder === mine) holder = null
    })
  }
}

function makeTab({ db, store, clock, locks = () => Promise.resolve(() => {}), online = () => true, attemptId = null }) {
  const tab = { view: null, changes: 0 }
  tab.sitting = createSitting({
    word: 'mock-exam',
    userId: 'u1',
    attemptId,
    onChange(view) {
      tab.view = view
      tab.changes += 1
    },
    api: db.api,
    store,
    readClock: () => ({ wall: clock.wall, mono: clock.mono }),
    online,
    claim: locks,
  })
  return tab
}

// Lets everything that is ready to run, run.
const settle = async () => {
  for (let i = 0; i < 40; i += 1) await Promise.resolve()
}

// One tab with its paper on screen: the database answered at T0.
async function open({ deadline = T0 + 60 * MINUTE, questions, online } = {}) {
  const clock = { wall: T0, mono: 1000 }
  const db = makeDb({ deadline, questions })
  const store = makeStore()
  const tab = makeTab({ db, store, clock, online })
  tab.sitting.start()
  await settle()
  db.answer(T0)
  await settle()
  // Time passes on the phone's clocks and on the timers together.
  const pass = async (ms) => {
    clock.wall += ms
    clock.mono += ms
    await vi.advanceTimersByTimeAsync(ms)
    await settle()
  }
  // The phone's clocks put at a moment of the exam, without the timers.
  const jumpTo = (at) => {
    clock.mono += at - clock.wall
    clock.wall = at
  }
  return { clock, db, store, tab, pass, jumpTo }
}

const item = (q, c, f = false) => ({ q, c, f })

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('the phone’s own storage', () => {
  // localStorage, as far as the sitting uses it.
  function plantStorage() {
    const entries = new Map()
    vi.stubGlobal('localStorage', {
      getItem: (key) => (entries.has(key) ? entries.get(key) : null),
      setItem: (key, value) => entries.set(key, String(value)),
      removeItem: (key) => entries.delete(key),
      key: (i) => [...entries.keys()][i] ?? null,
      get length() {
        return entries.size
      },
    })
    return entries
  }

  // A sitting on the real store (not makeStore), with its paper on screen.
  async function sitOnThePhone(db, clock) {
    const tab = { view: null }
    tab.sitting = createSitting({
      word: 'mock-exam',
      userId: 'u1',
      onChange: (view) => {
        tab.view = view
      },
      api: db.api,
      readClock: () => ({ wall: clock.wall, mono: clock.mono }),
      online: () => true,
      claim: () => Promise.resolve(() => {}),
    })
    tab.sitting.start()
    await settle()
    db.answer(T0)
    await settle()
    return tab
  }

  it('keeps the paper and the answers under the two names the contract gives them', async () => {
    const entries = plantStorage()
    const clock = { wall: T0, mono: 1000 }
    const db = makeDb({ deadline: T0 + 60 * MINUTE })
    const tab = await sitOnThePhone(db, clock)
    tab.sitting.choose('q1', 2)
    expect([...entries.keys()].sort()).toEqual(['ausss-exam-paper:a1', 'ausss-exam:a1'])
    expect(JSON.parse(entries.get('ausss-exam-paper:a1'))).toMatchObject({ word: 'mock-exam', uid: 'u1', attempt: { id: 'a1' } })
    expect(JSON.parse(entries.get('ausss-exam:a1'))).toMatchObject({ answers: { q1: { c: 2, f: false } }, waiting: ['q1'] })
    expect(tab.view.onPhone).toBe(true)
    tab.sitting.stop()
  })

  it('knows whose paper it holds, and for which address', async () => {
    plantStorage()
    const clock = { wall: T0, mono: 1000 }
    const tab = await sitOnThePhone(makeDb({ deadline: T0 + 60 * MINUTE }), clock)
    tab.sitting.stop()
    expect(hasHeldPaper('mock-exam', 'u1')).toBe(true)
    expect(hasHeldPaper(' Mock-Exam ', 'u1')).toBe(true)
    // another student on the same phone, another exam, nobody
    expect(hasHeldPaper('mock-exam', 'u2')).toBe(false)
    expect(hasHeldPaper('other-exam', 'u1')).toBe(false)
    expect(hasHeldPaper('mock-exam', null)).toBe(false)
  })

  it('forgets the paper of an account that signs out, unless answers still wait on it', async () => {
    const entries = plantStorage()
    const clock = { wall: T0, mono: 1000 }
    const tab = await sitOnThePhone(makeDb({ deadline: T0 + 60 * MINUTE }), clock)
    tab.sitting.choose('q1', 2) // never sent
    tab.sitting.stop()
    // all there is of that answer is on the phone: it stays
    forgetHeldPapers('mock-exam', 'u1')
    expect(hasHeldPaper('mock-exam', 'u1')).toBe(true)
    // nothing waits: nothing of the paper stays for whoever holds the phone next
    entries.set('ausss-exam:a1', JSON.stringify({ answers: { q1: { c: 2, f: false } }, waiting: [] }))
    forgetHeldPapers('mock-exam', 'u2') // someone else's sign-out touches nothing
    expect(entries.size).toBe(2)
    forgetHeldPapers('mock-exam', 'u1')
    expect(entries.size).toBe(0)
    expect(hasHeldPaper('mock-exam', 'u1')).toBe(false)
  })

  it('holds nothing, and breaks nothing, where there is no storage at all', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(hasHeldPaper('mock-exam', 'u1')).toBe(false)
    expect(() => forgetHeldPapers('mock-exam', 'u1')).not.toThrow()
  })
})

describe('the paper', () => {
  it('is not shown until the database has answered, and is then kept on the phone', async () => {
    const clock = { wall: T0, mono: 1000 }
    const db = makeDb({ deadline: T0 + 60 * MINUTE })
    const store = makeStore()
    const tab = makeTab({ db, store, clock })
    tab.sitting.start()
    await settle()
    expect(tab.view).toMatchObject({ status: 'loading', questions: [], fromPhone: false })
    db.answer(T0)
    await settle()
    expect(tab.view).toMatchObject({ status: 'sitting', fromPhone: false, onPhone: true, save: { kind: 'saved', count: 0 } })
    expect(tab.view.questions).toHaveLength(5)
    expect(tab.view.attempt.id).toBe('a1')
    expect(store.papers.get('a1')).toMatchObject({ word: 'mock-exam', uid: 'u1' })
    tab.sitting.stop()
  })

  it('comes from the phone at once after a refresh, with the database asked behind it', async () => {
    const { clock, db, store, tab } = await open()
    tab.sitting.choose('q1', 0)
    tab.sitting.choose('q2', 1)
    tab.sitting.choose('q3', 2)
    // on the phone the moment they are tapped, before anything is sent
    expect(store.kept.get('a1').waiting).toEqual(['q1', 'q2', 'q3'])
    await vi.advanceTimersByTimeAsync(400)
    db.drop()
    await settle()
    tab.sitting.stop() // the refresh

    clock.wall += 5 * SECOND
    clock.mono = 50 // a new page: its stopwatch starts again
    const again = makeTab({ db, store, clock })
    again.sitting.start()
    await settle()
    // rpc/exam_paper is still in flight, and the questions are on screen
    expect(db.pending.map((call) => call.kind)).toEqual(['paper'])
    expect(again.view).toMatchObject({ status: 'sitting', fromPhone: true, save: { kind: 'saving', count: 3 } })
    expect(again.view.questions).toHaveLength(5)
    expect(again.view.clock).not.toBe(null)
    again.sitting.choose('q4', 3)

    db.answer(T0 + 10 * SECOND)
    await settle()
    // what waited on the phone wins over the database's (empty) answers, and goes out
    expect(again.view.fromPhone).toBe(false)
    expect(db.calls.at(-1).batch).toEqual([item('q1', 0), item('q2', 1), item('q3', 2), item('q4', 3)])
    db.answer(T0 + 11 * SECOND)
    await settle()
    expect(again.view.save).toEqual({ kind: 'saved', count: 0 })
    expect(db.rows).toEqual({ q1: { c: 0, f: false }, q2: { c: 1, f: false }, q3: { c: 2, f: false }, q4: { c: 3, f: false } })
    again.sitting.stop()
  })

  it('stays on the phone’s copy while the database does not answer', async () => {
    const { clock, db, store, tab } = await open()
    tab.sitting.stop()
    const again = makeTab({ db, store, clock })
    again.sitting.start()
    await settle()
    db.drop()
    await settle()
    expect(again.view).toMatchObject({ status: 'sitting', fromPhone: true, connected: false })
    again.sitting.choose('q1', 1)
    expect(again.view.answers.q1).toEqual({ c: 1, f: false })
    expect(again.view.save).toEqual({ kind: 'offline', count: 1 })
    again.sitting.stop()
  })

  it('says so when the phone’s storage takes nothing', async () => {
    const { store, tab } = await open()
    store.refuse = true
    tab.sitting.choose('q1', 2)
    expect(tab.view.onPhone).toBe(false)
    expect(tab.view.answers.q1).toEqual({ c: 2, f: false })
    tab.sitting.stop()
  })

  it('is gone, with the database’s sentence, when the database knows no such sitting', async () => {
    const { clock, db, store, tab } = await open()
    tab.sitting.stop()
    const again = makeTab({ db, store, clock })
    again.sitting.start()
    await settle()
    db.refuse('You have not started this exam.')
    await settle()
    expect(again.view).toMatchObject({ status: 'gone', problem: 'You have not started this exam.', questions: [] })
    // the copy is stale: the phone forgets it
    expect(store.papers.size).toBe(0)
    expect(store.kept.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    again.sitting.stop()
  })

  // The officers deleted this taker's paper in the middle (a save was refused,
  // so the phone still holds its copy), and the taker has started again: the
  // database has made paper 'a1', and the phone holds what is left of 'a0'.
  function leftOver(store) {
    store.keepPaper('mock-exam', 'u1', {
      exam: { title: 'Mock exam', minutes: 120 },
      attempt: { id: 'a0', started_at: iso(T0 - 30 * MINUTE), deadline_at: iso(T0 + 90 * MINUTE) },
      questions: paperOf(3),
    })
    store.keepAnswers('a0', { answers: { q1: { c: 2, f: true } }, waiting: ['q1'] })
  }

  it('is never the phone’s copy of a paper the database has replaced', async () => {
    const clock = { wall: T0, mono: 1000 }
    const db = makeDb({ deadline: T0 + 120 * MINUTE })
    const store = makeStore()
    leftOver(store)
    const tab = makeTab({ db, store, clock, attemptId: 'a1' })
    tab.sitting.start()
    await settle()
    // the new paper is on its way, and nothing of the old one is on screen
    expect(tab.view).toMatchObject({ status: 'loading', questions: [], answers: {}, clock: null })
    tab.sitting.choose('q1', 0) // nothing to tap, nothing taken
    db.answer(T0)
    await settle()
    expect(tab.view).toMatchObject({ status: 'sitting', fromPhone: false, attempt: { id: 'a1' }, answers: {} })
    expect(tab.view.questions).toHaveLength(5)
    // the old paper's waiting answer is not sent to the new one, and its copy is gone
    expect(db.calls).toEqual([])
    expect([...store.papers.keys()]).toEqual(['a1'])
    expect(store.kept.has('a0')).toBe(false)
    tab.sitting.stop()
  })

  it('does not fall back on that copy when the database does not answer', async () => {
    const clock = { wall: T0, mono: 1000 }
    const db = makeDb({ deadline: T0 + 120 * MINUTE })
    const store = makeStore()
    leftOver(store)
    const tab = makeTab({ db, store, clock, attemptId: 'a1' })
    tab.sitting.start()
    await settle()
    db.drop()
    await settle()
    expect(tab.view).toMatchObject({ status: 'loading', questions: [], connected: false })
    tab.sitting.stop()
  })

  it('is the phone’s copy at once when it is of the paper the database named', async () => {
    const { clock, db, store, tab } = await open()
    tab.sitting.choose('q2', 1)
    tab.sitting.stop()
    const again = makeTab({ db, store, clock, attemptId: 'a1' })
    again.sitting.start()
    await settle()
    expect(again.view).toMatchObject({ status: 'sitting', fromPhone: true, answers: { q2: { c: 1, f: false } } })
    again.sitting.stop()
  })

  it('hears nothing more once stopped, and leaves no timer behind (StrictMode)', async () => {
    const clock = { wall: T0, mono: 1000 }
    const db = makeDb({ deadline: T0 + 60 * MINUTE })
    const store = makeStore()
    const one = makeTab({ db, store, clock })
    one.sitting.start()
    await settle()
    one.sitting.stop()
    const heard = one.changes
    const two = makeTab({ db, store, clock })
    two.sitting.start()
    await settle()
    db.answer(T0)
    db.answer(T0)
    await settle()
    expect(one.changes).toBe(heard)
    expect(two.view.status).toBe('sitting')
    two.sitting.stop()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('the queue', () => {
  it('sends an answer 400 ms after the tap, and never flies two calls at once', async () => {
    const { db, tab } = await open()
    tab.sitting.choose('q1', 2)
    await vi.advanceTimersByTimeAsync(399)
    expect(db.pending).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(db.pending).toHaveLength(1)
    expect(db.calls.at(-1)).toEqual({ batch: [item('q1', 2)], final: false, timeout: undefined })
    expect(tab.view.save).toEqual({ kind: 'saving', count: 1 })

    // tapped while that save is in flight: it waits its turn
    tab.sitting.choose('q2', 0)
    tab.sitting.flag('q2')
    await vi.advanceTimersByTimeAsync(5 * SECOND)
    expect(db.pending).toHaveLength(1)
    expect(db.calls).toHaveLength(1)

    db.answer(T0 + SECOND)
    await settle()
    // the first is settled, and the second leaves at once with the latest
    expect(db.calls.at(-1).batch).toEqual([item('q2', 0, true)])
    db.answer(T0 + 2 * SECOND)
    await settle()
    expect(db.pending).toHaveLength(0)
    expect(tab.view.save).toEqual({ kind: 'saved', count: 0 })
    expect(db.rows).toEqual({ q1: { c: 2, f: false }, q2: { c: 0, f: true } })
    tab.sitting.stop()
  })

  it('keeps what a failed save carried, and the next try sends whatever is latest', async () => {
    const { db, store, tab } = await open()
    tab.sitting.choose('q1', 0)
    await vi.advanceTimersByTimeAsync(400)
    db.drop()
    await settle()
    expect(tab.view).toMatchObject({ connected: false, save: { kind: 'offline', count: 1 } })
    expect(store.kept.get('a1').waiting).toEqual(['q1'])
    await vi.advanceTimersByTimeAsync(1999)
    expect(db.pending).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(db.calls.at(-1).batch).toEqual([item('q1', 0)])
    // changed while that try is in flight, and it fails as well
    tab.sitting.choose('q2', 1)
    tab.sitting.choose('q1', 3)
    db.drop()
    await settle()
    expect(tab.view.save).toEqual({ kind: 'offline', count: 2 })
    // a tap does not wait for the schedule: the latest goes 400 ms after it
    await vi.advanceTimersByTimeAsync(400)
    expect(db.calls.at(-1).batch).toEqual([item('q1', 3), item('q2', 1)])
    db.answer(T0 + 5 * SECOND)
    await settle()
    expect(tab.view).toMatchObject({ connected: true, save: { kind: 'saved', count: 0 } })
    expect(db.rows).toEqual({ q1: { c: 3, f: false }, q2: { c: 1, f: false } })
    tab.sitting.stop()
  })

  it('tries again after 2 s, 5 s, 10 s, then every 15 s, and at once when asked', async () => {
    const { db, tab } = await open()
    tab.sitting.choose('q1', 0)
    await vi.advanceTimersByTimeAsync(400)
    const waits = []
    for (let i = 0; i < 5; i += 1) {
      db.drop()
      await settle()
      let waited = 0
      while (db.pending.length === 0) {
        await vi.advanceTimersByTimeAsync(SECOND)
        waited += SECOND
      }
      waits.push(waited)
    }
    expect(waits).toEqual([2000, 5000, 10000, 15000, 15000])
    db.drop()
    await settle()
    tab.sitting.retry()
    expect(db.pending).toHaveLength(1)
    db.drop()
    await settle()
    // the phone says it is back online, or its session was renewed
    tab.sitting.backOnline()
    expect(db.pending).toHaveLength(1)
    db.drop()
    await settle()
    tab.sitting.sessionBack()
    expect(db.pending).toHaveLength(1)
    tab.sitting.stop()
  })

  it('sends a backlog in batches, and stops where the database stops saving', async () => {
    // late by five seconds the rest still lands; late by forty it does not
    for (const [late, unsent] of [
      [5 * SECOND, 0],
      [40 * SECOND, 60],
    ]) {
      const { db, store, tab } = await open({ deadline: T0 + 10 * MINUTE, questions: paperOf(260) })
      for (let i = 1; i <= 260; i += 1) tab.sitting.choose(`q${i}`, 1)
      await vi.advanceTimersByTimeAsync(400)
      db.answer(T0 + SECOND)
      await settle()
      db.answer(db.deadline + late)
      await settle()
      expect(db.calls.map((call) => call.batch.length)).toEqual([200, 60])
      expect(tab.view).toMatchObject({ status: 'over', why: 'time', unsent, questions: [] })
      expect(Object.keys(db.rows)).toHaveLength(260 - unsent)
      // nothing of the exam stays on the phone, unless answers never arrived
      expect(store.kept.has('a1')).toBe(unsent > 0)
      expect(store.papers.has('a1')).toBe(unsent > 0)
      tab.sitting.stop()
    }
  })

  it('sends the questions of a save nobody knows the outcome of once more, after the queue has stood empty', async () => {
    const { db, tab, pass } = await open()
    tab.sitting.choose('q1', 0)
    await pass(400)
    // this save reaches no answer: the phone cannot know whether the database has q1 = a
    db.drop()
    await settle()
    tab.sitting.choose('q1', 2)
    await pass(2 * SECOND)
    expect(db.calls.at(-1).batch).toEqual([item('q1', 2)])
    db.answer(T0 + 3 * SECOND)
    await settle()
    expect(tab.view.save).toEqual({ kind: 'saved', count: 0 })
    // the first save lands after all, late, on top of the newer answer
    db.rows.q1 = { c: 0, f: false }

    const sent = db.calls.length
    // the first heartbeat only sees that the queue is empty
    await pass(60 * SECOND)
    expect(db.calls.at(-1).batch).toEqual([])
    db.answer(T0 + 63 * SECOND)
    await settle()
    // the second sends q1 as the phone holds it
    await pass(60 * SECOND)
    expect(db.calls.slice(sent).map((call) => call.batch)).toEqual([[], [item('q1', 2)]])
    db.answer(T0 + 123 * SECOND)
    await settle()
    expect(db.rows.q1).toEqual({ c: 2, f: false })
    // and only once
    await pass(60 * SECOND)
    db.answer(T0 + 183 * SECOND)
    await settle()
    await pass(60 * SECOND)
    expect(db.calls.slice(sent).filter((call) => call.batch.length > 0)).toHaveLength(1)
    tab.sitting.stop()
  })

  it('has no doubt about a save that was turned away for its session', async () => {
    const { db, tab, pass } = await open()
    tab.sitting.choose('q1', 0)
    await pass(400)
    db.drop('signed_out')
    await settle()
    await pass(2 * SECOND)
    db.answer(T0 + 3 * SECOND)
    await settle()
    const sent = db.calls.length
    for (let beat = 1; beat <= 3; beat += 1) {
      await pass(60 * SECOND)
      db.answer(T0 + beat * 60 * SECOND)
      await settle()
    }
    expect(db.calls.slice(sent).every((call) => call.batch.length === 0)).toBe(true)
    tab.sitting.stop()
  })
})

describe('the heartbeat', () => {
  it('asks for the time every minute, and brings a deadline the officers moved', async () => {
    const { db, tab, pass } = await open({ deadline: T0 + 10 * MINUTE })
    db.deadline += 5 * MINUTE
    await pass(59 * SECOND)
    expect(db.calls).toHaveLength(0)
    await pass(SECOND)
    expect(db.calls.at(-1)).toMatchObject({ batch: [], final: false })
    db.answer(T0 + 60 * SECOND)
    await settle()
    expect(tab.view.attempt.deadline_at).toBe(iso(T0 + 15 * MINUTE))
    expect(tab.view.clock.deadline).toBe(T0 + 15 * MINUTE)
    tab.sitting.stop()
  })
})

describe('the end of the time', () => {
  it('stops taking answers at zero, asks the database, and shows what it says', async () => {
    const { db, tab, pass, jumpTo } = await open({ deadline: T0 + 10 * MINUTE })
    jumpTo(db.deadline - SECOND)
    await pass(SECOND)
    expect(tab.view).toMatchObject({ status: 'ending', why: 'time' })
    tab.sitting.choose('q1', 1)
    expect(tab.view.answers).toEqual({})
    expect(db.calls.at(-1)).toMatchObject({ batch: [], final: false })
    db.answer(db.deadline + SECOND)
    await settle()
    expect(tab.view).toMatchObject({ status: 'over', why: 'time', unsent: 0 })
    tab.sitting.stop()
  })

  it('goes back to the paper when the database says there is time left', async () => {
    const { db, tab, pass, jumpTo } = await open({ deadline: T0 + 10 * MINUTE })
    jumpTo(db.deadline - SECOND)
    await pass(SECOND)
    expect(tab.view.status).toBe('ending')
    db.deadline += 5 * MINUTE // moved while the phone shows "Time is up."
    db.answer(T0 + 10 * MINUTE)
    await settle()
    expect(tab.view.status).toBe('sitting')
    expect(tab.view.questions).toHaveLength(5)
    expect(tab.view.clock.deadline).toBe(T0 + 15 * MINUTE)
    tab.sitting.stop()
  })

  it('sends an answer tapped while an empty call was in flight, when that call comes back "over"', async () => {
    const { db, tab, jumpTo } = await open({ deadline: T0 + 10 * MINUTE })
    // two seconds are left on the phone; the heartbeat leaves
    jumpTo(db.deadline - 2 * SECOND)
    tab.sitting.retry()
    expect(db.calls.at(-1)).toMatchObject({ batch: [], final: false })
    tab.sitting.choose('q1', 2)
    expect(tab.view.answers.q1).toEqual({ c: 2, f: false })
    // the database's clock was a second past the deadline: it still saves for 29 more
    db.answer(db.deadline + SECOND)
    await settle()
    expect(tab.view.status).toBe('ending')
    expect(db.calls.at(-1).batch).toEqual([item('q1', 2)])
    db.answer(db.deadline + 2 * SECOND)
    await settle()
    expect(tab.view).toMatchObject({ status: 'over', why: 'time', unsent: 0 })
    expect(db.rows.q1).toEqual({ c: 2, f: false })
    tab.sitting.stop()
  })

  it('counts that answer as not received when the thirty seconds had passed', async () => {
    const { db, store, tab, jumpTo } = await open({ deadline: T0 + 10 * MINUTE })
    jumpTo(db.deadline - 2 * SECOND)
    tab.sitting.retry()
    tab.sitting.choose('q1', 2)
    db.answer(db.deadline + 31 * SECOND)
    await settle()
    expect(db.calls.at(-1).batch).toEqual([item('q1', 2)])
    db.answer(db.deadline + 32 * SECOND)
    await settle()
    expect(tab.view).toMatchObject({ status: 'over', why: 'time', unsent: 1 })
    expect(db.rows).toEqual({})
    expect(store.kept.get('a1').waiting).toEqual(['q1'])
    tab.sitting.stop()
  })

  it('tries every second and a half, with a short patience, while the database still takes a late save', async () => {
    const { clock, db, tab, pass, jumpTo } = await open({ deadline: T0 + 10 * MINUTE })
    jumpTo(db.deadline - 3 * SECOND)
    tab.sitting.choose('q1', 1)
    const tries = []
    for (let t = 0; t < 70 * SECOND; t += 250) {
      await pass(250)
      while (db.pending.length > 0) {
        tries.push({ at: (clock.wall - db.deadline) / SECOND, timeout: db.calls.at(-1).timeout })
        db.drop() // a phone with no connection: every try fails at once
        await settle()
      }
    }
    expect(tab.view.status).toBe('ending')
    const racing = tries.filter((t) => t.at >= 0 && t.at <= 30)
    expect(racing.length).toBeGreaterThanOrEqual(18)
    expect(racing.every((t) => t.timeout === 8000)).toBe(true)
    for (let i = 1; i < racing.length; i += 1) expect(racing[i].at - racing[i - 1].at).toBeLessThanOrEqual(2)
    // once a late save can no longer land, the slow schedule again (and the heartbeat)
    const after = tries.filter((t) => t.at > 32)
    expect(after.length).toBeGreaterThanOrEqual(2)
    expect(after.length).toBeLessThanOrEqual(4)
    expect(after.every((t) => t.timeout === undefined)).toBe(true)
    tab.sitting.stop()
  })
})

describe('the phone’s clock', () => {
  it('keeps the paper open when only the wall clock jumps ahead, and asks the database', async () => {
    const { clock, db, tab } = await open({ deadline: T0 + 50 * MINUTE })
    clock.wall += 60 * MINUTE // set an hour ahead; one second really passes
    clock.mono += SECOND
    await vi.advanceTimersByTimeAsync(SECOND)
    expect(tab.view.status).toBe('sitting')
    expect(tab.view.questions).toHaveLength(5)
    expect(db.calls.at(-1)).toMatchObject({ batch: [], final: false })
    // no connection: the paper stays, and the retries do the asking, not every tick
    db.drop()
    await settle()
    const asked = db.calls.length
    clock.mono += SECOND
    clock.wall += SECOND
    await vi.advanceTimersByTimeAsync(SECOND)
    expect(db.calls).toHaveLength(asked)
    expect(tab.view.status).toBe('sitting')
    // answers are still taken
    tab.sitting.choose('q1', 1)
    expect(tab.view.answers.q1).toEqual({ c: 1, f: false })
    clock.mono += SECOND
    clock.wall += SECOND
    await vi.advanceTimersByTimeAsync(SECOND)
    expect(db.calls.at(-1).batch).toEqual([item('q1', 1)])
    db.answer(T0 + 3 * SECOND)
    await settle()
    expect(tab.view.status).toBe('sitting')
    expect(tab.view.clock.deadline - tab.view.clock.now).toBe(50 * MINUTE - 3 * SECOND)
    expect(db.rows.q1).toEqual({ c: 1, f: false })
    tab.sitting.stop()
  })
})

describe('handing in', () => {
  it('goes with the batch that empties the queue, ends the exam and leaves nothing on the phone', async () => {
    const { db, store, tab } = await open()
    tab.sitting.choose('q1', 2)
    const first = tab.sitting.handIn()
    const second = tab.sitting.handIn()
    expect(second).toBe(first)
    expect(db.calls.at(-1)).toMatchObject({ batch: [item('q1', 2)], final: true })
    expect(tab.view).toMatchObject({ handingIn: true, locked: true })
    // not taken while the hand-in is on its way
    tab.sitting.choose('q2', 1)
    expect(tab.view.answers.q2).toBeUndefined()
    db.answer(T0 + 9 * SECOND)
    expect(await first).toEqual({ ok: true })
    expect(tab.view).toMatchObject({ status: 'over', why: 'handed_in', unsent: 0, handingIn: false })
    expect(store.kept.size + store.papers.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    expect(await tab.sitting.handIn()).toEqual({ ok: true, reason: 'over' })
    tab.sitting.stop()
  })

  it('is not sent, and says so, when the phone itself has no connection', async () => {
    let connected = true
    const { db, tab } = await open({ online: () => connected })
    connected = false
    expect(await tab.sitting.handIn()).toEqual({ ok: false, reason: 'offline' })
    expect(db.calls).toHaveLength(0)
    expect(tab.view).toMatchObject({ status: 'sitting', handInNote: 'offline', locked: false })
    // nothing is in doubt: the taker carries on, and the line goes with the next change
    tab.sitting.choose('q1', 0)
    expect(tab.view).toMatchObject({ handInNote: '', answers: { q1: { c: 0, f: false } } })
    tab.sitting.stop()
  })

  it('takes no answer after a hand-in whose reply was lost, until the database has said it arrived', async () => {
    const { db, tab } = await open()
    tab.sitting.choose('q1', 0)
    const handed = tab.sitting.handIn()
    db.lose(T0 + 5 * SECOND) // the database has the hand-in; the phone hears nothing
    expect(await handed).toEqual({ ok: false, reason: 'unsure' })
    expect(tab.view).toMatchObject({ status: 'sitting', handInNote: 'checking', locked: true, handingIn: false })
    tab.sitting.choose('q1', 3)
    tab.sitting.choose('q2', 1)
    tab.sitting.flag('q3')
    tab.sitting.clear('q1')
    expect(tab.view.answers).toEqual({ q1: { c: 0, f: false } })
    await vi.advanceTimersByTimeAsync(2 * SECOND)
    expect(db.calls.at(-1).final).toBe(false)
    db.answer(T0 + 8 * SECOND)
    await settle()
    // nothing was changed after the hand-in, so nothing was dropped
    expect(tab.view).toMatchObject({ status: 'over', why: 'handed_in', unsent: 0 })
    expect(db.rows).toEqual({ q1: { c: 0, f: false } })
    tab.sitting.stop()
  })

  it('takes answers again when the database says that hand-in never arrived', async () => {
    const { db, tab } = await open()
    tab.sitting.choose('q1', 0)
    const handed = tab.sitting.handIn()
    db.drop()
    expect(await handed).toEqual({ ok: false, reason: 'unsure' })
    expect(tab.view.locked).toBe(true)
    await vi.advanceTimersByTimeAsync(2 * SECOND)
    db.answer(T0 + 8 * SECOND)
    await settle()
    expect(tab.view).toMatchObject({ status: 'sitting', handInNote: 'not_yet', locked: false })
    tab.sitting.choose('q2', 1)
    expect(tab.view.answers.q2).toEqual({ c: 1, f: false })
    // and the taker hands in again
    const again = tab.sitting.handIn()
    expect(tab.view.handInNote).toBe('')
    expect(db.calls.at(-1)).toMatchObject({ batch: [item('q2', 1)], final: true })
    db.answer(T0 + 20 * SECOND)
    expect(await again).toEqual({ ok: true })
    tab.sitting.stop()
  })
})

describe('after the time ran out', () => {
  it('asks once a minute for half an hour, then only when the taker comes back', async () => {
    const { db, tab, pass, jumpTo } = await open({ deadline: T0 + 10 * MINUTE })
    jumpTo(db.deadline - SECOND)
    await pass(SECOND)
    db.answer(db.deadline + SECOND)
    await settle()
    expect(tab.view.status).toBe('over')
    const asked = db.calls.length
    for (let minute = 1; minute <= 45; minute += 1) {
      await pass(MINUTE)
      while (db.pending.length > 0) {
        db.answer(db.deadline + minute * MINUTE)
        await settle()
      }
    }
    expect(db.calls.length - asked).toBe(30)
    expect(tab.view.status).toBe('over')
    tab.sitting.pageShown()
    expect(db.calls.length - asked).toBe(31)
    tab.sitting.stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('brings the paper back, and sends what the clock beat, when the officers make the exam longer', async () => {
    const { db, store, tab, pass, jumpTo } = await open({ deadline: T0 + 10 * MINUTE })
    jumpTo(db.deadline - 2 * SECOND)
    tab.sitting.retry()
    tab.sitting.choose('q1', 2)
    db.answer(db.deadline + 31 * SECOND)
    await settle()
    db.answer(db.deadline + 32 * SECOND)
    await settle()
    expect(tab.view).toMatchObject({ status: 'over', why: 'time', unsent: 1 })

    db.deadline += 15 * MINUTE
    await pass(MINUTE)
    expect(db.calls.at(-1)).toMatchObject({ batch: [], final: false })
    db.answer(T0 + 12 * MINUTE)
    await settle()
    // running again: the paper is fetched afresh
    expect(tab.view.status).toBe('loading')
    expect(db.pending.map((call) => call.kind)).toEqual(['paper'])
    db.answer(T0 + 12 * MINUTE)
    await settle()
    expect(tab.view).toMatchObject({ status: 'sitting', answers: { q1: { c: 2, f: false } } })
    expect(db.calls.at(-1).batch).toEqual([item('q1', 2)])
    db.answer(T0 + 12 * MINUTE)
    await settle()
    expect(tab.view.save).toEqual({ kind: 'saved', count: 0 })
    expect(db.rows.q1).toEqual({ c: 2, f: false })
    expect(store.papers.has('a1')).toBe(true)
    tab.sitting.stop()
  })

  it('does not ask again after a hand-in', async () => {
    const { db, tab, pass } = await open()
    const handed = tab.sitting.handIn()
    db.answer(T0 + SECOND)
    await handed
    const asked = db.calls.length
    await pass(5 * MINUTE)
    tab.sitting.pageShown()
    tab.sitting.backOnline()
    expect(db.calls).toHaveLength(asked)
    tab.sitting.stop()
  })
})

describe('the page going away', () => {
  it('sends what waits in a request that outlives the page, once', async () => {
    const { db, tab, pass } = await open()
    tab.sitting.choose('q1', 2)
    tab.sitting.pageHidden() // 100 ms after the tap, the tab is closed
    expect(db.last).toEqual([[item('q1', 2)]])
    // the ordinary save left as well, for a page that lives on
    expect(db.calls.at(-1).batch).toEqual([item('q1', 2)])
    tab.sitting.pageLeaving()
    expect(db.last).toHaveLength(1)
    db.answer(T0 + SECOND)
    await settle()
    // nothing waits: nothing more to send on the way out
    await pass(10 * SECOND)
    tab.sitting.pageHidden()
    expect(db.last).toHaveLength(1)
    tab.sitting.stop()
  })

  it('sends nothing that way from a phone that says it has no connection', async () => {
    let connected = true
    const { db, tab } = await open({ online: () => connected })
    connected = false
    tab.sitting.choose('q1', 2)
    tab.sitting.pageHidden()
    expect(db.last).toHaveLength(0)
    tab.sitting.stop()
  })
})

describe('two tabs of one browser', () => {
  it('lets only one hold the exam, and hands it over when the taker says so', async () => {
    const clock = { wall: T0, mono: 1000 }
    const db = makeDb({ deadline: T0 + 60 * MINUTE })
    const store = makeStore()
    const locks = makeLocks()
    const a = makeTab({ db, store, clock, locks })
    a.sitting.start()
    await settle()
    db.answer(T0)
    await settle()
    a.sitting.choose('q1', 0) // waiting, and on the phone

    const b = makeTab({ db, store, clock, locks })
    b.sitting.start()
    await settle()
    // the second tab shows nothing, asks nothing and writes nothing
    expect(b.view).toMatchObject({ status: 'elsewhere', questions: [], answers: {} })
    b.sitting.choose('q2', 1)
    expect(db.pending).toHaveLength(0)
    expect(store.kept.get('a1')).toMatchObject({ answers: { q1: { c: 0, f: false } }, waiting: ['q1'] })

    b.sitting.takeOver()
    await settle()
    // the first tab is told, and stops: its timers, its taps, its writes
    expect(a.view).toMatchObject({ status: 'elsewhere', questions: [], answers: {} })
    a.sitting.choose('q1', 3)
    await vi.advanceTimersByTimeAsync(5 * SECOND)
    expect(db.calls).toHaveLength(0)
    expect(store.kept.get('a1').answers.q1).toEqual({ c: 0, f: false })
    // the second has the paper from the phone, with what the first had waiting
    expect(b.view).toMatchObject({ status: 'sitting', answers: { q1: { c: 0, f: false } }, save: { kind: 'saving', count: 1 } })
    expect(db.pending.map((call) => call.kind)).toEqual(['paper'])
    db.answer(T0 + 6 * SECOND)
    await settle()
    expect(db.calls.at(-1).batch).toEqual([item('q1', 0)])
    db.answer(T0 + 7 * SECOND)
    await settle()
    expect(db.rows).toEqual({ q1: { c: 0, f: false } })

    // back on the first tab: still elsewhere while the second lives
    a.sitting.pageShown()
    await settle()
    expect(a.view.status).toBe('elsewhere')
    // the second is closed: the first takes the exam up again when it is looked at
    b.sitting.stop()
    a.sitting.pageShown()
    await settle()
    expect(a.view).toMatchObject({ status: 'sitting', answers: { q1: { c: 0, f: false } } })
    a.sitting.stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ignores the answer to a call that was in flight when the exam was taken over', async () => {
    const clock = { wall: T0, mono: 1000 }
    const db = makeDb({ deadline: T0 + 60 * MINUTE })
    const store = makeStore()
    const locks = makeLocks()
    const a = makeTab({ db, store, clock, locks })
    a.sitting.start()
    await settle()
    db.answer(T0)
    await settle()
    a.sitting.choose('q1', 0)
    await vi.advanceTimersByTimeAsync(400) // A's save is in flight

    const b = makeTab({ db, store, clock, locks })
    b.sitting.start()
    await settle()
    b.sitting.takeOver()
    await settle()
    b.sitting.choose('q1', 2) // changed in the tab that now holds the exam
    const written = copy(store.kept.get('a1'))
    db.answer(T0 + SECOND) // the answer to A's save arrives
    await settle()
    // A settles nothing and writes nothing over B's
    expect(a.view.status).toBe('elsewhere')
    expect(store.kept.get('a1')).toEqual(written)
    expect(b.view.answers.q1).toEqual({ c: 2, f: false })
    a.sitting.stop()
    b.sitting.stop()
  })
})
