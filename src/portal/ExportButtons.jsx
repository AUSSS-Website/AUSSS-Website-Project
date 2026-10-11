import { useState } from 'react'
import { errorText } from '../lib/errorText.js'
import { outlineBtnCls } from './portalUi.jsx'
import { dateStamp, downloadText, exportPdf, toCsv } from './exportFile.js'

// "Export PDF" (and, unless csv is false, "Export CSV") for a list. The rows
// are whatever the screen currently shows, filters included, so people get
// the list they are looking at. See exportFile.js for the column shape.
//
// What is said when an export fails is errorText's choice: the sentence
// exportFile.js wrote itself, about the font it puts into every PDF ("Could
// not load the PDF font (404)."); the usual line when the server could not be
// reached, which covers the code that builds the PDF, fetched when the button
// is first pressed; and otherwise that the export failed. Never the words of
// whatever broke inside the PDF library.
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
      setError(errorText(e, 'The export failed.'))
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
