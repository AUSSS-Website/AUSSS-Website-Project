import { describe, expect, it } from 'vitest'
import {
  BATCH_MAX,
  HURRY_EVERY_MS,
  HURRY_TIMEOUT_MS,
  LATE_SAVE_MS,
  PAGE_SIZE,
  answerOf,
  answeredCount,
  canChoose,
  clampPage,
  clearAnswer,
  clocksDisagree,
  elapsedSince,
  emptyHeld,
  examWord,
  failureKind,
  flaggedNumbers,
  formatClock,
  heldClock,
  holdClock,
  lateSaveOpen,
  mergeAnswers,
  overtime,
  pageCount,
  pageOf,
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

// A paper of n questions, q1 to qn, four options each.
const paper = (n, options = 4) =>
  Array.from({ length: n }, (_, i) => ({ id: `q${i + 1}`, body: `Question ${i + 1}`, options: ['a', 'b', 'c', 'd', 'e', 'f'].slice(0, options) }))

const sitting = { state: 'sitting', submitted: false }

describe('the word in the address', () => {
  it('is read as the database reads it', () => {
    expect(examWord('scope-2026')).toBe('scope-2026')
    expect(examWord('  Scope-2026 ')).toBe('scope-2026')
    expect(examWord('a1b2c3d4e5f6')).toBe('a1b2c3d4e5f6')
  })

  it('is nothing when it could not be an exam', () => {
    for (const bad of ['', 'callback', 'Callback', 'two words', 'a/b', '../portal', 'a--b', '-a', 'a-', 'a.b', 'a%2fb', 'x'.repeat(61), null, undefined, 7]) {
      expect(examWord(bad)).toBe(null)
    }
  })
})

describe('pages of ten', () => {
  it('counts the pages', () => {
    expect(PAGE_SIZE).toBe(10)
    expect([0, 7, 10, 11, 100, 101].map(pageCount)).toEqual([1, 1, 1, 2, 10, 11])
  })

  it('gives a page its questions, numbered in the taker’s order', () => {
    const page = pageQuestions(paper(25), 3)
    expect(page.map((q) => q.n)).toEqual([21, 22, 23, 24, 25])
    expect(page[0]).toEqual({ id: 'q21', body: 'Question 21', options: ['a', 'b', 'c', 'd'], n: 21 })
    expect(pageQuestions(paper(25), 1).map((q) => q.id)).toEqual(['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9', 'q10'])
  })

  it('keeps a page number inside the paper', () => {
    expect([0, -3, 1, 3, 4, 99, 'x', 2.9].map((p) => clampPage(p, 25))).toEqual([1, 1, 1, 3, 3, 3, 1, 2])
    expect(pageQuestions(paper(25), 99).map((q) => q.n)).toEqual([21, 22, 23, 24, 25])
  })

  it('finds the page of a question number', () => {
    expect([1, 10, 11, 20, 21, 100].map(pageOf)).toEqual([1, 1, 2, 2, 3, 10])
  })

  it('sums each page up for its button', () => {
    let held = emptyHeld()
    for (let i = 1; i <= 10; i += 1) held = setAnswer(held, `q${i}`, 0)
    held = setAnswer(held, 'q11', 2)
    held = toggleFlag(held, 'q11')
    held = toggleFlag(held, 'q25')
    expect(pageSummaries(paper(25), held.answers)).toEqual([
      { page: 1, from: 1, to: 10, unanswered: 0, flagged: 0 },
      { page: 2, from: 11, to: 20, unanswered: 9, flagged: 1 },
      { page: 3, from: 21, to: 25, unanswered: 5, flagged: 1 },
    ])
  })
})

describe('answering', () => {
  it('holds the choice and marks it as waiting to be sent', () => {
    const held = setAnswer(emptyHeld(), 'q1', 2)
    expect(held).toEqual({ answers: { q1: { c: 2, f: false } }, waiting: ['q1'] })
    expect(answerOf(held.answers, 'q2')).toEqual({ c: null, f: false })
  })

  it('does nothing when the same option is chosen again', () => {
    const held = setAnswer(emptyHeld(), 'q1', 2)
    expect(setAnswer(held, 'q1', 2)).toBe(held)
    const saved = settleBatch(held, takeBatch(held), sitting)
    expect(setAnswer(saved, 'q1', 2)).toBe(saved)
    expect(saved.waiting).toEqual([])
  })

  it('clears an answer, keeps its flag, and has the clearing sent', () => {
    let held = toggleFlag(setAnswer(emptyHeld(), 'q1', 3), 'q1')
    held = settleBatch(held, takeBatch(held), sitting)
    held = clearAnswer(held, 'q1')
    expect(held).toEqual({ answers: { q1: { c: null, f: true } }, waiting: ['q1'] })
    expect(takeBatch(held)).toEqual([{ q: 'q1', c: null, f: true }])
  })

  it('has nothing to clear on a question without an answer', () => {
    const held = emptyHeld()
    expect(clearAnswer(held, 'q1')).toBe(held)
  })

  it('flags a question that has no answer, and sends the flag and its removal', () => {
    let held = toggleFlag(emptyHeld(), 'q4')
    expect(takeBatch(held)).toEqual([{ q: 'q4', c: null, f: true }])
    held = settleBatch(held, takeBatch(held), sitting)
    held = toggleFlag(held, 'q4')
    expect(takeBatch(held)).toEqual([{ q: 'q4', c: null, f: false }])
  })

  it('keeps the answer when the flag changes and the flag when the answer does', () => {
    let held = toggleFlag(setAnswer(emptyHeld(), 'q1', 1), 'q1')
    expect(held.answers.q1).toEqual({ c: 1, f: true })
    held = setAnswer(held, 'q1', 0)
    expect(held.answers.q1).toEqual({ c: 0, f: true })
  })

  it('takes only a position as a choice', () => {
    const held = emptyHeld()
    for (const bad of [-1, 1.5, '2', null, undefined, NaN]) expect(setAnswer(held, 'q1', bad)).toBe(held)
  })

  it('knows which choices a question can take', () => {
    const questions = paper(3, 2)
    expect(canChoose(questions, 'q1', 0)).toBe(true)
    expect(canChoose(questions, 'q1', 1)).toBe(true)
    expect(canChoose(questions, 'q1', null)).toBe(true)
    expect(canChoose(questions, 'q1', 2)).toBe(false)
    expect(canChoose(questions, 'q1', -1)).toBe(false)
    expect(canChoose(questions, 'q9', 0)).toBe(false)
    expect(canChoose(questions, 'constructor', null)).toBe(false)
  })

  it('never changes the state it was given', () => {
    const before = setAnswer(emptyHeld(), 'q1', 1)
    const copy = JSON.parse(JSON.stringify(before))
    toggleFlag(clearAnswer(setAnswer(before, 'q2', 0), 'q1'), 'q3')
    settleBatch(before, takeBatch(before), sitting)
    expect(before).toEqual(copy)
  })
})

describe('sending', () => {
  it('sends the latest answer of each waiting question, once', () => {
    let held = setAnswer(emptyHeld(), 'q1', 0)
    held = setAnswer(held, 'q2', 1)
    held = setAnswer(held, 'q1', 3)
    held = toggleFlag(held, 'q2')
    expect(takeBatch(held)).toEqual([
      { q: 'q1', c: 3, f: false },
      { q: 'q2', c: 1, f: true },
    ])
  })

  it('has nothing to send when nothing waits', () => {
    expect(takeBatch(emptyHeld())).toEqual([])
    expect(settleBatch(emptyHeld(), [], sitting)).toEqual(emptyHeld())
  })

  it('stops waiting for what the database confirmed', () => {
    const held = setAnswer(setAnswer(emptyHeld(), 'q1', 0), 'q2', 1)
    const after = settleBatch(held, takeBatch(held), { ...sitting, saved: 2 })
    expect(after.waiting).toEqual([])
    expect(after.answers).toBe(held.answers)
  })

  it('keeps an answer waiting when it changed again while its save was in flight', () => {
    let held = setAnswer(setAnswer(emptyHeld(), 'q1', 0), 'q2', 1)
    const inFlight = takeBatch(held)
    held = setAnswer(held, 'q1', 2)
    held = settleBatch(held, inFlight, sitting)
    expect(held.waiting).toEqual(['q1'])
    // the newer value is the one that goes next
    expect(takeBatch(held)).toEqual([{ q: 'q1', c: 2, f: false }])
    expect(settleBatch(held, takeBatch(held), sitting).waiting).toEqual([])
  })

  it('keeps it waiting when only the flag changed in flight, or the answer was cleared', () => {
    let held = setAnswer(setAnswer(emptyHeld(), 'q1', 0), 'q2', 1)
    const inFlight = takeBatch(held)
    held = toggleFlag(held, 'q1')
    held = clearAnswer(held, 'q2')
    held = settleBatch(held, inFlight, sitting)
    expect(takeBatch(held)).toEqual([
      { q: 'q1', c: 0, f: true },
      { q: 'q2', c: null, f: false },
    ])
  })

  it('counts an answer changed and changed back in flight as saved: the database holds it', () => {
    let held = setAnswer(emptyHeld(), 'q1', 0)
    const inFlight = takeBatch(held)
    held = setAnswer(setAnswer(held, 'q1', 3), 'q1', 0)
    expect(settleBatch(held, inFlight, sitting).waiting).toEqual([])
  })

  it('loses nothing when a save fails, whatever order the tries go in', () => {
    let held = setAnswer(setAnswer(emptyHeld(), 'q1', 0), 'q2', 1)
    const first = takeBatch(held) // this save fails: nothing is settled
    expect(held.waiting).toEqual(['q1', 'q2'])
    held = setAnswer(held, 'q3', 2)
    held = setAnswer(held, 'q1', 1)
    const second = takeBatch(held)
    expect(second).toEqual([
      { q: 'q1', c: 1, f: false },
      { q: 'q2', c: 1, f: false },
      { q: 'q3', c: 2, f: false },
    ])
    // even if the failed save had reached the database after all, the second one puts every
    // question at its latest value, and a late word about the first settles nothing wrongly
    held = settleBatch(held, second, sitting)
    expect(held.waiting).toEqual([])
    expect(settleBatch(held, first, sitting)).toBe(held)
  })

  it('sends a long backlog in batches the database accepts', () => {
    let held = emptyHeld()
    for (let i = 1; i <= BATCH_MAX + 50; i += 1) held = setAnswer(held, `q${i}`, 0)
    const first = takeBatch(held)
    expect(first).toHaveLength(BATCH_MAX)
    expect(BATCH_MAX).toBeLessThanOrEqual(300)
    held = settleBatch(held, first, sitting)
    const rest = takeBatch(held)
    expect(rest).toHaveLength(50)
    expect(rest[0].q).toBe(`q${BATCH_MAX + 1}`)
    expect(settleBatch(held, rest, sitting).waiting).toEqual([])
  })

  it('confirms nothing when the exam was over and the database saved nothing', () => {
    const held = setAnswer(setAnswer(emptyHeld(), 'q1', 0), 'q2', 1)
    expect(settleBatch(held, takeBatch(held), { state: 'over', submitted: false, saved: 0 })).toBe(held)
    expect(settleBatch(held, takeBatch(held), { state: 'over', submitted: true, saved: 0 })).toBe(held)
    expect(settleBatch(held, takeBatch(held), { state: 'over', submitted: false })).toBe(held)
  })

  it('confirms a hand-in, and a save that landed inside the thirty seconds after the deadline', () => {
    const held = setAnswer(setAnswer(emptyHeld(), 'q1', 0), 'q2', 1)
    expect(settleBatch(held, takeBatch(held), { state: 'over', submitted: true, saved: 2 }).waiting).toEqual([])
    expect(settleBatch(held, takeBatch(held), { state: 'over', submitted: false, saved: 2 }).waiting).toEqual([])
  })

  it('sends a question once more after a save nobody knows the outcome of', () => {
    // q1 = a left the phone and no answer came back; q1 = c was saved after it. If the first lands
    // late, the database is back at a: sending the latest again puts it right.
    let held = setAnswer(setAnswer(emptyHeld(), 'q1', 2), 'q2', 1)
    held = settleBatch(held, takeBatch(held), sitting)
    expect(held.waiting).toEqual([])
    const again = waitAgain(held, new Set(['q1']))
    expect(takeBatch(again)).toEqual([{ q: 'q1', c: 2, f: false }])
    expect(again.answers).toBe(held.answers)
  })

  it('does that only for a question whose answer the phone holds, and never twice', () => {
    const held = setAnswer(emptyHeld(), 'q1', 2) // q1 already waits
    // a blank for q9 would wipe whatever the database has
    expect(waitAgain(held, ['q1', 'q9', 'constructor'])).toBe(held)
    const saved = settleBatch(held, takeBatch(held), sitting)
    expect(waitAgain(saved, ['q1', 'q1']).waiting).toEqual(['q1'])
    expect(waitAgain(saved, [])).toBe(saved)
  })
})

describe('after a refresh', () => {
  const questions = paper(5)

  it('follows the database, except for answers still waiting to be sent', () => {
    const phone = {
      answers: { q1: { c: 0, f: false }, q2: { c: 3, f: true }, q3: { c: 1, f: false } },
      waiting: ['q2'],
    }
    const database = [
      { q: 'q1', c: 2, f: false }, // changed elsewhere, or the phone's copy is old: the database wins
      { q: 'q2', c: 0, f: false }, // the phone's newer answer was never sent: the phone wins
      { q: 'q4', c: 1, f: true }, // the phone never knew this one
    ]
    expect(mergeAnswers(phone, database, questions)).toEqual({
      answers: { q1: { c: 2, f: false }, q2: { c: 3, f: true }, q4: { c: 1, f: true } },
      waiting: ['q2'],
    })
  })

  it('drops an answer the phone holds that is not waiting and the database does not have', () => {
    const phone = { answers: { q3: { c: 1, f: false } }, waiting: [] }
    expect(mergeAnswers(phone, [], questions)).toEqual(emptyHeld())
  })

  it('stops waiting for an answer the database already has', () => {
    const phone = { answers: { q1: { c: 2, f: true }, q2: { c: null, f: false } }, waiting: ['q1', 'q2'] }
    const merged = mergeAnswers(phone, [{ q: 'q1', c: 2, f: true }], questions)
    expect(merged.waiting).toEqual([])
    expect(merged.answers.q1).toEqual({ c: 2, f: true })
  })

  it('lets a waiting cleared answer and a waiting flag win over the database', () => {
    const phone = { answers: { q1: { c: null, f: false }, q2: { c: null, f: true } }, waiting: ['q1', 'q2'] }
    const merged = mergeAnswers(phone, [{ q: 'q1', c: 3, f: false }], questions)
    expect(takeBatch(merged)).toEqual([
      { q: 'q1', c: null, f: false },
      { q: 'q2', c: null, f: true },
    ])
  })

  it('takes the database as it is when the phone holds nothing', () => {
    for (const nothing of [null, undefined, {}, 'x', [], { answers: null, waiting: null }]) {
      expect(mergeAnswers(nothing, [{ q: 'q5', c: 0, f: false }], questions)).toEqual({
        answers: { q5: { c: 0, f: false } },
        waiting: [],
      })
    }
    expect(mergeAnswers(emptyHeld(), null, questions)).toEqual(emptyHeld())
  })

  it('reads what the phone kept without trusting it', () => {
    const kept = {
      answers: {
        q1: { c: 1, f: true },
        q2: { c: 9, f: false }, // the question has no such option
        q3: { c: '1', f: false }, // not a position
        q4: { f: 'yes' }, // no choice, and a flag that is not one
        q5: 'b',
        q77: { c: 0, f: false }, // not on this paper
      },
      waiting: ['q1', 'q1', 'q2', 'q5', 'q77', 'q3', 7, null],
    }
    expect(tidyHeld(kept, questions)).toEqual({
      answers: { q1: { c: 1, f: true }, q4: { c: null, f: false } },
      waiting: ['q1'],
    })
  })

  it('never sends a blank for a question marked waiting with no answer held', () => {
    // sending { c: null } for it would wipe the answer the database has
    const kept = { answers: {}, waiting: ['q1'] }
    expect(tidyHeld(kept, questions).waiting).toEqual([])
    const merged = mergeAnswers(kept, [{ q: 'q1', c: 2, f: false }], questions)
    expect(merged).toEqual({ answers: { q1: { c: 2, f: false } }, waiting: [] })
  })

  it('ignores rows from the database that are not this paper’s', () => {
    const merged = mergeAnswers(emptyHeld(), [{ q: 'q99', c: 0, f: false }, null, { q: 'q1', c: 8, f: false }, { q: 'q2', c: null, f: true }], questions)
    expect(merged).toEqual({ answers: { q2: { c: null, f: true } }, waiting: [] })
  })
})

describe('the review', () => {
  const questions = paper(12)
  let held = emptyHeld()
  for (const n of [1, 2, 3, 5, 8, 12]) held = setAnswer(held, `q${n}`, 1)
  held = toggleFlag(held, 'q2')
  held = toggleFlag(held, 'q4')
  held = clearAnswer(held, 'q8')

  it('counts what is answered', () => {
    expect(answeredCount(questions, held.answers)).toBe(5)
    expect(answeredCount(questions, {})).toBe(0)
  })

  it('lists the unanswered question numbers, a cleared and a flagged-only one among them', () => {
    expect(unansweredNumbers(questions, held.answers)).toEqual([4, 6, 7, 8, 9, 10, 11])
  })

  it('lists the flagged question numbers, answered or not', () => {
    expect(flaggedNumbers(questions, held.answers)).toEqual([2, 4])
  })
})

describe('the paper', () => {
  const reply = {
    state: 'sitting',
    exam: { title: 'Exchange exam 2026', minutes: 120 },
    attempt: { id: 'a1', started_at: '2026-11-14T08:00:00+00:00', deadline_at: '2026-11-14T10:00:00+00:00' },
    now: '2026-11-14T08:00:01+00:00',
    questions: paper(3),
    answers: [{ q: 'q1', c: 0, f: false }],
  }

  it('keeps what the pages show and nothing else', () => {
    expect(tidyPaper(reply)).toEqual({
      exam: { title: 'Exchange exam 2026', minutes: 120 },
      attempt: { id: 'a1', started_at: '2026-11-14T08:00:00+00:00', deadline_at: '2026-11-14T10:00:00+00:00' },
      questions: paper(3),
    })
  })

  it('survives the trip through the phone’s storage', () => {
    const kept = JSON.parse(JSON.stringify({ word: 'scope-2026', uid: 'u1', ...tidyPaper(reply) }))
    expect(tidyPaper(kept)).toEqual(tidyPaper(reply))
  })

  it('refuses anything that is not a whole paper', () => {
    expect(tidyPaper(null)).toBe(null)
    expect(tidyPaper({ state: 'over', submitted: true })).toBe(null)
    expect(tidyPaper({ ...reply, attempt: { id: '' } })).toBe(null)
    expect(tidyPaper({ ...reply, questions: 'none' })).toBe(null)
    expect(tidyPaper({ ...reply, questions: [...paper(2), { id: 'q1', body: 'again', options: ['a', 'b'] }] })).toBe(null)
    expect(tidyPaper({ ...reply, questions: [{ id: 'q1', body: 'no options', options: [] }] })).toBe(null)
    expect(tidyPaper({ ...reply, questions: [null] })).toBe(null)
  })
})

describe('the clock', () => {
  // The exam ends at 10:00 by the database. The phone's own clock is three hours out.
  const deadline = '2026-11-14T10:00:00+00:00'
  const wall = Date.parse('2026-11-14T12:30:00Z')
  const at = { wall, mono: 5000 }
  const later = (ms, monoMs = ms) => ({ wall: wall + ms, mono: 5000 + monoMs })
  const clock = syncClock(deadline, '2026-11-14T09:30:00+00:00', at)

  it('is the database’s, whatever the phone’s clock says', () => {
    expect(remaining(clock, at)).toBe(30 * 60 * 1000)
  })

  it('counts down on the phone’s stopwatch between answers from the database', () => {
    expect(remaining(clock, later(1000))).toBe(30 * 60 * 1000 - 1000)
    expect(remaining(clock, later(29 * 60 * 1000))).toBe(60 * 1000)
  })

  it('stops at zero', () => {
    expect(remaining(clock, later(30 * 60 * 1000))).toBe(0)
    expect(remaining(clock, later(45 * 60 * 1000))).toBe(0)
  })

  it('is not known before the database has answered', () => {
    expect(remaining(null, at)).toBe(null)
    expect(syncClock(null, '2026-11-14T09:30:00+00:00', at)).toBe(null)
    expect(syncClock(deadline, undefined, at)).toBe(null)
    expect(syncClock('soon', 'now', at)).toBe(null)
  })

  it('keeps counting through a sleep, when the phone’s stopwatch stood still', () => {
    const woke = later(5 * 60 * 1000, 2000)
    expect(remaining(clock, woke)).toBe(25 * 60 * 1000)
    expect(clocksDisagree(clock, woke)).toBe(true)
  })

  it('does not give time back when the phone’s clock is set back', () => {
    const setBack = { wall: wall - 60 * 60 * 1000, mono: 5000 + 10 * 60 * 1000 }
    expect(remaining(clock, setBack)).toBe(20 * 60 * 1000)
    expect(clocksDisagree(clock, setBack)).toBe(true)
  })

  it('asks the database when the phone’s clock jumps ahead, and is right again once it answers', () => {
    const jumped = later(60 * 60 * 1000, 60 * 1000)
    // until the database answers the phone cannot tell a jump from a sleep, and shows no time left
    expect(remaining(clock, jumped)).toBe(0)
    expect(clocksDisagree(clock, jumped)).toBe(true)
    const again = syncClock(deadline, '2026-11-14T09:31:00+00:00', jumped)
    expect(remaining(again, jumped)).toBe(29 * 60 * 1000)
    expect(clocksDisagree(again, jumped)).toBe(false)
  })

  it('lets the two clocks differ a little', () => {
    expect(clocksDisagree(clock, later(60000, 59000))).toBe(false)
    expect(clocksDisagree(clock, later(60000, 57000))).toBe(true)
    expect(clocksDisagree(null, at)).toBe(false)
  })

  it('says the time is up when both clocks have counted it down', () => {
    expect(timeUp(clock, at)).toBe('no')
    expect(timeUp(clock, later(30 * 60 * 1000 - 1))).toBe('no')
    expect(timeUp(clock, later(30 * 60 * 1000))).toBe('yes')
    expect(timeUp(clock, later(45 * 60 * 1000))).toBe('yes')
    expect(timeUp(null, at)).toBe('no')
  })

  it('is not sure the time is up when only the wall clock says so', () => {
    // set an hour ahead, or asleep for an hour: the phone cannot tell which. The paper stays open
    // and the database is asked.
    expect(timeUp(clock, later(60 * 60 * 1000, 60 * 1000))).toBe('unsure')
    expect(remaining(clock, later(60 * 60 * 1000, 60 * 1000))).toBe(0)
    // the stopwatch within a moment of the end agrees with the wall clock
    expect(timeUp(clock, later(30 * 60 * 1000, 30 * 60 * 1000 - 1500))).toBe('yes')
    expect(timeUp(clock, later(30 * 60 * 1000, 30 * 60 * 1000 - 2500))).toBe('unsure')
    // the stopwatch alone past the end (the wall clock was set back) is the end
    expect(timeUp(clock, { wall: wall - 60 * 60 * 1000, mono: 5000 + 30 * 60 * 1000 })).toBe('yes')
  })

  it('takes the wall clock’s word where the phone has no stopwatch', () => {
    const bare = syncClock(deadline, '2026-11-14T09:30:00+00:00', { wall })
    expect(timeUp(bare, { wall: wall + 30 * 60 * 1000 })).toBe('yes')
    expect(timeUp(bare, { wall: wall + 1000 })).toBe('no')
  })

  it('knows the thirty seconds after the deadline, in which a late save still lands', () => {
    expect(LATE_SAVE_MS).toBe(30000)
    expect(overtime(null, at)).toBe(null)
    expect(overtime(clock, later(10 * 60 * 1000))).toBe(0)
    expect(overtime(clock, later(30 * 60 * 1000 + 4000))).toBe(4000)
    expect(lateSaveOpen(clock, later(30 * 60 * 1000 - 1))).toBe(false)
    expect(lateSaveOpen(clock, later(30 * 60 * 1000))).toBe(true)
    expect(lateSaveOpen(clock, later(30 * 60 * 1000 + 30000))).toBe(true)
    expect(lateSaveOpen(clock, later(30 * 60 * 1000 + 30001))).toBe(false)
    expect(lateSaveOpen(null, at)).toBe(false)
  })

  it('works on the wall clock alone where the phone has no stopwatch', () => {
    const bare = syncClock(deadline, '2026-11-14T09:30:00+00:00', { wall })
    expect(remaining(bare, { wall: wall + 1000 })).toBe(30 * 60 * 1000 - 1000)
    expect(clocksDisagree(bare, { wall: wall + 60000 })).toBe(false)
    expect(elapsedSince({ wall }, { wall: wall - 500 })).toBe(0)
  })

  it('follows a deadline the officers moved later while the exam runs', () => {
    const tenMinutesIn = later(10 * 60 * 1000)
    expect(remaining(clock, tenMinutesIn)).toBe(20 * 60 * 1000)
    const moved = syncClock('2026-11-14T10:15:00+00:00', '2026-11-14T09:40:00+00:00', tenMinutesIn)
    expect(remaining(moved, tenMinutesIn)).toBe(35 * 60 * 1000)
    // and comes back from zero the same way
    const atTheEnd = later(31 * 60 * 1000)
    expect(remaining(clock, atTheEnd)).toBe(0)
    expect(remaining(syncClock('2026-11-14T10:15:00+00:00', '2026-11-14T10:01:00+00:00', atTheEnd), atTheEnd)).toBe(14 * 60 * 1000)
  })

  it('places the database’s reading halfway through a slow answer', () => {
    const sent = later(0)
    const received = later(8000)
    const slow = syncClock(deadline, '2026-11-14T09:30:00+00:00', received, sent)
    expect(slow.at).toEqual({ wall: wall + 4000, mono: 9000 })
    expect(remaining(slow, received)).toBe(30 * 60 * 1000 - 4000)
  })

  it('carries over a reload the database did not answer', () => {
    const kept = JSON.parse(JSON.stringify(holdClock(clock)))
    expect(kept).toEqual({ deadline: Date.parse(deadline), now: Date.parse('2026-11-14T09:30:00Z'), wall })
    // twelve minutes later, in a new page: the stopwatch starts from nought
    const reloaded = { wall: wall + 12 * 60 * 1000, mono: 40 }
    const picked = heldClock(kept, reloaded)
    expect(remaining(picked, reloaded)).toBe(18 * 60 * 1000)
    expect(remaining(picked, { wall: reloaded.wall + 1000, mono: 1040 })).toBe(18 * 60 * 1000 - 1000)
    // a clock set back in between gives no time back
    expect(remaining(heldClock(kept, { wall: wall - 5000, mono: 40 }), { wall: wall - 5000, mono: 40 })).toBe(30 * 60 * 1000)
  })

  it('has no kept clock to pick up when storage holds none', () => {
    expect(holdClock(null)).toBe(null)
    for (const bad of [null, undefined, {}, { deadline: 'x', now: 1, wall: 1 }, { deadline: 1, now: 1 }]) {
      expect(heldClock(bad, at)).toBe(null)
    }
  })

  it('reads the database’s times in every form Postgres writes them', () => {
    const ms = Date.UTC(2026, 10, 14, 10, 0, 0, 123)
    expect(toMs('2026-11-14T10:00:00.123456+00:00')).toBe(ms)
    expect(toMs('2026-11-14 10:00:00.123456+00')).toBe(ms)
    expect(toMs('2026-11-14T12:00:00.123+02:00')).toBe(ms)
    expect(toMs('2026-11-14 12:00:00.123456+0200')).toBe(ms)
    expect(toMs('2026-11-14T10:00:00.123Z')).toBe(ms)
    expect(toMs('2026-11-14T07:00:00-03')).toBe(ms - 123)
    expect(toMs(ms)).toBe(ms)
    for (const bad of ['', 'soon', null, undefined, {}, NaN]) expect(Number.isNaN(toMs(bad))).toBe(true)
  })

  it('writes the time left as m:ss, and h:mm:ss from an hour up', () => {
    expect(formatClock(2 * 60 * 60 * 1000)).toBe('2:00:00')
    expect(formatClock(2 * 60 * 60 * 1000 - 1)).toBe('2:00:00')
    expect(formatClock(2 * 60 * 60 * 1000 - 1000)).toBe('1:59:59')
    expect(formatClock(60 * 60 * 1000)).toBe('1:00:00')
    expect(formatClock(60 * 60 * 1000 - 1000)).toBe('59:59')
    expect(formatClock(9 * 60 * 1000 + 5000)).toBe('9:05')
    expect(formatClock(1000)).toBe('0:01')
    expect(formatClock(1)).toBe('0:01')
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(-5000)).toBe('0:00')
  })

  it('writes nothing while the time left is not known', () => {
    for (const unknown of [null, undefined, NaN, 'x']) expect(formatClock(unknown)).toBe('')
  })
})

