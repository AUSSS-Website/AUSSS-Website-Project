import { describe, expect, it } from 'vitest'
import { makePictureLedger } from './examPictures.js'

// A form's pictures, with the bucket as a list of what was removed from it.
function form(stored, editsARow) {
  const removed = []
  const ledger = makePictureLedger(stored, editsARow, (path) => removed.push(path))
  ledger.opened()
  return { ledger, removed }
}
// What a form does when it is saved with a picture (or with none) and the save lands.
const save = (ledger, path) => {
  ledger.sending(path)
  ledger.saved(path)
}

describe('the form that adds new questions', () => {
  it('never removes the picture of a question it has already added', () => {
    const { ledger, removed } = form(null, false)
    // question A, with a picture
    ledger.added('exam/a.jpg')
    save(ledger, 'exam/a.jpg')
    // the form empties itself; question B has no picture
    save(ledger, null)
    expect(removed).toEqual([])
    // question C has a picture of its own
    ledger.added('exam/c.jpg')
    save(ledger, 'exam/c.jpg')
    expect(removed).toEqual([])
    // and the form closing takes none of them
    ledger.closed()
    expect(removed).toEqual([])
  })

  it('removes a picture that was chosen and then replaced before the question was added', () => {
    const { ledger, removed } = form(null, false)
    ledger.added('exam/first.jpg')
    ledger.added('exam/second.jpg')
    save(ledger, 'exam/second.jpg')
    expect(removed).toEqual(['exam/first.jpg'])
  })

  it('removes a picture that was chosen and taken out again', () => {
    const { ledger, removed } = form(null, false)
    ledger.added('exam/a.jpg')
    save(ledger, null)
    expect(removed).toEqual(['exam/a.jpg'])
  })

  it('removes what was chosen when the form closes with nothing added', () => {
    const { ledger, removed } = form(null, false)
    ledger.added('exam/a.jpg')
    ledger.closed()
    expect(removed).toEqual(['exam/a.jpg'])
  })
})

describe('the form that edits a question', () => {
  it('removes the old picture once the question has another', () => {
    const { ledger, removed } = form('exam/old.jpg', true)
    ledger.added('exam/new.jpg')
    save(ledger, 'exam/new.jpg')
    expect(removed).toEqual(['exam/old.jpg'])
    ledger.closed()
    expect(removed).toEqual(['exam/old.jpg'])
  })

  it('removes the old picture once the question has none', () => {
    const { ledger, removed } = form('exam/old.jpg', true)
    save(ledger, null)
    expect(removed).toEqual(['exam/old.jpg'])
  })

  it('keeps the question’s picture when it is saved as it is, and when the form is cancelled', () => {
    const kept = form('exam/old.jpg', true)
    save(kept.ledger, 'exam/old.jpg')
    kept.ledger.closed()
    expect(kept.removed).toEqual([])

    const cancelled = form('exam/old.jpg', true)
    cancelled.ledger.added('exam/tried.jpg')
    cancelled.ledger.closed()
    // the one that was tried goes; the question still has its own
    expect(cancelled.removed).toEqual(['exam/tried.jpg'])
  })

  it('removes every picture that was tried on the way to the one that was saved', () => {
    const { ledger, removed } = form('exam/old.jpg', true)
    ledger.added('exam/one.jpg')
    ledger.added('exam/two.jpg')
    ledger.added('exam/three.jpg')
    save(ledger, 'exam/three.jpg')
    expect(removed.sort()).toEqual(['exam/old.jpg', 'exam/one.jpg', 'exam/two.jpg'])
  })
})

describe('a save whose outcome is not known yet', () => {
  it('keeps the picture it left with when the form closes before the answer comes', () => {
    const { ledger, removed } = form('exam/old.jpg', true)
    ledger.added('exam/new.jpg')
    ledger.sending('exam/new.jpg')
    // the officer goes to another tab while the save is on its way
    ledger.closed()
    expect(removed).toEqual([])
  })

  it('keeps it when the save failed: its answer may have been lost on the way back', () => {
    const { ledger, removed } = form(null, false)
    ledger.added('exam/a.jpg')
    ledger.sending('exam/a.jpg')
    // no answer; the officer gives up and the form closes
    ledger.closed()
    expect(removed).toEqual([])
  })

  it('keeps it through a later save with another picture, since the first may have landed', () => {
    const { ledger, removed } = form('exam/old.jpg', true)
    ledger.added('exam/a.jpg')
    ledger.sending('exam/a.jpg') // no answer
    ledger.added('exam/b.jpg')
    save(ledger, 'exam/b.jpg')
    // the old one goes (the row now has b); a stays, a stray file at worst
    expect(removed).toEqual(['exam/old.jpg'])
  })

  it('is settled by a save of the same picture that does land', () => {
    const { ledger, removed } = form(null, false)
    ledger.added('exam/a.jpg')
    ledger.sending('exam/a.jpg') // no answer
    save(ledger, 'exam/a.jpg') // tried again, and it landed
    ledger.closed()
    expect(removed).toEqual([])
  })
})

describe('an upload that outlives its form', () => {
  it('is removed at once when it finishes after the form has closed', () => {
    const { ledger, removed } = form(null, false)
    ledger.closed()
    ledger.added('exam/late.jpg')
    expect(removed).toEqual(['exam/late.jpg'])
  })

  it('is kept as any other when the form was only drawn again', () => {
    // React draws a form's effects twice while developing: closed, then opened again
    const { ledger, removed } = form(null, false)
    ledger.closed()
    ledger.opened()
    ledger.added('exam/a.jpg')
    expect(removed).toEqual([])
    save(ledger, 'exam/a.jpg')
    expect(removed).toEqual([])
  })
})
