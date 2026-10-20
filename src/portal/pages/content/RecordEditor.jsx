import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { emptyRow } from '../../../content/schema.js'
import { useGallery } from '../../../lib/gallery.js'
import { errorText } from '../../../lib/errorText.js'
import { pressCls, scrollBehavior } from '../../../lib/motion.js'
import { uploadContentImage, uploadContentPdf } from '../../contentQueries.js'
import { SLOW_PDF_BYTES, fileSize } from '../../../lib/documents.js'
import { CheckField, ErrorText, UndoLine, inputCls, outlineBtnCls, panelTitleCls } from '../../portalUi.jsx'

// The one form every edited part of the site uses. It draws a control for each
// field of a schema (src/content/schema.js lists the types). It keeps no
// document of its own, so the page around it decides what saving and
// publishing mean.
//
//   <RecordEditor schema={schema} doc={doc} onChange={setDoc} errors={errors} />
//
// `onChange` is handed a function, as a state setter can be: it takes the
// document and returns it with one change made. Pass the setter itself. Every
// change is worked out from the document as it stands when the change lands,
// never from the one that was on screen when it began: a picture takes seconds
// to upload, and what was typed in those seconds must still be there when it
// arrives.
//
// `errors` is validateDoc's answer: { 'items.2.q': 'message' }.
//
// Every field and list row carries data-anchor (its path, 'items.2.q'), which
// the editor page uses to keep the preview level with the form
// (usePreviewFollow.js). The control a field's error is about carries
// data-control with the same path, which focusField() below looks for.

// A field's label is plain ink text, as on every portal form. The small blue
// capitals (panelTitleCls) are kept for a list's title, which opens a section
// of the form.
const labelCls = 'block text-sm font-medium text-ink'
const helpCls = 'mt-1 text-xs leading-relaxed text-soft/55'
// A small button keeps its size and takes a finger all the same: its ::after
// reaches past it to 44px, in px because the root size shrinks on a small phone.
const tallHitCls = "relative after:absolute after:inset-x-0 after:top-1/2 after:h-[44px] after:-translate-y-1/2 after:content-['']"
const smallBtnCls = `${outlineBtnCls} ${tallHitCls}`
// The three round buttons of a row stand far enough apart for their 44px areas
// to meet and not overlap (rowHeadCls below).
const iconBtnCls = `relative grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line/15 text-soft/70 ${pressCls} hover:bg-veil/10 hover:text-ink disabled:opacity-30 after:absolute after:left-1/2 after:top-1/2 after:h-[44px] after:w-[44px] after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']`
// A row's header: its title, then the three buttons. The gap is the usual
// 0.75rem, which with a 2rem button is 44px from one button's centre to the
// next. On a 320px phone the root size is 15px and that falls to 41px, so
// there the gap is whatever makes it 44px again.
const rowHeadCls = 'flex items-center gap-[max(0.75rem,calc(44px_-_2rem))]'

// A change is the new value, or a function of the old one.
const applied = (change, was) => (typeof change === 'function' ? change(was) : change)

// ---- which row is which -----------------------------------------------------
//
// A list row has no name of its own in the document, and its place changes
// when a row above it is moved or removed. Each row is given a number here
// that follows it through every edit. React keeps a row's controls with the
// row by it, and a picture that finishes uploading lands in the row it was
// chosen for, wherever that row is by then (nowhere, if it was removed). The
// numbers are kept beside the document and never in it: what is saved has the
// schema's shape and nothing else.

const rowIds = new WeakMap()
let lastRowId = 0

const isRow = (row) => row !== null && typeof row === 'object' && !Array.isArray(row)
// normalizeDoc drops anything else from a list before it is saved, so the form
// does not draw it either, and the rows count the same in both.
const asRows = (value) => (Array.isArray(value) ? value.filter(isRow) : [])

function rowId(row) {
  let id = rowIds.get(row)
  if (!id) {
    id = ++lastRowId
    rowIds.set(row, id)
  }
  return id
}

