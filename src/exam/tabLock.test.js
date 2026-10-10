import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { claimTab } from './tabLock.js'

// claimTab runs on the browser's Web Locks (navigator.locks). Here it runs on
// a stand-in that keeps their rules, so the tests are the same on every Node
// (the real ones came with Node 24; CI runs 22). "Another tab" is a request
// made past claimTab, straight to the lock.

// The three rules of Web Locks that claimTab leans on: a request with
// `ifAvailable` gets null while the lock is held; one with `steal` takes it,
// and the holder's request is rejected with an AbortError; the lock is held
// until the promise its callback returned settles.
function standIn() {
  const held = new Map()
  return {
    request(name, options, callback) {
      return new Promise((resolve, reject) => {
        const holder = held.get(name)
        if (holder && !options.steal) {
          Promise.resolve(callback(null)).then(resolve, reject)
          return
        }
        if (holder) holder.abort()
        const mine = { abort: () => reject(Object.assign(new Error('The lock was taken over.'), { name: 'AbortError' })) }
        held.set(name, mine)
        Promise.resolve()
          .then(() => callback({ name }))
          .then((value) => {
            if (held.get(name) === mine) held.delete(name)
            resolve(value)
          }, reject)
      })
    },
  }
}

let serial = 0
const fresh = () => `test-lock:${Date.now()}:${(serial += 1)}`
const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

// Holds (or tries to hold) the lock as another tab would. `has` says whether
// it got it; `end` says how its hold ended: 'released', or the error's name.
function otherTab(name, options = { ifAvailable: true }) {
  let letGo
  const kept = new Promise((resolve) => {
    letGo = resolve
  })
  let say
  const has = new Promise((resolve) => {
    say = resolve
  })
  const end = navigator.locks
    .request(name, options, (lock) => {
      say(Boolean(lock))
      return lock ? kept : undefined
    })
    .then(
      () => 'released',
      (error) => error.name,
    )
  return { has, letGo, end }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('one tab at a time', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', { locks: standIn() })
  })

  it('gives the lock to the first tab and tells the second it is taken', async () => {
    const name = fresh()
    const first = otherTab(name)
    expect(await first.has).toBe(true)
    expect(await claimTab(name)).toBe(null)
    // the other tab is closed: the lock is there to take
    first.letGo()
    expect(await first.end).toBe('released')
    const leave = await claimTab(name)
    expect(typeof leave).toBe('function')
    expect(await otherTab(name).has).toBe(false)
    leave()
  })

  it('gives it back when the sitting stops', async () => {
    const name = fresh()
    const leave = await claimTab(name)
    leave()
    leave() // twice is once
    await tick()
    const other = otherTab(name)
    expect(await other.has).toBe(true)
    other.letGo()
  })

  it('is shared by a sitting stopped and started again in the same breath', async () => {
    const name = fresh()
    // StrictMode: start, stop, start, with no pause between them
    const first = claimTab(name)
    const second = claimTab(name)
    const leaveFirst = await first
    leaveFirst()
    const leaveSecond = await second
    expect(typeof leaveSecond).toBe('function')
    // and a third, straight after the first has let go
    const leaveThird = await claimTab(name)
    expect(typeof leaveThird).toBe('function')
    await tick()
    // still held while one of them lives
    expect(await otherTab(name).has).toBe(false)
    leaveSecond()
    leaveThird()
    await tick()
    const other = otherTab(name)
    expect(await other.has).toBe(true)
    other.letGo()
  })

  it('takes the lock over when asked, and the tab that held it loses it', async () => {
    const name = fresh()
    const other = otherTab(name)
    expect(await other.has).toBe(true)
    expect(await claimTab(name)).toBe(null)
    const leave = await claimTab(name, { steal: true })
    expect(typeof leave).toBe('function')
    expect(await other.end).toBe('AbortError')
    leave()
  })

  it('tells the sitting when another tab takes the lock from it', async () => {
    const name = fresh()
    const onTaken = vi.fn()
    const leave = await claimTab(name, { onTaken })
    expect(typeof leave).toBe('function')
    const thief = otherTab(name, { steal: true })
    expect(await thief.has).toBe(true)
    await tick()
    expect(onTaken).toHaveBeenCalledTimes(1)
    // this tab no longer holds it: asking again finds it taken
    expect(await claimTab(name)).toBe(null)
    leave()
    thief.letGo()
  })

  it('does not tell a sitting that had already stopped', async () => {
    const name = fresh()
    const onTaken = vi.fn()
    const stay = await claimTab(name)
    const leave = await claimTab(name, { onTaken })
    leave()
    const thief = otherTab(name, { steal: true })
    await thief.has
    await tick()
    expect(onTaken).not.toHaveBeenCalled()
    stay()
    thief.letGo()
  })
})

describe('a browser without Web Locks', () => {
  it('lets the sitting carry on as if it held the lock', async () => {
    vi.stubGlobal('navigator', {})
    const leave = await claimTab(fresh())
    expect(typeof leave).toBe('function')
    expect(typeof (await claimTab(fresh(), { steal: true }))).toBe('function')
    leave()
  })

  it('does the same where the browser has them and refuses to lock', async () => {
    vi.stubGlobal('navigator', {
      locks: { request: () => Promise.reject(Object.assign(new Error('Not allowed here.'), { name: 'SecurityError' })) },
    })
    expect(typeof (await claimTab(fresh()))).toBe('function')
  })
})
