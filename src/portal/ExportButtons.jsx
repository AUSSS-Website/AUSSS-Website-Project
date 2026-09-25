import { useState } from 'react'
import { outlineBtnCls } from './portalUi.jsx'
import { dateStamp, downloadText, exportPdf, toCsv } from './exportFile.js'

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
      setError(e?.message || 'The export failed.')
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
        <span role="alert" className="text-xs text-red-300">
          {error}
        </span>
      )}
    </span>
  )
}
