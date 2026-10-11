import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import useLeaveWarning from '../../../hooks/useLeaveWarning.js'
import usePageTitle from '../../../hooks/usePageTitle.js'
import { pressCls } from '../../../lib/motion.js'
import {
  galleryError,
  isAcceptedImage,
  purgeExpired,
  uploadPhoto,
  useAlbumMutations,
  useAlbumPhotos,
  useAlbums,
  usePhotoMutations,
} from '../../galleryQueries.js'
import {
  ErrorText,
  Field,
  PageHeader,
  PageLoading,
  Panel,
  SaveStatus,
  Toggle,
  inputCls,
  outlineBtnCls,
  primaryBtnCls,
} from '../../portalUi.jsx'
import { GalleryGate } from './GalleryPage.jsx'
import { ConfirmButton, ShareLinkButton, siteAlbumUrl, tapCls } from './galleryUi.jsx'

// /portal/gallery/:slug. One album: its details and link, the drop zone that
// adds photos, the photo grid (cover, featured banner, hide, remove) and the
// bin. Every change is live on the public site as soon as it is saved.
//
// What an editor does to a photo shows at once and is saved behind it, so one
// photo never holds up another; if a save fails the photo goes back to how it
// was and says so itself.

const MAX_PARALLEL = 3

// The small pill of a photo's own buttons. A finger gets 44px each way.
const smallBtn = `inline-flex items-center justify-center rounded-full border border-line/15 px-2.5 py-1 text-center text-2xs font-semibold text-ink ${pressCls} hover:bg-veil/10 disabled:opacity-40 ${tapCls} [@media(pointer:coarse)]:min-w-[44px]`

// The back link is one line of small capitals. Its ::after gives a finger 44px
// of height to land on, centred on the words, and the look stays as it is.
const backHitCls =
  "relative after:absolute after:inset-x-0 after:top-1/2 after:h-[44px] after:-translate-y-1/2 after:content-['']"

// `map` without the entry `key`; `map` itself when it has none.
function without(map, key) {
  if (!(key in map)) return map
  const rest = { ...map }
  delete rest[key]
  return rest
}

// The id of a photo's tile in the page, in the grid or in the bin.
const tileId = (photoId) => `photo-${photoId}`

// True when the keyboard is nowhere: the browser leaves it on the page itself
// when the element that had it is taken away.
function keyboardDropped() {
  const held = document.activeElement
  return !held || held === document.body
}

// True when `el` got the keyboard by a key and shows it, false when it was
// clicked or tapped. A browser too old to say is taken to mean a key.
function reachedByKey(el) {
  try {
    return el.matches(':focus-visible')
  } catch {
    return true
  }
}

// ---- details form ----------------------------------------------------------

const DETAILS = ['title', 'blurb', 'slug']

// `form` with every field that still holds `from`'s value given `to`'s. A
// field that has been typed in since is left as it is.
function follow(form, from, to) {
  const next = { ...form }
  for (const field of DETAILS) if (form[field] === from[field]) next[field] = to[field]
  return DETAILS.every((field) => next[field] === form[field]) ? form : next
}

