import { useCallback, useEffect, useRef, useState } from 'react'
import { examLeft } from './examApi.js'

// Two counts for a running paper, kept on the phone and sent to the database
// (rpc/exam_left), where the officers read them beside the paper:
//   left     how many times the taker left the page (ExamGuard says when)
//   printed  how many times they pressed the Print Screen key
//
// The phone sends each whole count, never "one more", so a request sent twice
// or sent again after a dead connection counts once. Two numbers are kept for
// each count, under ausss-exam-left:<attempt id>:
//   sure  what the database is known to hold
//   owed  the times since, not yet received by it
// Before the first send of a page load the database is asked what it holds,
// so a phone whose storage was cleared carries on from the real numbers and
// not from nought. What could not be sent waits for the next time something
// is counted, or for the connection to come back; nothing is tried in a loop.
//
//   count      the times the taker left, sent or not
//   prints     the presses of Print Screen, sent or not
//   open       which warning is up, 'left' or 'printed', from the moment it is
//              counted until it is dismissed; null for none
//   left()     the taker has just come back from leaving the page
//   printed()  the taker has just pressed Print Screen
//   dismiss()

const LEFT_KEY = 'ausss-exam-left:'
const KINDS = ['left', 'printed']

const whole = (value) => (Number.isInteger(value) && value > 0 ? Math.min(value, 999) : 0)
const pair = (kept) => ({ sure: whole(kept?.sure), owed: whole(kept?.owed) })
const total = (b, kind) => b[kind].sure + b[kind].owed

function read(attemptId) {
  try {
    const kept = JSON.parse(localStorage.getItem(LEFT_KEY + attemptId) || 'null')
    return { left: pair(kept?.left), printed: pair(kept?.printed) }
  } catch {
    return { left: pair(null), printed: pair(null) }
  }
}

function keep(attemptId, { left, printed }) {
  try {
    localStorage.setItem(LEFT_KEY + attemptId, JSON.stringify({ left, printed }))
  } catch {
    // No storage: the counts live as long as the page does.
  }
}

export function useLeaves({ word, attemptId }) {
  const book = useRef(null)
  if (book.current === null || book.current.id !== attemptId) {
    book.current = { id: attemptId, ...read(attemptId), asked: false, busy: false }
  }
  const [counts, setCounts] = useState(() => ({ left: total(book.current, 'left'), printed: total(book.current, 'printed') }))
  const [open, setOpen] = useState(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const show = () => setCounts({ left: total(book.current, 'left'), printed: total(book.current, 'printed') })

  const send = useCallback(async () => {
    const b = book.current
    if (!b.id || b.busy || (b.asked && b.left.owed + b.printed.owed === 0)) return
    b.busy = true
    try {
      if (!b.asked) {
        const held = await examLeft(word, b.left.sure, b.printed.sure)
        for (const kind of KINDS) b[kind].sure = Math.max(b[kind].sure, whole(held?.[kind]))
        b.asked = true
      }
      while (b.left.owed + b.printed.owed > 0) {
        const sending = { left: b.left.owed, printed: b.printed.owed }
        const held = await examLeft(word, b.left.sure + sending.left, b.printed.sure + sending.printed)
        for (const kind of KINDS) {
          b[kind].sure = Math.max(b[kind].sure + sending[kind], whole(held?.[kind]))
          b[kind].owed -= sending[kind]
        }
      }
    } catch {
      // Offline, or the paper is over: what is owed stays owed.
    } finally {
      b.busy = false
      keep(b.id, b)
      if (alive.current) show()
    }
  }, [word])

  useEffect(() => {
    window.addEventListener('online', send)
    return () => window.removeEventListener('online', send)
  }, [send])

  const note = useCallback(
    (kind) => {
      const b = book.current
      if (!b.id) return
      b[kind].owed += 1
      keep(b.id, b)
      show()
      setOpen(kind)
      send()
    },
    [send],
  )
  const left = useCallback(() => note('left'), [note])
  const printed = useCallback(() => note('printed'), [note])
  const dismiss = useCallback(() => setOpen(null), [])

  return { count: counts.left, prints: counts.printed, open, left, printed, dismiss }
}
