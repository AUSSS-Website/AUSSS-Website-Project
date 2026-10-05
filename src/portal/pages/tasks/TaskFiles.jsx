import { useRef, useState } from 'react'
import {
  TASK_FILES_PER_BATCH,
  TASK_FILE_ACCEPT,
  taskFileProblem,
  taskFileUrl,
} from '../../workQueries.js'
import { ErrorText } from '../../portalUi.jsx'

// The two halves of attachments: choosing files before they are sent (the task
// editor and the comment box), and listing the ones a task already holds.

function sizeLabel(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function Clip({ className = 'h-4 w-4' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m21 12-8.5 8.5a5.5 5.5 0 0 1-7.8-7.8L13.4 4a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l7.9-7.9" />
    </svg>
  )
}

// `files` is an array of File objects held by the parent until it saves.
export function FileChooser({ files, onChange, disabled, id }) {
  const inputRef = useRef(null)
  const [problem, setProblem] = useState('')

  const add = (e) => {
    const picked = [...e.target.files]
    e.target.value = '' // the same file can be picked again after removing it
    const bad = picked.map(taskFileProblem).find(Boolean)
    if (bad) {
      setProblem(bad)
      return
    }
    const next = [...files]
    for (const f of picked) {
      if (!next.some((x) => x.name === f.name && x.size === f.size)) next.push(f)
    }
    if (next.length > TASK_FILES_PER_BATCH) {
      setProblem(`Attach up to ${TASK_FILES_PER_BATCH} files at a time.`)
      return
    }
    setProblem('')
    onChange(next)
  }

  return (
    <div>
      <input
        ref={inputRef}
        id={id}
        type="file"
        multiple
        accept={TASK_FILE_ACCEPT}
        onChange={add}
        disabled={disabled}
        className="sr-only"
        tabIndex={-1}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-full border border-line/20 px-4 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-veil/10 disabled:opacity-40"
        >
          <Clip className="h-3.5 w-3.5" />
          Attach files
        </button>
        {files.map((f) => (
          <span
            key={`${f.name}-${f.size}`}
            className="inline-flex max-w-full items-center gap-2 rounded-full border border-line/15 bg-sunk py-1 pl-3 pr-1.5 text-xs text-ink"
          >
            <span className="min-w-0 truncate">{f.name}</span>
            <span className="shrink-0 text-soft/50">{sizeLabel(f.size)}</span>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(files.filter((x) => x !== f))}
              aria-label={`Remove ${f.name}`}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-soft/60 transition-colors hover:bg-veil/10 hover:text-ink disabled:opacity-40"
            >
              &times;
            </button>
          </span>
        ))}
      </div>
      {problem && (
        <div className="mt-2">
          <ErrorText>{problem}</ErrorText>
        </div>
      )}
    </div>
  )
}

// Files a task already holds. Clicking one asks for a short-lived link and
// downloads it under its own name. `canRemove(file)` decides who gets the
// remove control (whoever attached it, or a manager; the database agrees).
export function FileLinks({ files, canRemove, onRemove, removing, className = '' }) {
  const [busy, setBusy] = useState('')
  const [confirming, setConfirming] = useState('')
  const [error, setError] = useState('')

  if (!files.length) return null

  const open = async (file) => {
    setError('')
    setBusy(file.id)
    try {
      window.location.assign(await taskFileUrl(file))
    } catch (e) {
      setError(`Couldn’t open ${file.name}: ${e?.message || 'try again.'}`)
    } finally {
      setBusy('')
    }
  }

  return (
    <div className={className}>
      <ul className="space-y-1.5">
        {files.map((file) => (
          <li key={file.id} className="flex items-center gap-2 text-sm">
            <button
              type="button"
              onClick={() => open(file)}
              disabled={busy === file.id}
              className="inline-flex min-w-0 items-center gap-2 text-left text-accent transition-colors hover:text-ink disabled:opacity-60"
            >
              <Clip className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 truncate underline decoration-line/20 underline-offset-2">
                {file.name}
              </span>
            </button>
            <span className="shrink-0 text-xs text-soft/45">{sizeLabel(file.size_bytes)}</span>
            {canRemove?.(file) &&
              (confirming === file.id ? (
                <span className="ml-auto flex shrink-0 items-center gap-2 text-xs font-semibold">
                  <button
                    type="button"
                    disabled={removing}
                    onClick={() => onRemove(file)}
                    className="text-danger hover:text-danger disabled:opacity-40"
                  >
                    Remove
                  </button>
                  <button type="button" onClick={() => setConfirming('')} className="text-soft/60 hover:text-ink">
                    Keep
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirming(file.id)}
                  aria-label={`Remove ${file.name}`}
                  className="ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-soft/50 transition-colors hover:bg-veil/10 hover:text-ink"
                >
                  &times;
                </button>
              ))}
          </li>
        ))}
      </ul>
      {error && (
        <div className="mt-2">
          <ErrorText>{error}</ErrorText>
        </div>
      )}
    </div>
  )
}