function DetailsForm({ album }) {
  const { update, set } = useAlbumMutations()
  const [form, setForm] = useState({ title: album.title, blurb: album.blurb, slug: album.slug })
  const [saved, setSaved] = useState(false)
  const [switchError, setSwitchError] = useState('')
  // The form follows the album when it changes (this form's own save, or
  // another editor's), field by field: typing that is not saved yet stays.
  const followed = useRef(album)
  useEffect(() => {
    const was = followed.current
    followed.current = album
    setForm((f) => follow(f, was, album))
  }, [album])

  const dirty = form.title !== album.title || form.blurb !== album.blurb || form.slug !== album.slug

  // Typing again answers the last save's error, so it is taken down.
  const edit = (fields) => {
    setForm((f) => ({ ...f, ...fields }))
    if (update.error) update.reset()
  }

  // A new link changes this page's address: the page follows the album there
  // by itself (AlbumEditorPage).
  const submit = async (e) => {
    e.preventDefault()
    setSaved(false)
    const sent = { title: form.title, blurb: form.blurb, slug: form.slug }
    let row
    try {
      row = await update.mutateAsync({ id: album.id, patch: sent })
    } catch {
      // update.error says why, on the form.
      return
    }
    // The database tidies what it is given (spaces trimmed, the link made
    // lower-case with hyphens): the form shows what was kept, except in a
    // field that was typed in again while the save was on its way.
    setForm((f) => follow(f, sent, row))
    setSaved(true)
  }

  const saveError = update.error ? galleryError(update.error, 'Couldn’t save the album.') : ''
  // The one refusal that is about a single field: the link is another album's
  // (the database raises it as 23505). It is said under that field.
  const linkTaken = update.error?.code === '23505'

  // The switch moves at once; if the save fails it goes back and says so.
  const publish = (on) => {
    setSwitchError('')
    set
      .mutateAsync({ id: album.id, patch: { published: on } })
      .catch((err) => setSwitchError(galleryError(err, on ? 'Couldn’t publish the album.' : 'Couldn’t hide the album.')))
  }

  return (
    <Panel title="Album" className="mb-6">
      <form onSubmit={submit} className="mt-4 grid gap-5 sm:grid-cols-2">
        <Field label="Title" htmlFor="album-title">
          <input
            id="album-title"
            className={`${inputCls} ${tapCls}`}
            value={form.title}
            onChange={(e) => edit({ title: e.target.value })}
            maxLength={120}
            required
          />
        </Field>
        <Field
          label="Link"
          htmlFor="album-slug"
          hint="Lower-case letters, digits and hyphens. A link shared before a rename keeps working."
        >
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-xs text-soft/50">/gallery/</span>
            <input
              id="album-slug"
              className={`${inputCls} ${tapCls}`}
              value={form.slug}
              onChange={(e) => edit({ slug: e.target.value })}
              maxLength={60}
              pattern="[A-Za-z0-9 \-]+"
              aria-invalid={linkTaken || undefined}
              aria-describedby={linkTaken ? 'album-slug-error' : undefined}
            />
          </div>
          {linkTaken && (
            <div className="mt-2">
              <ErrorText id="album-slug-error">{saveError}</ErrorText>
            </div>
          )}
        </Field>
        <div className="sm:col-span-2">
          <Field label="Blurb" htmlFor="album-blurb" hint="One or two sentences under the title, also the text of the link preview.">
            <textarea
              id="album-blurb"
              className={`${inputCls} min-h-[4.5rem]`}
              value={form.blurb}
              onChange={(e) => edit({ blurb: e.target.value })}
              maxLength={500}
            />
          </Field>
        </div>
        {saveError && !linkTaken && (
          <div className="sm:col-span-2">
            <ErrorText>{saveError}</ErrorText>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <button type="submit" className={`${primaryBtnCls} ${tapCls} min-w-[6.5rem]`} disabled={!dirty || update.isPending}>
            {update.isPending ? 'Saving…' : 'Save'}
          </button>
          <SaveStatus dirty={dirty} saved={saved} />
        </div>
      </form>

      {/* The switch is no part of the form: it takes effect the moment it is
          flipped, where the fields above wait for Save. So it stands apart. */}
      <div className="mt-5 border-t border-line/10 pt-3">
        <label className="flex min-h-[44px] cursor-pointer items-center gap-3 text-sm text-soft/70">
          <Toggle checked={album.published} onChange={publish} label="Published" />
          {album.published ? 'Published' : 'Hidden from the site'}
        </label>
        <ErrorText>{switchError}</ErrorText>
      </div>
    </Panel>
  )
}

// ---- upload ----------------------------------------------------------------

// Runs the queue with a few uploads in flight; each item reports its own state.
// A photo that fails stays in the list with its file, so it can be sent again.
//
// The uploads are not tied to this page being on screen: an editor who goes to
// another portal page leaves the queued photos going up, unseen. Closing or
// reloading the tab does stop them, which is what the page warns about.
function useUploadQueue(albumId, nextSortOrder, onUploaded) {
  const [items, setItems] = useState([])
  const queue = useRef([])
  // The keys waiting or going up, so that one photo is never queued twice.
  const pending = useRef(new Set())
  const active = useRef(0)
  const order = useRef(nextSortOrder)
  useEffect(() => {
    order.current = Math.max(order.current, nextSortOrder)
  }, [nextSortOrder])

  const mark = useCallback(
    (key, fields) => setItems((prev) => prev.map((x) => (x.key === key ? { ...x, ...fields } : x))),
    [],
  )

  // Starts uploads until MAX_PARALLEL are in flight or nothing is waiting, and
  // again each time one ends.
  const pump = useCallback(
    function run() {
      while (active.current < MAX_PARALLEL && queue.current.length > 0) {
        const item = queue.current.shift()
        active.current++
        mark(item.key, { state: 'uploading' })
        uploadPhoto(albumId, item.file, order.current++)
          .then(
            () => {
              mark(item.key, { state: 'done' })
              onUploaded()
            },
            (err) => mark(item.key, { state: 'failed', error: galleryError(err, 'This photo could not be uploaded.') }),
          )
          .finally(() => {
            pending.current.delete(item.key)
            active.current--
            run()
          })
      }
    },
    [albumId, onUploaded, mark],
  )

  const enqueue = useCallback(
    (key, file) => {
      if (pending.current.has(key)) return false
      pending.current.add(key)
      queue.current.push({ key, file })
      return true
    },
    [],
  )

  const add = useCallback(
    (files) => {
      const fresh = []
      for (const file of files) {
        const key = `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`
        if (!isAcceptedImage(file)) {
          fresh.push({ key, name: file.name, state: 'failed', error: 'Not a photo (JPEG, PNG, WebP or HEIC)' })
          continue
        }
        fresh.push({ key, name: file.name, state: 'queued', file })
        enqueue(key, file)
      }
      setItems((prev) => [...prev, ...fresh])
      pump()
    },
    [enqueue, pump],
  )

  // Sends failed photos again: `again` is the items to retry. One that is not
  // a photo has no file to send and is left as it is.
  const retry = useCallback(
    (again) => {
      const keys = new Set()
      for (const x of again) {
        if (x.state === 'failed' && x.file && enqueue(x.key, x.file)) keys.add(x.key)
      }
      setItems((prev) => prev.map((x) => (keys.has(x.key) ? { ...x, state: 'queued', error: undefined } : x)))
      pump()
    },
    [enqueue, pump],
  )

  // Takes everything that is over out of the list, added or failed.
  const clear = useCallback(
    () => setItems((prev) => prev.filter((x) => x.state === 'queued' || x.state === 'uploading')),
    [],
  )

  return { items, add, retry, clear }
}

function DropZone({ onFiles, busy, chooseRef }) {
  const [over, setOver] = useState(false)
  const inputRef = useRef(null)

  // A photo let go of beside the box, and not in it, would make the browser
  // open that file in place of this page, and take a running upload with it.
  // Anywhere outside the box a dragged file now cannot be dropped at all (the
  // pointer shows as much); the box has answered for itself by the time the
  // event reaches the window.
  useEffect(() => {
    const refuse = (e) => {
      if (e.defaultPrevented || !Array.from(e.dataTransfer?.types || []).includes('Files')) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'none'
    }
    window.addEventListener('dragover', refuse)
    window.addEventListener('drop', refuse)
    return () => {
      window.removeEventListener('dragover', refuse)
      window.removeEventListener('drop', refuse)
    }
  }, [])

  const onDrop = (e) => {
    e.preventDefault()
    setOver(false)
    const files = Array.from(e.dataTransfer?.files || [])
    if (files.length) onFiles(files)
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      // Passing over the words and the button inside the box is not leaving it.
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOver(false)
      }}
      onDrop={onDrop}
      className={`rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${
        over ? 'border-medical bg-medical/10' : 'border-line/15 bg-veil/[0.03]'
      }`}
    >
      <p className="text-sm text-soft/80">
        Drop photos here{busy ? ' (uploads are running)' : ''}
      </p>
      <p className="mt-1 text-xs text-soft/50">
        JPEG, PNG, WebP or HEIC. Each photo is resized in your browser before it is uploaded, so full-size phone photos are fine.
      </p>
      <button
        ref={chooseRef}
        type="button"
        className={`${outlineBtnCls} ${tapCls} mt-4`}
        onClick={() => inputRef.current?.click()}
      >
        Choose files
      </button>
      {/* The button above is the control; the input itself is out of sight, so
          it is kept out of the keyboard's way too. */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*,.heic,.heif"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const files = Array.from(e.target.files || [])
          e.target.value = ''
          if (files.length) onFiles(files)
        }}
      />
    </div>
  )
}