// After a save the page swaps the document on screen for the saved copy of
// it: the same rows, in new objects. This gives each new row the number of the
// row it stands for, so the form carries on with the rows it had and a picture
// still on its way finds its row.
export function keepRowIds(fields, from, to) {
  for (const field of fields) {
    if (field.type !== 'list') continue
    const was = asRows(from?.[field.name])
    const now = asRows(to?.[field.name])
    if (was.length !== now.length) continue
    now.forEach((row, i) => {
      rowIds.set(row, rowId(was[i]))
      keepRowIds(field.fields, was[i], row)
    })
  }
}

// ---- rows that were removed --------------------------------------------------
//
// A removed row leaves a line where it stood ("Removed question 3: “Who can
// join?”. Undo"), so a slip costs one click and nothing is asked beforehand.
// The lines are kept in page order: `at` is the place in the list of the row a
// line sits in front of (the list's length for one after the last row).

// The lines once the row at `i` has gone and `entry` stands for it.
function withRemoved(gone, i, entry) {
  return [
    ...gone.filter((g) => g.at <= i),
    { ...entry, at: i },
    ...gone.filter((g) => g.at > i).map((g) => ({ ...g, at: g.at - 1 })),
  ]
}

// The lines once the row of line `id` is back in the list: the lines after it
// now sit one row further down.
function withRestored(gone, id) {
  const k = gone.findIndex((g) => g.id === id)
  if (k < 0) return gone
  return [...gone.slice(0, k), ...gone.slice(k + 1).map((g) => ({ ...g, at: g.at + 1 }))]
}

// Puts the cursor on a control once the change that brings it has been drawn:
// the Undo of a row just removed, the row just put back. Without it the cursor
// is left on a control that is no longer there, and a keyboard starts again
// from the top of the page. The function it returns takes selectors to look
// for inside `scope`, the one wanted most first.
function useFocusNext(scope) {
  const wanted = useRef(null)
  useEffect(() => {
    const selectors = wanted.current
    if (!selectors) return
    wanted.current = null
    for (const selector of selectors) {
      const el = scope.current?.querySelector(selector)
      if (el) {
        el.focus()
        return
      }
    }
  })
  return (...selectors) => {
    wanted.current = selectors
  }
}

// Brings the control a problem is about into view and puts the cursor in it.
// `form` is an element around the RecordEditor and `path` a key of `errors`.
export function focusField(form, path) {
  if (!form) return
  const name = CSS.escape(path)
  const control = form.querySelector(`[data-control="${name}"]:not(:disabled)`)
  // A control that is switched off cannot take the cursor; its field is shown all the same.
  const el = control || form.querySelector(`[data-anchor="${name}"]`)
  if (!el) return
  control?.focus({ preventScroll: true })
  el.scrollIntoView({ behavior: scrollBehavior(), block: 'center' })
}

function Count({ value, max }) {
  if (!max) return null
  const n = String(value || '').length
  if (n < max * 0.8) return null
  return (
    <span className={`shrink-0 text-xs tabular-nums ${n > max ? 'font-semibold text-danger' : 'text-soft/50'}`}>
      {n} / {max}
    </span>
  )
}

