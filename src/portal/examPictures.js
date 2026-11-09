// Which pictures a form of the exam's Questions tab may remove from the bucket,
// kept apart from the page so it can be tested on its own (examPictures.test.js).
//
// A question or a passage may have one picture. It is uploaded when it is
// chosen and belongs to the row only once the form is saved, so a form leaves
// files behind that nothing points at: one chosen and then replaced, one
// chosen in a form that was cancelled, the one a row had before it got
// another. Those are removed. The rule above the others: never remove a
// picture a saved row may point at. A stray file costs nothing; a missing one
// is a question a student cannot read.
//
//   stored      the picture of the row the form edits
//   editsARow   false for the form that adds new rows. That form has no row of
//               its own, also after it has added one and emptied itself for
//               the next: the picture it just saved belongs to a row it no
//               longer edits, and is never its to remove.
//   remove      removes one file from the bucket, best effort
//
// The form calls `added` for each upload, `sending` as a save leaves with a
// picture, `saved` once the row is written with that picture (or with none),
// and `opened` and `closed` as it comes and goes.
//   * What was uploaded and not saved goes at the save, and when the form
//     closes.
//   * The picture the edited row had before goes once the row has another.
//   * A picture a save left with is not removed until a save is known to have
//     landed without it: a save whose answer was lost may have written it,
//     and a form that closes while its save is on the way must not take the
//     picture from under it.
//   * An upload that finishes after the form has closed is removed at once.
export function makePictureLedger(stored, editsARow, remove) {
  let kept = editsARow ? stored || null : null
  let uploads = []
  const unsure = new Set()
  let closed = false
  return {
    opened() {
      closed = false
    },
    closed() {
      closed = true
      for (const path of uploads) if (path !== kept && !unsure.has(path)) remove(path)
      uploads = []
    },
    added(path) {
      if (!path) return
      if (closed) remove(path)
      else uploads.push(path)
    },
    sending(path) {
      if (path) unsure.add(path)
    },
    saved(path) {
      const before = kept
      if (path) unsure.delete(path)
      for (const p of uploads) if (p !== path && !unsure.has(p)) remove(p)
      uploads = []
      if (!editsARow) return
      kept = path || null
      if (before && before !== kept) remove(before)
    },
  }
}
