import { useEffect, useRef, useState } from 'react'
import {
  TASK_FILES_PER_BATCH,
  TASK_FILE_ACCEPT,
  taskFileProblem,
  taskFileUrl,
} from '../../workQueries.js'
import { ConfirmButton, ErrorText } from '../../portalUi.jsx'
import { errorText } from '../../../lib/errorText.js'
import { pressCls } from '../../../lib/motion.js'

// The two halves of attachments: choosing files before they are sent (the task
// editor and the comment box), and listing the ones a task already holds.

// On a touch screen a control stands at least a thumb tall; with a mouse it
// keeps its small size. In px and not rem, because the root size shrinks on a
// 320px phone.
const tapCls = '[@media(pointer:coarse)]:min-h-[44px]'

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
          className={`inline-flex items-center justify-center gap-2 rounded-full border border-line/20 px-4 py-1.5 text-xs font-semibold text-ink ${pressCls} ${tapCls} hover:bg-veil/10 disabled:opacity-40`}
        >
          <Clip className="h-3.5 w-3.5" />
          Attach files
        </button>
        {files.map((f) => (
          <span
            key={`${f.name}-${f.size}`}
            className="inline-flex max-w-full items-center gap-2 rounded-full border border-line/15 bg-sunk py-1 pl-3 pr-1.5 text-xs text-ink [@media(pointer:coarse)]:py-0 [@media(pointer:coarse)]:pr-0"
          >
            <span className="min-w-0 truncate">{f.name}</span>
            <span className="shrink-0 text-soft/50">{sizeLabel(f.size)}</span>
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                // Taking a file out makes room, so a note about too many no longer holds.
                setProblem('')
                onChange(files.filter((x) => x !== f))
              }}
              aria-label={`Remove ${f.name}`}
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-soft/60 ${pressCls} hover:bg-veil/10 hover:text-ink disabled:opacity-40 [@media(pointer:coarse)]:h-[44px] [@media(pointer:coarse)]:w-[44px] [@media(pointer:coarse)]:text-base`}
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

// What an upload of several files is doing, in words: "Uploading 2 of 5:
// minutes.pdf". `progress` is what the task writes hand to onProgress
// ({ index, total, name }), or null while nothing is going up.
//
// It is a polite status, so a screen reader says each file as its turn comes.
// For that the line has to be in the page before it has anything to say: with
// nothing to say it is still rendered, out of sight and taking up no room.
export function UploadStatus({ progress, className = '' }) {
  const text = !progress
    ? ''
    : progress.total > 1
      ? `Uploading ${progress.index} of ${progress.total}: ${progress.name}`
      : `Uploading ${progress.name}`
  return (
    <p role="status" className={text ? `min-w-0 max-w-full truncate text-xs text-soft/70 ${className}` : 'sr-only'}>
      {text}
    </p>
  )
}

// Files a task already holds. Clicking one asks for a short-lived link and
// downloads it under its own name. `canRemove(file)` decides who gets the
// remove control (whoever attached it, or a manager; the database agrees).
//
// A file that could not be opened or removed says so here, under the list it
// is in, and only the file being removed shows "Removing…": `onRemove` may
// return a promise, and one that rejects is the reason shown. `removing` still
// switches every remove control off, for a page that wants one at a time.
//
// `onOpening` (optional) is told true as a file starts to be fetched and false
// once its download has begun, once each per file opened. The download is
// started by sending the page to the file's link, which the browser treats as
// leaving until it sees that a file came back, so a page that asks before it
// is left has to hold that question back meanwhile.
const DOWNLOAD_STARTS_MS = 1000

export function FileLinks({ files, canRemove, onRemove, removing, onOpening, className = '' }) {
  const [busy, setBusy] = useState('')
  const [leaving, setLeaving] = useState('')
  const [error, setError] = useState('')
  const list = useRef(null)
  // The file whose removal failed while the keyboard stood on its control.
  // "Removing…" had taken that control's place, and the keyboard's place went
  // with it; the file is still here, so its control gets the place back,
  // unless the person has moved on to something else since.
  const [handBack, setHandBack] = useState('')
  useEffect(() => {
    if (!handBack) return
    const nowhere = !document.activeElement || document.activeElement === document.body
    const row = [...(list.current?.children || [])].find((li) => li.dataset.file === handBack)
    if (nowhere) row?.querySelector('[data-remove] button')?.focus()
    setHandBack('')
  }, [handBack])

  if (!files.length) return null

  const open = async (file) => {
    setError('')
    setBusy(file.id)
    onOpening?.(true)
    try {
      window.location.assign(await taskFileUrl(file))
      // The page hears nothing of the download. This is long enough for the
      // browser to have asked its question, had there been one to ask.
      await new Promise((resolve) => setTimeout(resolve, DOWNLOAD_STARTS_MS))
    } catch (e) {
      setError(errorText(e, `Couldn’t open ${file.name}. Try again.`))
    } finally {
      setBusy((now) => (now === file.id ? '' : now))
      onOpening?.(false)
    }
  }

  const remove = async (file) => {
    const hadFocus = Boolean(list.current?.contains(document.activeElement))
    setError('')
    setLeaving(file.id)
    try {
      await onRemove(file)
    } catch (e) {
      setError(errorText(e, `Could not remove ${file.name}.`))
      if (hadFocus) setHandBack(file.id)
    } finally {
      setLeaving('')
    }
  }

  const going = leaving ? files.find((file) => file.id === leaving) : null

  return (
    <div className={className}>
      <ul ref={list} className="space-y-1.5">
        {files.map((file) => (
          <li
            key={file.id}
            data-file={file.id}
            className={`flex items-center gap-2 text-sm ${leaving === file.id ? 'opacity-60' : ''}`}
          >
            <button
              type="button"
              onClick={() => open(file)}
              disabled={busy === file.id || leaving === file.id}
              className={`inline-flex min-w-0 items-center gap-2 text-left text-accent ${pressCls} ${tapCls} hover:text-ink disabled:opacity-60`}
            >
              <Clip className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 truncate underline decoration-line/20 underline-offset-2">
                {file.name}
              </span>
            </button>
            <span className="shrink-0 text-xs text-soft/45">{sizeLabel(file.size_bytes)}</span>
            {canRemove?.(file) &&
              (leaving === file.id ? (
                <span aria-hidden="true" className="ml-auto shrink-0 text-xs text-soft/60">
                  Removing…
                </span>
              ) : (
                // On a touch screen the cross is 44px across, and the red pill
                // it turns into (which wears classes of its own) is stretched
                // to the same height by this element.
                <span data-remove className={`ml-auto inline-flex shrink-0 items-stretch ${tapCls}`}>
                  <ConfirmButton
                    variant="text"
                    label="Remove"
                    ariaLabel={`Remove ${file.name}`}
                    disabled={removing}
                    onConfirm={() => remove(file)}
                    className="flex h-5 w-5 items-center justify-center rounded-full text-soft/50 transition-colors hover:bg-veil/10 hover:text-ink [@media(pointer:coarse)]:h-[44px] [@media(pointer:coarse)]:w-[44px]"
                  >
                    &times;
                  </ConfirmButton>
                </span>
              ))}
          </li>
        ))}
      </ul>
      {/* The same words for a screen reader, with the file's name. A status
          is only read out if it was in the page before it had anything to say,
          so this one is always here and the line in the row is for the eye. */}
      <p role="status" className="sr-only">
        {going ? `Removing ${going.name}…` : ''}
      </p>
      {error && (
        <div className="mt-2">
          <ErrorText>{error}</ErrorText>
        </div>
      )}
    </div>
  )
}