// A text box as tall as what is typed in it, so a long answer is never read
// through a slot (wrapped lines count, which a row count cannot know). The
// lines wrap again when the box changes width (the window, a phone turned on
// its side), so it is fitted again then too.
function GrowingTextarea({ value, minRows, ...rest }) {
  const ref = useRef(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + 2}px`
  }, [value])
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    let width = el.clientWidth
    let frame = 0
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === width) return
      width = el.clientWidth
      // On the next frame: a size changed inside the observer's own call is reported as a loop.
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        el.style.height = 'auto'
        el.style.height = `${el.scrollHeight + 2}px`
      })
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [])
  return <textarea ref={ref} value={value} rows={minRows} {...rest} />
}

function TextControl({ field, value, onChange, id, path, describedBy, disabled }) {
  const long = field.type === 'textarea' || field.type === 'markdown'
  const common = {
    id,
    value: value || '',
    disabled,
    'data-control': path,
    'aria-invalid': describedBy ? true : undefined,
    'aria-describedby': describedBy,
    onChange: (e) => onChange(e.target.value),
    className: inputCls,
  }
  if (!long) {
    return (
      <input
        {...common}
        type={field.type === 'url' ? 'url' : 'text'}
        inputMode={field.type === 'url' ? 'url' : undefined}
        placeholder={field.placeholder || (field.type === 'url' ? 'https://' : undefined)}
      />
    )
  }
  return (
    <GrowingTextarea
      {...common}
      minRows={3}
      placeholder={field.placeholder}
      className={`${inputCls} resize-none overflow-hidden leading-relaxed`}
    />
  )
}

function ImageControl({ field, value, onChange, blockKey, id, path, disabled }) {
  const box = useRef(null)
  const pick = useRef(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // The picture that Remove has just taken out, for Undo to put back.
  const [removed, setRemoved] = useState('')
  const focusNext = useFocusNext(box)

  const upload = async (file) => {
    if (!file) return
    setErr('')
    setBusy(true)
    try {
      onChange(await uploadContentImage(blockKey, file, field.maxPx || 1600))
      setRemoved('')
    } catch (e) {
      setErr(errorText(e, 'The picture did not upload. Try again.'))
    } finally {
      setBusy(false)
      if (pick.current) pick.current.value = ''
    }
  }

  return (
    <div ref={box}>
      <div className="flex flex-wrap items-center gap-4">
        {value ? (
          <img
            src={value}
            alt=""
            className="h-24 w-36 rounded-xl border border-line/10 bg-sunk object-cover"
          />
        ) : (
          <span className="grid h-24 w-36 place-items-center rounded-xl border border-dashed border-line/20 text-xs text-soft/45">
            No picture
          </span>
        )}
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {/* The button below is the control; the file input only holds the choice, so the keyboard does not stop on it. */}
          <input
            ref={pick}
            id={id}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            tabIndex={-1}
            disabled={disabled || busy}
            onChange={(e) => upload(e.target.files?.[0])}
          />
          <button
            type="button"
            data-control={path}
            data-picture="choose"
            className={smallBtnCls}
            disabled={disabled || busy}
            onClick={() => pick.current?.click()}
          >
            {busy ? 'Uploading…' : value ? 'Replace picture' : 'Choose a picture'}
          </button>
          {value && (
            <button
              type="button"
              className={smallBtnCls}
              disabled={disabled || busy}
              onClick={() => {
                setRemoved(value)
                onChange('')
                focusNext('[role="status"] button')
              }}
            >
              Remove
            </button>
          )}
          {/* Undo comes where Remove was. The line is always in the page, so it is read out when it has something to say. */}
          <UndoLine
            className="py-3"
            onUndo={() => {
              onChange(removed)
              setRemoved('')
              focusNext('[data-picture="choose"]')
            }}
          >
            {removed && !value ? 'Picture removed.' : null}
          </UndoLine>
        </div>
      </div>
      {err && (
        <div className="mt-2">
          <ErrorText>{err}</ErrorText>
        </div>
      )}
    </div>
  )
}

// The last part of an address, readable ("New%20file.pdf" as "New file.pdf").
function lastPart(url) {
  const part = (url || '').split('/').pop() || ''
  try {
    return decodeURIComponent(part)
  } catch {
    return part
  }
}

// A PDF: the file in place now (its name, pages and size, and a way to open
// it), and a button to choose a new one. The new file is read and uploaded
// at once, and takes the old one's place in the form; like any other change it
// reaches the site only when the block is published. A PDF is replaced, never
// removed (see the pdf type in src/content/schema.js).
function PdfControl({ value, onChange, blockKey, id, path, disabled }) {
  const pick = useRef(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // What the last upload says, until the next one starts.
  const [done, setDone] = useState('')
  const url = value?.url || ''

  const upload = async (file) => {
    if (!file) return
    setErr('')
    setDone('')
    setBusy(true)
    try {
      const pdf = await uploadContentPdf(blockKey, file)
      onChange(pdf)
      setDone(
        pdf.bytes > SLOW_PDF_BYTES
          ? `Uploaded. At ${fileSize(pdf.bytes)} it will be slow to open on a phone; a smaller copy of the PDF reads faster. Check it in the preview, then publish to put it on the site.`
          : 'Uploaded. Check it in the preview, then publish to put it on the site.',
      )
    } catch (e) {
      setErr(errorText(e, 'The PDF did not upload. Try again.'))
    } finally {
      setBusy(false)
      if (pick.current) pick.current.value = ''
    }
  }

  // The name it had on the computer it came from; for a file that ships with
  // the site, the last part of its address.
  const name = value?.name || lastPart(url)
  const facts = [value?.pages > 0 ? `${value.pages} ${value.pages === 1 ? 'page' : 'pages'}` : '', fileSize(value?.bytes)].filter(Boolean).join(' · ')

  return (
    <div>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex min-w-0 flex-1 basis-56 items-center gap-3 rounded-xl border border-line/10 bg-sunk px-4 py-3">
          <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0 text-accent" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M7 3h7l5 5v13H7V3Z" strokeLinejoin="round" />
            <path d="M14 3v5h5M9 13h6M9 17h6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {url ? (
            <div className="min-w-0">
              <p className="break-words text-sm font-medium text-ink">{name}</p>
              <p className="mt-0.5 text-xs text-soft/60">
                {facts && <span>{facts} · </span>}
                <a href={url} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent underline-offset-2 hover:text-ink hover:underline">
                  Open it
                </a>
              </p>
            </div>
          ) : (
            <p className="text-sm text-soft/55">No PDF yet</p>
          )}
        </div>
        {/* The button below is the control; the file input only holds the choice, so the keyboard does not stop on it. */}
        <input
          ref={pick}
          id={id}
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          tabIndex={-1}
          disabled={disabled || busy}
          onChange={(e) => upload(e.target.files?.[0])}
        />
        <button type="button" data-control={path} className={smallBtnCls} disabled={disabled || busy} onClick={() => pick.current?.click()}>
          {busy ? 'Reading and uploading…' : url ? 'Choose a new PDF' : 'Choose a PDF'}
        </button>
      </div>
      {/* Always in the page, so it is read out when the upload ends. */}
      <p role="status" className={done ? 'mt-2 text-xs font-medium text-ok' : 'sr-only'}>
        {done}
      </p>
      {err && (
        <div className="mt-2">
          <ErrorText>{err}</ErrorText>
        </div>
      )}
    </div>
  )
}

// One of the gallery's albums, or none. An album chosen earlier and since
// deleted stays in the list, marked, so saving does not silently drop it.
function AlbumControl({ value, onChange, id, disabled }) {
  const { albums, loading } = useGallery()
  const known = albums.some((a) => a.slug === value || a.aliases.includes(value))
  return (
    <select id={id} value={value || ''} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={inputCls}>
      <option value="">No album</option>
      {value && !known && <option value={value}>{loading ? value : `${value} (not in the gallery any more)`}</option>}
      {albums.map((a) => (
        <option key={a.slug} value={a.aliases.includes(value) ? value : a.slug}>
          {a.title} ({a.count} photos)
        </option>
      ))}
    </select>
  )
}

function Arrow({ up }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={up ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} />
    </svg>
  )
}

function ListControl({ field, value, onChange, path, errors, blockKey, disabled }) {
  const rows = asRows(value)
  const noun = field.itemLabel || 'row'
  const max = field.max || 50
  const titleField = field.fields.find((f) => f.name === field.titleField)
  // What a row is called in its header. A choice shows its label, not the stored value.
  const titleOf = (row) => {
    const raw = titleField ? String(row[titleField.name] || '').trim() : ''
    return titleField?.type === 'select' ? titleField.options.find((o) => o.value === raw)?.label || raw : raw
  }
  const box = useRef(null)
  const focusNext = useFocusNext(box)
  // The rows removed since the form was opened, each with its place (see withRemoved above).
  const [gone, setGone] = useState([])

  // Every change is made to the list as it stands when the change lands.
  const change = (fn) => onChange((was) => fn(asRows(was)))
  const setRow = (id, fn) =>
    change((list) => {
      const i = list.findIndex((r) => rowId(r) === id)
      // The row was removed while a picture for it was on its way.
      if (i < 0) return list
      const row = fn(list[i])
      rowIds.set(row, id)
      return list.map((r, j) => (j === i ? row : r))
    })
  const move = (id, by) => {
    change((list) => {
      const i = list.findIndex((r) => rowId(r) === id)
      const j = i + by
      if (i < 0 || j < 0 || j >= list.length) return list
      const next = [...list]
      next[i] = list[j]
      next[j] = list[i]
      return next
    })
    // The cursor goes with the row, so pressing again moves the same row on.
    // At the end of the list that button switches off, and the other one takes it.
    const row = `[data-row="${id}"]`
    focusNext(`${row} [data-move="${by < 0 ? 'up' : 'down'}"]:not(:disabled)`, `${row} [data-move]:not(:disabled)`)
  }
  const add = () => {
    const row = emptyRow(field)
    change((list) => (list.length >= max ? list : [...list, row]))
  }
  const remove = (i) => {
    const row = rows[i]
    const id = rowId(row)
    // The line names the row as its header did. The number alone would not tell
    // two lines apart: remove the second row twice and both were "2".
    const title = titleOf(row)
    const named = title.length > 48 ? `${title.slice(0, 45).trimEnd()}…` : title
    const said = `Removed ${noun} ${i + 1}${named ? `: “${named}”` : ''}.`
    change((list) => list.filter((r) => rowId(r) !== id))
    setGone((was) => withRemoved(was, i, { id, row, said }))
    // Onto Undo, which stands where the row was: a second press of the same key puts it back.
    focusNext(`[data-gone="${id}"] button`)
  }
  const restore = (g) => {
    change((list) => {
      if (list.length >= max || list.some((r) => rowId(r) === g.id)) return list
      const at = Math.min(g.at, list.length)
      return [...list.slice(0, at), g.row, ...list.slice(at)]
    })
    setGone((was) => withRestored(was, g.id))
    focusNext(`[data-row="${g.id}"]`)
  }

  const full = rows.length >= max
  const drawRow = (row, i) => {
    const id = rowId(row)
    const title = titleOf(row)
    return (
      <fieldset
        key={id}
        data-row={id}
        data-anchor={`${path}.${i}`}
        // Takes the cursor when Undo puts the row back.
        tabIndex={-1}
        className="min-w-0 rounded-2xl border border-line/10 bg-sunk/60 p-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-medical/60 sm:p-5"
      >
        <legend className="sr-only">
          {noun} {i + 1}
        </legend>
        <div className={rowHeadCls}>
          <p className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
            <span className="mr-2 text-soft/45">{i + 1}.</span>
            {title || <span className="font-normal text-soft/45">New {noun}</span>}
          </p>
          <button type="button" data-move="up" className={iconBtnCls} disabled={disabled || i === 0} onClick={() => move(id, -1)} aria-label={`Move ${noun} ${i + 1} up`} title="Move up">
            <Arrow up />
          </button>
          <button type="button" data-move="down" className={iconBtnCls} disabled={disabled || i === rows.length - 1} onClick={() => move(id, 1)} aria-label={`Move ${noun} ${i + 1} down`} title="Move down">
            <Arrow />
          </button>
          <button
            type="button"
            // The ! is needed: the round button's own hover colour comes later in the stylesheet and would win.
            className={`${iconBtnCls} hover:border-danger/50 hover:!text-danger`}
            disabled={disabled}
            onClick={() => remove(i)}
            aria-label={`Remove ${noun} ${i + 1}`}
            title="Remove"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="mt-4 space-y-4">
          <Fields
            fields={field.fields}
            doc={row}
            onChange={(fn) => setRow(id, fn)}
            errors={errors}
            prefix={`${path}.${i}.`}
            blockKey={blockKey}
            disabled={disabled}
          />
        </div>
      </fieldset>
    )
  }
  const drawGone = (g) => (
    // Named as a group, so a screen reader says what Undo would undo when the cursor lands on it.
    <div key={`gone-${g.id}`} data-gone={g.id} role="group" aria-label={g.said} className="rounded-2xl border border-dashed border-line/15 px-4 sm:px-5">
      {/* With the list full there is no room to put the row back; the line stays until there is. */}
      <UndoLine className="py-3" onUndo={full ? undefined : () => restore(g)}>
        {g.said}
      </UndoLine>
    </div>
  )

  // The rows in order, each removed one's line in the gap it left.
  const drawn = []
  for (let i = 0; i <= rows.length; i++) {
    for (const g of gone) if (Math.min(g.at, rows.length) === i) drawn.push(drawGone(g))
    if (i < rows.length) drawn.push(drawRow(rows[i], i))
  }

  return (
    <div ref={box} className="space-y-3">
      {drawn}
      <button type="button" data-control={path} className={smallBtnCls} disabled={disabled || full} onClick={add}>
        + Add a {noun}
      </button>
      {full && <p className={helpCls}>That is the most this part of the page holds ({max}).</p>}
    </div>
  )
}

function FieldRow({ field, value, onChange, path, errors, blockKey, disabled }) {
  const id = useId()
  const error = errors?.[path]
  const errId = error ? `${id}-err` : undefined

  // A tick box and not a switch: the choice waits for Save draft or Publish
  // like every other field, and a switch would say it had taken effect.
  if (field.type === 'toggle') {
    return (
      <div data-anchor={path}>
        <CheckField checked={Boolean(value)} onChange={onChange} label={field.label} hint={field.help} disabled={disabled} />
      </div>
    )
  }

  return (
    <div data-anchor={path}>
      <div className="flex items-end justify-between gap-3">
        {field.type === 'list' ? (
          <p className={panelTitleCls}>{field.label}</p>
        ) : (
          <label htmlFor={id} className={labelCls}>
            {field.label}
            {field.required && <span className="ml-1 font-normal text-soft/45">(needed)</span>}
          </label>
        )}
        {field.type !== 'list' && field.type !== 'select' && field.type !== 'image' && field.type !== 'pdf' && field.type !== 'album' && (
          <Count value={value} max={field.max} />
        )}
      </div>
      {field.help && <p className={helpCls}>{field.help}</p>}
      <div className="mt-2.5">
        {field.type === 'list' ? (
          <ListControl field={field} value={value} onChange={onChange} path={path} errors={errors} blockKey={blockKey} disabled={disabled} />
        ) : field.type === 'select' ? (
          <select id={id} value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={inputCls}>
            {(field.options || []).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : field.type === 'album' ? (
          <AlbumControl value={value} onChange={onChange} id={id} disabled={disabled} />
        ) : field.type === 'image' ? (
          <ImageControl field={field} value={value} onChange={onChange} blockKey={blockKey} id={id} path={path} disabled={disabled} />
        ) : field.type === 'pdf' ? (
          <PdfControl value={value} onChange={onChange} blockKey={blockKey} id={id} path={path} disabled={disabled} />
        ) : (
          <TextControl field={field} value={value} onChange={onChange} id={id} path={path} describedBy={errId} disabled={disabled} />
        )}
      </div>
      {field.type === 'markdown' && (
        <p className={helpCls}>
          Formatting: **bold**, *italic*, [link text](https://address), a line starting with “- ” for a list.
        </p>
      )}
      {error && (
        <div className="mt-1.5">
          <ErrorText id={errId}>{error}</ErrorText>
        </div>
      )}
    </div>
  )
}

// `onChange` takes a function of the record these fields belong to (the
// document, or one row of a list), and each field hands on a function of its
// own value, so a change never carries a copy of the record it started from.
function Fields({ fields, doc, onChange, errors, prefix = '', blockKey, disabled }) {
  return fields.map((field) => (
    <FieldRow
      key={field.name}
      field={field}
      value={doc?.[field.name]}
      onChange={(change) => onChange((was) => ({ ...was, [field.name]: applied(change, was?.[field.name]) }))}
      path={`${prefix}${field.name}`}
      errors={errors}
      blockKey={blockKey}
      disabled={disabled}
    />
  ))
}

export default function RecordEditor({ schema, doc, onChange, errors = {}, disabled = false }) {
  return (
    <div className="space-y-6">
      <Fields fields={schema.fields} doc={doc} onChange={onChange} errors={errors} blockKey={schema.key} disabled={disabled} />
    </div>
  )
}
