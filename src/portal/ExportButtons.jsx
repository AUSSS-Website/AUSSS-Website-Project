import { useState } from 'react'
import { UNREACHED, errorText } from '../lib/errorText.js'
import { outlineBtnCls } from './portalUi.jsx'
import { dateStamp, downloadText, exportPdf, toCsv } from './exportFile.js'

// The two sentences exportFile.js writes itself, about the font it puts into
// every PDF ("Could not load the PDF font (404)"). They are thrown as plain
// errors with no mark on them, which errorText would take for something not
// meant to be read, so they are known here by how they begin.
const OWN_WORDS = /^Could not (load|read) the PDF font/
// What a browser says when it could not fetch the code that builds the PDF,
// which is loaded when the button is first pressed (Chrome, Firefox, Safari).
// It is the same trouble as a request that got no answer, in other words.
const NO_CODE = /dynamically imported module|importing a module script failed/i

// What to say when an export fails: exportFile.js's own sentence as written
// (given the full stop it lacks), the usual line when the server could not be
// reached, and otherwise that the export failed. Never the words of whatever
// broke inside the PDF library.
function exportError(err) {
  const message = typeof err?.message === 'string' ? err.message : ''
  if (OWN_WORDS.test(message)) return message.endsWith('.') ? message : `${message}.`
  if (NO_CODE.test(message)) return UNREACHED
  return errorText(err, 'The export failed.')
}

// "Export PDF" (and, unless csv is false, "Export CSV") for a list. The rows
// are whatever the screen currently shows, filters included, so people get
// the list they are looking at. See exportFile.js for the column shape.
export default function ExportButtons({
  title,
  subtitle,
  filename,
  columns,
  rows,
  layout = 'table',
  summary,
  landscape = false,
  csv = true,
  className = outlineBtnCls,
}) {
  const [busy, setBusy] = useState('') // 'pdf' | 'csv'
  const [error, setError] = useState('')
  const name = `${filename}-${dateStamp()}`
  const empty = !rows || rows.length === 0

  const run = async (what, fn) => {
    setBusy(what)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(exportError(e))
    } finally {
      setBusy('')
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={empty || Boolean(busy)}
        onClick={() =>
          run('pdf', () => exportPdf({ title, subtitle, columns, rows, layout, summary, landscape, filename: name }))
        }
        className={className}
      >
        {busy === 'pdf' ? 'Preparing PDF…' : 'Export PDF'}
      </button>
      {csv && (
        <button
          type="button"
          disabled={empty || Boolean(busy)}
          onClick={() => run('csv', () => downloadText(`${name}.csv`, toCsv(columns, rows)))}
          className={className}
        >
          Export CSV
        </button>
      )}
      {error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </span>
  )
}
