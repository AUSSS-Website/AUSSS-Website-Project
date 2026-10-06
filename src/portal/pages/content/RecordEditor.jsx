import { useId, useLayoutEffect, useRef, useState } from 'react'
import { emptyRow } from '../../../content/schema.js'
import { useGallery } from '../../../lib/gallery.js'
import { uploadContentImage } from '../../contentQueries.js'
import { ErrorText, Toggle, inputCls, outlineBtnCls } from '../../portalUi.jsx'

// The one form every edited part of the site uses. It draws a control for each
// field of a schema (src/content/schema.js lists the types) and reports the
// whole document on every change; it keeps no document state of its own, so
// the page around it decides what saving and publishing mean.
//
//   <RecordEditor schema={schema} doc={doc} onChange={setDoc} errors={errors} />
//
// `errors` is validateDoc's answer: { 'items.2.q': 'message' }.

const labelCls = 'block text-xs font-semibold uppercase tracking-[0.18em] text-accent'
const helpCls = 'mt-1 text-xs leading-relaxed text-soft/55'
const iconBtnCls =
  'grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line/15 text-soft/70 transition-colors hover:bg-veil/10 hover:text-ink disabled:opacity-30'

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
// through a slot (wrapped lines count, which a row count cannot know).
function GrowingTextarea({ value, minRows, ...rest }) {
  const ref = useRef(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + 2}px`
  }, [value])
  return <textarea ref={ref} value={value} rows={minRows} {...rest} />
}

function TextControl({ field, value, onChange, id, describedBy, disabled }) {
  const long = field.type === 'textarea' || field.type === 'markdown'
  const common = {
    id,
    value: value || '',
    disabled,
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

function ImageControl({ field, value, onChange, blockKey, id, disabled }) {
  const pick = useRef(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const upload = async (file) => {
    if (!file) return
    setErr('')
    setBusy(true)
    try {
      onChange(await uploadContentImage(blockKey, file, field.maxPx || 1600))
    } catch (e) {
      setErr(e?.message || 'The picture did not upload. Try again.')
    } finally {
      setBusy(false)
      if (pick.current) pick.current.value = ''
    }
  }

  return (
    <div>
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
        <div className="flex flex-wrap gap-2">
          <input
            ref={pick}
            id={id}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            disabled={disabled || busy}
            onChange={(e) => upload(e.target.files?.[0])}
          />
          <button
            type="button"
            className={outlineBtnCls}
            disabled={disabled || busy}
            onClick={() => pick.current?.click()}
          >
            {busy ? 'Uploading…' : value ? 'Replace picture' : 'Choose a picture'}
          </button>
          {value && (
            <button type="button" className={outlineBtnCls} disabled={disabled || busy} onClick={() => onChange('')}>
              Remove
            </button>
          )}
        </div>
      </div>
      <ErrorText>{err}</ErrorText>
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
  const rows = Array.isArray(value) ? value : []
  const noun = field.itemLabel || 'row'
  const max = field.max || 50
  const set = (i, row) => onChange(rows.map((r, j) => (j === i ? row : r)))
  const move = (i, by) => {
    const next = [...rows]
    const [row] = next.splice(i, 1)
    next.splice(i + by, 0, row)
    onChange(next)
  }

  return (
    <div className="space-y-3">
      {rows.map((row, i) => {
        const titleField = field.fields.find((f) => f.name === field.titleField)
        const raw = titleField ? String(row?.[titleField.name] || '').trim() : ''
        // A choice shows its label, not the stored value.
        const title = titleField?.type === 'select' ? titleField.options.find((o) => o.value === raw)?.label || raw : raw
        return (
          <fieldset key={i} className="min-w-0 rounded-2xl border border-line/10 bg-sunk/60 p-4 sm:p-5">
            <legend className="sr-only">
              {noun} {i + 1}
            </legend>
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
                <span className="mr-2 text-soft/45">{i + 1}.</span>
                {title || <span className="font-normal text-soft/45">New {noun}</span>}
              </p>
              <button type="button" className={iconBtnCls} disabled={disabled || i === 0} onClick={() => move(i, -1)} aria-label={`Move ${noun} ${i + 1} up`} title="Move up">
                <Arrow up />
              </button>
              <button type="button" className={iconBtnCls} disabled={disabled || i === rows.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${noun} ${i + 1} down`} title="Move down">
                <Arrow />
              </button>
              <button
                type="button"
                className={`${iconBtnCls} hover:border-danger/50 hover:text-danger`}
                disabled={disabled}
                onClick={() => onChange(rows.filter((_, j) => j !== i))}
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
                onChange={(next) => set(i, next)}
                errors={errors}
                prefix={`${path}.${i}.`}
                blockKey={blockKey}
                disabled={disabled}
              />
            </div>
          </fieldset>
        )
      })}
      <button
        type="button"
        className={outlineBtnCls}
        disabled={disabled || rows.length >= max}
        onClick={() => onChange([...rows, emptyRow(field)])}
      >
        + Add a {noun}
      </button>
      {rows.length >= max && <p className={helpCls}>That is the most this part of the page holds ({max}).</p>}
    </div>
  )
}

function FieldRow({ field, value, onChange, path, errors, blockKey, disabled }) {
  const id = useId()
  const error = errors?.[path]
  const errId = error ? `${id}-err` : undefined

  if (field.type === 'toggle') {
    return (
      <div className="flex items-start justify-between gap-6">
        <div>
          <p className="text-sm font-semibold text-ink">{field.label}</p>
          {field.help && <p className={helpCls}>{field.help}</p>}
        </div>
        <Toggle checked={Boolean(value)} onChange={onChange} label={field.label} disabled={disabled} />
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        {field.type === 'list' ? (
          <p className={labelCls}>{field.label}</p>
        ) : (
          <label htmlFor={id} className={labelCls}>
            {field.label}
            {field.required && <span className="ml-1 normal-case tracking-normal text-soft/45">(needed)</span>}
          </label>
        )}
        {field.type !== 'list' && field.type !== 'select' && field.type !== 'image' && field.type !== 'album' && (
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
          <ImageControl field={field} value={value} onChange={onChange} blockKey={blockKey} id={id} disabled={disabled} />
        ) : (
          <TextControl field={field} value={value} onChange={onChange} id={id} describedBy={errId} disabled={disabled} />
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

function Fields({ fields, doc, onChange, errors, prefix = '', blockKey, disabled }) {
  return fields.map((field) => (
    <FieldRow
      key={field.name}
      field={field}
      value={doc?.[field.name]}
      onChange={(v) => onChange({ ...doc, [field.name]: v })}
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