describe('when the database does not answer', () => {
  it('tries again after 2 s, 5 s, 10 s, then every 15 s', () => {
    expect([1, 2, 3, 4, 5, 50].map(retryDelay)).toEqual([2000, 5000, 10000, 15000, 15000, 15000])
    expect(retryDelay(0)).toBe(2000)
  })

  it('has a faster pace for the thirty seconds after the deadline', () => {
    // a try, its patience and the wait after it must fit into the thirty seconds more than twice
    expect(HURRY_EVERY_MS).toBeLessThanOrEqual(2000)
    expect(HURRY_TIMEOUT_MS).toBeLessThan(20000)
    expect(2 * (HURRY_TIMEOUT_MS + HURRY_EVERY_MS)).toBeLessThan(LATE_SAVE_MS)
  })

  it('tells a refusal from a lost session from a lost connection', () => {
    // the database's own sentences: asking again changes nothing
    expect(failureKind('22023', 400)).toBe('refused')
    expect(failureKind('23505', 409)).toBe('refused')
    // no session, or one the API would not take
    expect(failureKind('42501', 403)).toBe('signed_out')
    expect(failureKind('42501', 401)).toBe('signed_out')
    expect(failureKind('PGRST301', 401)).toBe('signed_out')
    expect(failureKind('PGRST303', 401)).toBe('signed_out')
    // everything else is worth another try
    expect(failureKind('', 0)).toBe('offline')
    expect(failureKind(undefined, 502)).toBe('offline')
    expect(failureKind('57014', 500)).toBe('offline')
    expect(failureKind('PGRST002', 503)).toBe('offline')
    expect(failureKind('40001', 409)).toBe('offline')
    // a fault nobody wrote a sentence for is not a refusal: the answers stay and are tried again
    expect(failureKind('P0001', 400)).toBe('offline')
    expect(failureKind('23502', 400)).toBe('offline')
  })

  it('puts the save state into one of three kinds for the header', () => {
    expect(saveStatus({ waiting: 0 })).toEqual({ kind: 'saved', count: 0 })
    expect(saveStatus({ waiting: 2 })).toEqual({ kind: 'saving', count: 2 })
    expect(saveStatus({ waiting: 2, sending: true })).toEqual({ kind: 'saving', count: 2 })
    // a hand-in on its way with nothing left to send
    expect(saveStatus({ waiting: 0, sending: true })).toEqual({ kind: 'saving', count: 0 })
    expect(saveStatus({ waiting: 3, failures: 1 })).toEqual({ kind: 'offline', count: 3 })
    expect(saveStatus({ waiting: 3, sending: true, failures: 4 })).toEqual({ kind: 'offline', count: 3 })
    expect(saveStatus({ waiting: 3, online: false })).toEqual({ kind: 'offline', count: 3 })
    // nothing is waiting, so nothing is at risk, connection or not
    expect(saveStatus({ waiting: 0, failures: 2, online: false })).toEqual({ kind: 'saved', count: 0 })
  })
})