// How the uploads stand, and each photo that failed with a way to send it
// again. The counts change with every photo, too often to read aloud: a screen
// reader hears that the uploads have begun and how they ended.
function UploadList({ items, onRetry, onClear }) {
  const summary = useRef(null)
  const done = items.filter((x) => x.state === 'done').length
  const failed = items.filter((x) => x.state === 'failed')
  const active = items.length - done - failed.length
  const retryable = failed.filter((x) => x.file)
  const outcome = [done > 0 && `${done} added.`, failed.length > 0 && `${failed.length} failed.`].filter(Boolean).join(' ')

  // The button that was pressed leaves the list with its photo; the keyboard
  // goes to the line that says how things stand now.
  const retry = (again) => {
    onRetry(again)
    summary.current?.focus()
  }

  return (
    <div className="text-sm">
      <p role="status" className="sr-only">
        {active > 0 ? 'Uploading photos.' : outcome}
      </p>
      {items.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <p id="album-uploads" ref={summary} tabIndex={-1} className="text-soft/70 focus:outline-none">
            {active > 0 && `${active} uploading… `}
            {outcome}
          </p>
          {retryable.length > 1 && (
            <button type="button" className={smallBtn} onClick={() => retry(retryable)}>
              Retry all
            </button>
          )}
          {active === 0 && (
            <button type="button" className={smallBtn} onClick={onClear}>
              Clear
            </button>
          )}
        </div>
      )}
      {failed.length > 0 && (
        <ul className="mt-2 grid gap-1.5 text-xs">
          {failed.map((x) => (
            <li key={x.key} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="min-w-0 break-words text-danger">
                {x.name}: {x.error}
              </span>
              {x.file && (
                <button type="button" className={smallBtn} onClick={() => retry([x])} aria-label={`Retry ${x.name}`}>
                  Retry
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---- photo grid ------------------------------------------------------------

// What went wrong with a photo's last change, on the photo itself.
function PhotoError({ children, className = '' }) {
  if (!children) return null
  return (
    <p role="alert" className={`text-xs text-danger ${className}`}>
      {children}
    </p>
  )
}

// A photo's tile can be handed the keyboard when the button it was on has gone
// (see `strand` in AlbumEditor), and then shows a frame. The frame is an
// ::after laid over the whole tile: an outline of the tile's own would be
// painted under the picture, and one outside it is cut off by the rounded card.
const tileFocusCls =
  "relative rounded-[inherit] focus:outline-none focus-visible:after:pointer-events-none focus-visible:after:absolute focus-visible:after:inset-0 focus-visible:after:rounded-[inherit] focus-visible:after:border-2 focus-visible:after:border-accent focus-visible:after:content-['']"

function PhotoCard({ p, n, of, isCover, onAction, error }) {
  // What is typed in the label field and not saved yet; null while the field
  // shows the photo's own label. It is kept until its save has landed. A save
  // that fails puts the photo's old label back, and a field that only followed
  // the photo would lose the words with it: they stay, to be sent again.
  const [draft, setDraft] = useState(null)
  // The words on their way to be saved, so that Enter and then Tab send them once.
  const sending = useRef(null)
  useEffect(() => {
    if (!p.featured) setDraft(null)
  }, [p.featured])

  const saveLabel = () => {
    if (draft === null || draft === sending.current) return
    if (draft === p.label) {
      setDraft(null)
      return
    }
    const sent = draft
    sending.current = sent
    onAction('label', sent).then((saved) => {
      if (sending.current === sent) sending.current = null
      if (saved) setDraft((d) => (d === sent ? null : d))
    })
  }

  return (
    <li className={`overflow-hidden rounded-2xl border bg-card ${p.hidden ? 'border-amber-400/40' : 'border-line/10'}`}>
      {/* The photos have no descriptions, so the group says which one its
          buttons belong to. */}
      <div id={tileId(p.id)} role="group" aria-label={`Photo ${n} of ${of}`} tabIndex={-1} className={tileFocusCls}>
        <div className="relative aspect-square bg-page">
          <img
            src={p.thumb}
            alt=""
            loading="lazy"
            className={`h-full w-full object-cover ${p.hidden ? 'opacity-40 grayscale' : ''}`}
          />
          <div className="absolute left-2 top-2 flex flex-wrap gap-1">
            {isCover && <Badge>Cover</Badge>}
            {p.featured && <Badge>Featured</Badge>}
            {p.hidden && <Badge tone="warn">Hidden</Badge>}
          </div>
        </div>
        <div className="grid gap-2 p-3">
          {p.featured && (
            <input
              className={`${inputCls} ${tapCls} text-xs`}
              value={draft ?? p.label}
              placeholder="Banner label, e.g. Delegation"
              maxLength={80}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={saveLabel}
              // Enter saves, as leaving the field does, and the keyboard stays in
              // the field. Not the Enter that ends a word being composed.
              onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && saveLabel()}
              aria-label="Banner label"
            />
          )}
          <div className="flex flex-wrap gap-1.5">
            {!isCover && !p.hidden && (
              <button type="button" data-act="cover" className={smallBtn} onClick={() => onAction('cover')}>
                Set as cover
              </button>
            )}
            {!p.hidden && (
              <button type="button" data-act="featured" className={smallBtn} onClick={() => onAction('featured', !p.featured)}>
                {p.featured ? 'Unfeature' : 'Feature'}
              </button>
            )}
            <button type="button" data-act="hidden" className={smallBtn} onClick={() => onAction('hidden', !p.hidden)}>
              {p.hidden ? 'Show' : 'Hide'}
            </button>
            <button type="button" data-act="bin" className={smallBtn} onClick={() => onAction('bin')}>
              Remove
            </button>
          </div>
          <PhotoError>{error}</PhotoError>
        </div>
      </div>
    </li>
  )
}

function Badge({ children, tone = 'ok' }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-3xs font-bold uppercase tracking-[0.15em] ${
        tone === 'warn' ? 'bg-amber-400/90 text-forest-950' : 'bg-cta text-on-cta'
      }`}
    >
      {children}
    </span>
  )
}

function Bin({ photos, errors, purging, onRestore, onPurge }) {
  if (photos.length === 0) return null
  return (
    <Panel title="Removed photos" className="mt-8">
      <p className="mt-3 text-xs text-soft/55">
        Not on the site. Restore a photo that was removed by mistake; anything still here after 30 days is deleted for good.
      </p>
      {/* Two to a row on a narrow phone: three left a cell narrower than its own buttons. */}
      <ul className="mt-4 grid grid-cols-2 gap-3 min-[440px]:grid-cols-3 sm:grid-cols-5 lg:grid-cols-8">
        {photos.map((p, i) => (
          <li key={p.id} className="overflow-hidden rounded-xl border border-line/10 bg-page">
            <div
              id={tileId(p.id)}
              role="group"
              aria-label={`Removed photo ${i + 1} of ${photos.length}`}
              tabIndex={-1}
              className={tileFocusCls}
            >
              <img src={p.thumb} alt="" loading="lazy" className="aspect-square w-full object-cover opacity-60" />
              <div className="flex flex-wrap gap-1 p-2">
                <button
                  type="button"
                  data-act="restore"
                  className={smallBtn}
                  onClick={() => onRestore(p)}
                  disabled={purging.has(p.id)}
                >
                  Restore
                </button>
                {/* The cell is about 90px wide: the button grows into its
                    longer wording when armed, and does not hold room for it. */}
                <ConfirmButton
                  label="Delete"
                  confirmLabel="Click again to delete for good"
                  busyLabel="Deleting…"
                  busy={purging.has(p.id)}
                  onConfirm={() => onPurge(p)}
                  className={smallBtn}
                />
              </div>
              <PhotoError className="px-2 pb-2">{errors[p.id]}</PhotoError>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

// ---- page ------------------------------------------------------------------

// What each of a photo's buttons changes on its row, and the words for when
// the change does not save.
const CHANGES = {
  featured: (on) => [{ featured: on }, on ? 'Couldn’t feature this photo.' : 'Couldn’t unfeature this photo.'],
  hidden: (on) => [{ hidden: on }, on ? 'Couldn’t hide this photo.' : 'Couldn’t show this photo.'],
  label: (text) => [{ label: text }, 'Couldn’t save the label.'],
  bin: () => [{ deleted_at: new Date().toISOString(), featured: false }, 'Couldn’t remove this photo.'],
  restore: () => [{ deleted_at: null }, 'Couldn’t restore this photo.'],
}

function AlbumEditor({ album, onDeleting }) {
  const navigate = useNavigate()
  const photosQ = useAlbumPhotos(album.id)
  const { update: updatePhoto, purge, reload } = usePhotoMutations(album.id)
  const { set: setAlbum, remove: removeAlbum } = useAlbumMutations()

  // The bin empties itself: anything removed more than 30 days ago goes now.
  useEffect(() => {
    purgeExpired(album.id)
      .then((n) => n > 0 && reload())
      .catch(() => {
        /* the next visit tries again */
      })
  }, [album.id, reload])

  const all = useMemo(() => photosQ.data || [], [photosQ.data])
  const live = all.filter((p) => !p.deleted_at)
  const binned = all.filter((p) => p.deleted_at)
  const nextSort = live.reduce((m, p) => Math.max(m, p.sort_order + 1), 0)
  const uploads = useUploadQueue(album.id, nextSort, reload)
  const uploading = uploads.items.some((x) => x.state === 'queued' || x.state === 'uploading')
  const choose = useRef(null)

  // Closing or reloading the tab would cut the uploads off: the browser asks first.
  useLeaveWarning(uploading)

  // What went wrong with each photo's last change, by photo id, and the photos
  // being deleted for good. Kept by photo, so that one photo's trouble or wait
  // is shown on that photo and holds up no other.
  const [errors, setErrors] = useState({})
  const [purging, setPurging] = useState(() => new Set())

  // `work` is the save on its way. The photo's last error is taken down now,
  // and this one's put up if it fails. Resolves to whether it was saved.
  const attempt = (id, work, fallback) => {
    setErrors((e) => without(e, id))
    return work.then(
      () => true,
      (err) => {
        setErrors((e) => ({ ...e, [id]: galleryError(err, fallback) }))
        return false
      },
    )
  }

  // Where the keyboard goes when a change takes its button away. A photo that
  // leaves the grid or the bin takes its buttons with it, "Set as cover" goes
  // once the photo is the cover, and a photo that changes place is lifted out
  // of the page and set down again: each would leave the keyboard on the page
  // itself, to start again from the top. `strand` notes, before the change,
  // that the keyboard is on that photo's buttons. Once the photos are drawn
  // again it is put back: on the same button if that is still there, else on
  // the photo's tile, else on the tile that took its place. A tile and not one
  // of its buttons, so that a key held down does not go on to the next photo.
  // The page scrolls to the place only when a key was used (`byKey`): under a
  // pointer it stays where it is.
  const stranded = useRef(null)
  const strand = (p, kind) => {
    const held = document.activeElement
    if (!document.getElementById(tileId(p.id))?.contains(held)) return
    const inBin = Boolean(p.deleted_at)
    const index = (inBin ? binned : live).findIndex((x) => x.id === p.id)
    stranded.current = { id: p.id, kind, inBin, index, byKey: reachedByKey(held) }
  }
  useEffect(() => {
    const s = stranded.current
    if (!s) return
    const tile = document.getElementById(tileId(s.id))
    const list = all.filter((p) => Boolean(p.deleted_at) === s.inBin)
    const here = list.some((p) => p.id === s.id)
    // A photo being deleted for good stays where it is until the server has
    // answered: its tile is waited for.
    if (s.kind === 'purge' && here && (keyboardDropped() || tile?.contains(document.activeElement))) return
    stranded.current = null
    // Still on a button, or gone elsewhere by the editor's own doing.
    if (!keyboardDropped()) return
    const grid = all.filter((p) => !p.deleted_at)
    const near = list[Math.min(s.index, list.length - 1)] || (s.inBin ? grid[grid.length - 1] : null)
    const target = here
      ? tile?.querySelector(`[data-act="${s.kind}"]:not(:disabled)`) || tile
      : near
        ? document.getElementById(tileId(near.id))
        : choose.current
    target?.focus({ preventScroll: !s.byKey })
  }, [all, album.cover_photo_id])

  const act = (p, kind, value) => {
    strand(p, kind)
    if (kind === 'cover') {
      return attempt(p.id, setAlbum.mutateAsync({ id: album.id, patch: { cover_photo_id: p.id } }), 'Couldn’t set the cover.')
    }
    const [patch, fallback] = CHANGES[kind](value)
    return attempt(p.id, updatePhoto.mutateAsync({ id: p.id, patch }), fallback)
  }

  const purgePhoto = (p) => {
    strand(p, 'purge')
    setPurging((ids) => new Set(ids).add(p.id))
    attempt(p.id, purge.mutateAsync(p), 'Couldn’t delete this photo.').then((deleted) => {
      setPurging((ids) => {
        const rest = new Set(ids)
        rest.delete(p.id)
        return rest
      })
      // The photo is still there, with its error: the keyboard goes back to it.
      const s = stranded.current
      if (!deleted && s?.id === p.id) {
        stranded.current = null
        if (keyboardDropped()) document.getElementById(tileId(p.id))?.focus({ preventScroll: !s.byKey })
      }
    })
  }

  // The album leaves the list a moment before the address changes; the page
  // is told, so that it does not say "No album at…" in between.
  const deleteAlbum = async () => {
    onDeleting(true)
    try {
      await removeAlbum.mutateAsync(album.id)
    } catch {
      // removeAlbum.error says why, under the button.
      onDeleting(false)
      return
    }
    navigate('/portal/gallery', { replace: true })
  }

  return (
    <>
      <PageHeader
        eyebrow={
          uploading ? (
            // Going back now would take the list of uploads off the screen with
            // photos still going up, and any that fail with it. The link is
            // off until they are done, and says so.
            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <a
                role="link"
                aria-disabled="true"
                aria-describedby="album-uploads"
                className="cursor-not-allowed whitespace-nowrap opacity-50"
              >
                &larr; All albums
              </a>
              <span className="font-normal normal-case tracking-normal text-soft/60">when the uploads have finished</span>
            </span>
          ) : (
            <Link to="/portal/gallery" className={`${backHitCls} hover:text-ink`}>
              &larr; All albums
            </Link>
          )
        }
        title={album.title}
        subtitle={siteAlbumUrl(album.slug)}
        action={
          <div className="flex flex-wrap gap-2">
            <ShareLinkButton slug={album.slug} />
            <Link
              to={`/gallery/${album.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className={`${outlineBtnCls} ${tapCls}`}
            >
              View on the site ↗
            </Link>
          </div>
        }
      />

      <DetailsForm album={album} />

      <Panel title="Photos" className="mb-6">
        <div className="mt-4">
          <DropZone onFiles={uploads.add} busy={uploading} chooseRef={choose} />
          <UploadList
            items={uploads.items}
            onRetry={uploads.retry}
            onClear={() => {
              uploads.clear()
              // The Clear button goes with the list; the keyboard goes back to the drop zone.
              choose.current?.focus()
            }}
          />
        </div>
        {/* Photos already on screen stay there if reading them again fails:
            the error is for an album that could not be read at all. */}
        {photosQ.isPending ? (
          <PageLoading />
        ) : !photosQ.data ? (
          <div className="mt-6">
            <ErrorText>{galleryError(photosQ.error, 'Couldn’t load the photos.')}</ErrorText>
          </div>
        ) : live.length === 0 ? (
          <p className="mt-6 text-sm text-soft/60">
            No photos yet. The album appears on the site once it has one.
          </p>
        ) : (
          <>
            <p className="mt-6 text-xs text-soft/55">
              {live.length} {live.length === 1 ? 'photo' : 'photos'}. The cover is the album card on the gallery page; a
              featured photo shows as a wide banner above the grid.
            </p>
            <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {live.map((p, i) => (
                <PhotoCard
                  key={p.id}
                  p={p}
                  n={i + 1}
                  of={live.length}
                  isCover={p.id === album.cover_photo_id}
                  onAction={(kind, value) => act(p, kind, value)}
                  error={errors[p.id]}
                />
              ))}
            </ul>
          </>
        )}
      </Panel>

      <Bin
        photos={binned}
        errors={errors}
        purging={purging}
        onRestore={(p) => act(p, 'restore')}
        onPurge={purgePhoto}
      />

      <Panel title="Delete album" className="mt-8">
        <p className="mt-3 text-xs text-soft/55">
          Removes the album, all its photos and its link from the site. This cannot be undone.
        </p>
        <div className="mt-4">
          <ConfirmButton
            label="Delete this album"
            confirmLabel="Click again to delete the album and its photos"
            busyLabel="Deleting…"
            busy={removeAlbum.isPending}
            onConfirm={deleteAlbum}
            disabled={uploading}
            className={`${outlineBtnCls} ${tapCls}`}
            keepWidth
          />
        </div>
        {uploading && <p className="mt-3 text-xs text-soft/55">The album can be deleted once the uploads have finished.</p>}
        {removeAlbum.error && (
          <div className="mt-3">
            <ErrorText>{galleryError(removeAlbum.error, 'Couldn’t delete the album.')}</ErrorText>
          </div>
        )}
      </Panel>
    </>
  )
}

export default function AlbumEditorPage() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const albums = useAlbums()
  const list = albums.data || []
  // The album is found by the link in the address. Renaming the link changes
  // the list first and the address a moment later, and in between the address
  // names no album: the one that is open stays open, by its id, so the editor
  // (and an upload on its way) is not torn down and built again.
  const [openId, setOpenId] = useState(null)
  const named = list.find((a) => a.slug === slug)
  if (named && named.id !== openId) setOpenId(named.id)
  const album = named || list.find((a) => a.id === openId)
  usePageTitle(album ? `Edit ${album.title}` : 'Edit album')
  // True from the moment "Delete this album" is confirmed. Once deleted, the
  // album is gone from the list a moment before the page has moved on to the
  // shelf, and for that moment there is nothing to say about it.
  const [deleting, setDeleting] = useState(false)

  // The address follows the album's link, whoever renamed it.
  const link = album?.slug
  useEffect(() => {
    if (link && link !== slug) navigate(`/portal/gallery/${link}`, { replace: true })
  }, [link, slug, navigate])

  return (
    <GalleryGate>
      {/* An album already open stays open if reading the list again fails. */}
      {albums.isPending ? (
        <PageLoading />
      ) : !albums.data ? (
        <Panel>
          <ErrorText>{galleryError(albums.error, 'Couldn’t load the album.')}</ErrorText>
        </Panel>
      ) : !album ? (
        deleting ? null : (
          <Panel>
            <p className="text-sm text-soft/70">No album at /gallery/{slug}.</p>
            {/* The padding is the link's own, for a finger; the margins take it back out of the layout. */}
            <Link to="/portal/gallery" className="-mb-3 mt-1 inline-block py-3 text-sm font-semibold text-accent hover:text-ink">
              &larr; All albums
            </Link>
          </Panel>
        )
      ) : (
        <AlbumEditor key={album.id} album={album} onDeleting={setDeleting} />
      )}
    </GalleryGate>
  )
}
