// One tab at a time for a taker's sitting, on the browser's Web Locks
// (navigator.locks). useSitting.js says why; this is only the lock.
//
// A browser without Web Locks (older than 2022, or a page not served over
// https) has nothing to take: claimTab then answers as if the lock was given,
// and the sitting carries on as it would with one tab.

// What this tab holds or has asked for, by lock name. A sitting stopped and
// started again in the same breath (React's StrictMode, a remount) shares the
// lock, where a second request would find it taken by the tab itself.
const tabLocks = new Map()

function askForLock(locks, name, steal) {
  const entry = { users: 0, lost: new Set(), letGo: () => {}, got: null }
  entry.got = new Promise((resolve) => {
    let given = false
    // The lock is held for as long as this stays unsettled.
    const kept = new Promise((done) => {
      entry.letGo = done
    })
    locks
      .request(name, steal ? { steal: true } : { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolve(false)
          return undefined
        }
        given = true
        resolve(true)
        return kept
      })
      .catch(() => {
        // Before the lock was given, the browser will not lock here at all:
        // carry on without one. After, another tab has taken it over.
        if (!given) {
          resolve(true)
          return
        }
        if (tabLocks.get(name) === entry) tabLocks.delete(name)
        for (const tell of [...entry.lost]) tell()
      })
  })
  return entry
}

// Asks for the lock called `name`. Resolves to the function that gives it
// back, or to null when another tab holds it. `steal` takes it from that tab;
// `onTaken` is called if a tab later takes it from this one.
export function claimTab(name, { steal = false, onTaken } = {}) {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : null
  if (!locks || typeof locks.request !== 'function') return Promise.resolve(() => {})
  let entry = tabLocks.get(name)
  if (!entry || steal) {
    try {
      entry = askForLock(locks, name, steal)
    } catch {
      return Promise.resolve(() => {})
    }
    tabLocks.set(name, entry)
  }
  const mine = entry
  mine.users += 1
  if (onTaken) mine.lost.add(onTaken)
  let left = false
  const leave = () => {
    if (left) return
    left = true
    mine.users -= 1
    mine.lost.delete(onTaken)
    // Not in the same breath: whoever starts next in this tab may share it.
    setTimeout(() => {
      if (mine.users > 0) return
      mine.letGo()
      if (tabLocks.get(name) === mine) tabLocks.delete(name)
    }, 0)
  }
  return mine.got.then((got) => {
    if (got) return leave
    if (tabLocks.get(name) === mine) tabLocks.delete(name)
    leave()
    return null
  })
}
