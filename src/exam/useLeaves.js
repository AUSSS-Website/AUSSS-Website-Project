import { useCallback, useEffect, useRef, useState } from 'react'
import { examLeft } from './examApi.js'

// How many times the taker left the page while their paper was running
// (ExamGuard says when), kept on the phone and sent to the database
// (rpc/exam_left), where the officers read it beside the paper.
//
// The phone sends its whole count, never "one more", so a request sent twice
// or sent again after a dead connection counts once. Two numbers are kept for
// each paper, under ausss-exam-left:<attempt id>:
//   sure  what the database is known to hold
//   owed  the times since, not yet received by it
// Before the first send of a page load the database is asked what it holds,
// so a phone whose storage was cleared carries on from the real number and
// not from nought. What could not be sent waits for the next time the taker
// leaves, or for the connection to come back; nothing is tried in a loop.
//
//   count    the times so far, sent or not
//   open     whether the warning is up: from each return until it is dismissed
//   left()   the taker has just come back from leaving the page
//   dismiss()

const LEFT_KEY = 'ausss-exam-left:'

const whole = (value) => (Number.isInteger(value) && value > 0 ? Math.min(value, 999) : 0)

function read(attemptId) {
  try {
    const kept = JSON.parse(localStorage.getItem(LEFT_KEY + attemptId) || 'null')
    return { sure: whole(kept?.sure), owed: whole(kept?.owed) }
  } catch {
    return { sure: 0, owed: 0 }
  }
}

function keep(attemptId, { sure, owed }) {
  try {
    localStorage.setItem(LEFT_KEY + attemptId, JSON.stringify({ sure, owed }))
  } catch {
    // No storage: the count lives as long as the page does.
  }
}

export function useLeaves({ word, attemptId }) {
  const book = useRef(null)
  if (book.current === null || book.current.id !== attemptId) {
    book.current = { id: attemptId, ...read(attemptId), asked: false, busy: false }
  }
  const [count, setCount] = useState(() => book.current.sure + book.current.owed)
  const [open, setOpen] = useState(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const send = useCallback(async () => {
    const b = book.current
    if (!b.id || b.busy || (b.asked && b.owed === 0)) return
    b.busy = true
    try {
      if (!b.asked) {
        b.sure = Math.max(b.sure, whole((await examLeft(word, b.sure))?.left))
        b.asked = true
      }
      while (b.owed > 0) {
        const sending = b.owed
        const held = whole((await examLeft(word, b.sure + sending))?.left)
        b.sure = Math.max(b.sure + sending, held)
        b.owed -= sending
      }
    } catch {
      // Offline, or the paper is over: what is owed stays owed.
    } finally {
      b.busy = false
      keep(b.id, b)
      if (alive.current) setCount(b.sure + b.owed)
    }
  }, [word])

  useEffect(() => {
    window.addEventListener('online', send)
    return () => window.removeEventListener('online', send)
  }, [send])

  const left = useCallback(() => {
    const b = book.current
    if (!b.id) return
    b.owed += 1
    keep(b.id, b)
    setCount(b.sure + b.owed)
    setOpen(true)
    send()
  }, [send])

  const dismiss = useCallback(() => setOpen(false), [])

  return { count, open, left, dismiss }
}
