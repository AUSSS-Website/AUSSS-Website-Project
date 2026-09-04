// Short, human-readable submission references, PREFIX-XXXXXX, base36 of the
// timestamp plus three random digits.
//
// Generated on the client and shipped *to* Apps Script (rather than minted
// there) so the sheet row, the notification email and the success screen the
// user is looking at all quote the same code. Orders, stories and open-call
// applications each pass their own prefix.
export function makeReference(prefix) {
  const t = Date.now().toString(36).toUpperCase().slice(-5)
  const r = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, '0')
  return `${prefix}-${t}${r}`
}
