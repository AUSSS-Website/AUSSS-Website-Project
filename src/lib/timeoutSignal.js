// An AbortSignal that fires after `ms`, so a hung backend cannot leave the UI
// spinning forever. Undefined where AbortController does not exist.
export function timeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
    return AbortSignal.timeout(ms)
  }
  if (typeof AbortController !== 'undefined') {
    const ctrl = new AbortController()
    setTimeout(() => ctrl.abort(), ms)
    return ctrl.signal
  }
  return undefined
}
