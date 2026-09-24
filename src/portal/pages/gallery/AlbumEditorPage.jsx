import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import usePageTitle from '../../../hooks/usePageTitle.js'
import {
  isAcceptedImage,
  purgeExpired,
  uploadPhoto,
  useAlbumMutations,
  useAlbumPhotos,
  useAlbums,
  usePhotoMutations,
} from '../../galleryQueries.js'
import {
  Centered,
  ErrorText,
  Field,
  PageHeader,
  Panel,
  Spinner,
  Toggle,
  inputCls,
  outlineBtnCls,
  primaryBtnCls,
} from '../../portalUi.jsx'
import { GalleryGate } from './GalleryPage.jsx'
import { ConfirmButton, ShareLinkButton, siteAlbumUrl } from './galleryUi.jsx'

// /portal/gallery/:slug. One album: its details and link, the drop zone that
// adds photos, the photo grid (cover, featured banner, hide, remove) and the
// bin. Every change is live on the public site as soon as it is saved.

const MAX_PARALLEL = 3

// ---- details form ----------------------------------------------------------

function DetailsForm({ album }) {
  const navigate = useNavigate()
  const { update } = useAlbumMutations()
  const [form, setForm] = useState({ title: album.title, blurb: album.blurb, slug: album.slug })
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    setForm({ title: album.title, blurb: album.blurb, slug: album.slug })
  }, [album.id, album.title, album.blurb, album.slug])

  const dirty = form.title !== album.title || form.blurb !== album.blurb || form.slug !== album.slug

  const submit = async (e) => {
    e.preventDefault()
    const row = await update.mutateAsync({ id: album.id, patch: { title: form.title, blurb: form.blurb, slug: form.slug } })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    if (row.slug !== album.slug) navigate(`/portal/gallery/${row.slug}`, { replace: true })
  }

  return (
    <Panel title="Album" className="mb-6">
      <form onSubmit={submit} className="mt-4 grid gap-5 sm:grid-cols-2">
        <Field label="Title" htmlFor="album-title">
          <input
            id="album-title"
            className={inputCls}
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
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
            <span className="shrink-0 text-xs text-silver/50">/gallery/</span>
            <input
              id="album-slug"
              className={inputCls}
              value={form.slug}
              onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
              maxLength={60}
              pattern="[A-Za-z0-9 \-]+"
            />
          </div>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Blurb" htmlFor="album-blurb" hint="One or two sentences under the title, also the text of the link preview.">
            <textarea
              id="album-blurb"
              className={`${inputCls} min-h-[4.5rem]`}
              value={form.blurb}
              onChange={(e) => setForm((f) => ({ ...f, blurb: e.target.value }))}
              maxLength={500}
            />
          </Field>
        </div>
        {update.error && (
          <div className="sm:col-span-2">
            <ErrorText>{update.error.message}</ErrorText>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <button type="submit" className={primaryBtnCls} disabled={!dirty || update.isPending}>
            {update.isPending ? 'Saving…' : saved ? 'Saved' : 'Save'}
          </button>
          <label className="flex items-center gap-3 text-sm text-silver/70">
            <Toggle
              checked={album.published}
              onChange={(v) => update.mutate({ id: album.id, patch: { published: v } })}
              label="Published"
              disabled={update.isPending}
            />
            {album.published ? 'Published' : 'Hidden from the site'}
          </label>
        </div>
      </form>
    </Panel>
  )
}

// ---- upload ----------------------------------------------------------------

// Runs the queue with a few uploads in flight; each item reports its own state.
function useUploadQueue(albumId, nextSortOrder, onUploaded) {
  const [items, setItems] = useState([])
  const running = useRef(false)
  const queue = useRef([])
  const order = useRef(nextSortOrder)
  useEffect(() => {
    order.current = Math.max(order.current, nextSortOrder)
  }, [nextSortOrder])

  const pump = useCallback(async () => {
    if (running.current) return
    running.current = true
    const workers = []
    for (let w = 0; w < MAX_PARALLEL; w++) {
      workers.push(
        (async () => {
          for (;;) {
            const item = queue.current.shift()
            if (!item) return
            setItems((prev) => prev.map((x) => (x.key === item.key ? { ...x, state: 'uploading' } : x)))
            try {
              const sort = order.current++
              await uploadPhoto(albumId, item.file, sort)
              setItems((prev) => prev.map((x) => (x.key === item.key ? { ...x, state: 'done' } : x)))
              onUploaded()
            } catch (err) {
              setItems((prev) =>
                prev.map((x) =>
                  x.key === item.key ? { ...x, state: 'failed', error: err?.message || 'Upload failed' } : x,
                ),
              )
            }
          }
        })(),
      )
    }
    await Promise.all(workers)
    running.current = false
  }, [albumId, onUploaded])

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
        queue.current.push({ key, file })
      }
      setItems((prev) => [...prev, ...fresh])
      pump()
    },
    [pump],
  )

  const clearDone = useCallback(() => setItems((prev) => prev.filter((x) => x.state !== 'done')), [])

  return { items, add, clearDone }
}

function DropZone({ onFiles, busy }) {
  const [over, setOver] = useState(false)
  const inputRef = useRef(null)

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
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={`rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${
        over ? 'border-medical bg-medical/10' : 'border-white/15 bg-white/[0.03]'
      }`}
    >
      <p className="text-sm text-silver/80">
        Drop photos here{busy ? ' (uploads are running)' : ''}
      </p>
      <p className="mt-1 text-xs text-silver/50">
        JPEG, PNG, WebP or HEIC. Each photo is resized in your browser before it is uploaded, so full-size phone photos are fine.
      </p>
      <button type="button" className={`${outlineBtnCls} mt-4`} onClick={() => inputRef.current?.click()}>
        Choose files
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,.heic,.heif"
        multiple
        className="sr-only"
        onChange={(e) => {
          const files = Array.from(e.target.files || [])
          e.target.value = ''
          if (files.length) onFiles(files)
        }}
      />
    </div>
  )
}

function UploadList({ items, onClear }) {
  if (items.length === 0) return null
  const done = items.filter((x) => x.state === 'done').length
  const failed = items.filter((x) => x.state === 'failed')
  const active = items.length - done - failed.length
  return (
    <div className="mt-4 text-sm" aria-live="polite">
      <p className="text-silver/70">
        {active > 0 && `${active} uploading… `}
        {done > 0 && `${done} added. `}
        {failed.length > 0 && `${failed.length} failed.`}
        {active === 0 && (
          <button type="button" onClick={onClear} className="ml-2 font-semibold text-medical-light hover:text-white">
            Clear
          </button>
        )}
      </p>
      {failed.length > 0 && (
        <ul className="mt-2 grid gap-1 text-xs text-red-200">
          {failed.map((x) => (
            <li key={x.key}>
              {x.name}: {x.error}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---- photo grid ------------------------------------------------------------

function PhotoCard({ p, isCover, onAction, busy }) {
  const [label, setLabel] = useState(p.label)
  useEffect(() => setLabel(p.label), [p.label])
  return (
    <li className={`overflow-hidden rounded-2xl border bg-forest-800 ${p.hidden ? 'border-amber-400/40' : 'border-white/10'}`}>
      <div className="relative aspect-square bg-forest-950">
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
            className={`${inputCls} py-1.5 text-xs`}
            value={label}
            placeholder="Banner label, e.g. Delegation"
            maxLength={80}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={() => label !== p.label && onAction('label', label)}
            aria-label="Banner label"
          />
        )}
        <div className="flex flex-wrap gap-1.5">
          {!isCover && !p.hidden && (
            <button type="button" className={smallBtn} onClick={() => onAction('cover')} disabled={busy}>
              Set as cover
            </button>
          )}
          {!p.hidden && (
            <button type="button" className={smallBtn} onClick={() => onAction('featured', !p.featured)} disabled={busy}>
              {p.featured ? 'Unfeature' : 'Feature'}
            </button>
          )}
          <button type="button" className={smallBtn} onClick={() => onAction('hidden', !p.hidden)} disabled={busy}>
            {p.hidden ? 'Show' : 'Hide'}
          </button>
          <button type="button" className={`${smallBtn} text-red-200`} onClick={() => onAction('bin')} disabled={busy}>
            Remove
          </button>
        </div>
      </div>
    </li>
  )
}

const smallBtn =
  'rounded-full border border-white/15 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-white/10 disabled:opacity-40'

function Badge({ children, tone = 'ok' }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.15em] ${
        tone === 'warn' ? 'bg-amber-400/90 text-forest-950' : 'bg-medical text-forest-950'
      }`}
    >
      {children}
    </span>
  )
}

function Bin({ photos, onRestore, onPurge, busy }) {
  if (photos.length === 0) return null
  return (
    <Panel title="Removed photos" className="mt-8">
      <p className="mt-3 text-xs text-silver/55">
        Not on the site. Restore a photo that was removed by mistake; anything still here after 30 days is deleted for good.
      </p>
      <ul className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-8">
        {photos.map((p) => (
          <li key={p.id} className="overflow-hidden rounded-xl border border-white/10 bg-forest-950">
            <img src={p.thumb} alt="" loading="lazy" className="aspect-square w-full object-cover opacity-60" />
            <div className="flex flex-wrap gap-1 p-2">
              <button type="button" className={smallBtn} onClick={() => onRestore(p)} disabled={busy}>
                Restore
              </button>
              <ConfirmButton
                label="Delete"
                confirmLabel="Delete for good"
                onConfirm={() => onPurge(p)}
                disabled={busy}
                className={smallBtn}
              />
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

// ---- page ------------------------------------------------------------------

function AlbumEditor({ album }) {
  const navigate = useNavigate()
  const photosQ = useAlbumPhotos(album.id)
  const { update: updatePhoto, purge } = usePhotoMutations(album.id)
  const { update: updateAlbum, remove: removeAlbum } = useAlbumMutations()
  const refetch = photosQ.refetch

  // The bin empties itself: anything removed more than 30 days ago goes now.
  useEffect(() => {
    purgeExpired(album.id)
      .then((n) => n > 0 && refetch())
      .catch(() => {
        /* the next visit tries again */
      })
  }, [album.id, refetch])

  const all = useMemo(() => photosQ.data || [], [photosQ.data])
  const live = all.filter((p) => !p.deleted_at)
  const binned = all.filter((p) => p.deleted_at)
  const nextSort = live.reduce((m, p) => Math.max(m, p.sort_order + 1), 0)
  const onUploaded = useCallback(() => refetch(), [refetch])
  const uploads = useUploadQueue(album.id, nextSort, onUploaded)
  const uploading = uploads.items.some((x) => x.state === 'queued' || x.state === 'uploading')
  const busy = updatePhoto.isPending || purge.isPending || updateAlbum.isPending

  const act = (p, kind, value) => {
    if (kind === 'cover') updateAlbum.mutate({ id: album.id, patch: { cover_photo_id: p.id } })
    else if (kind === 'featured') updatePhoto.mutate({ id: p.id, patch: { featured: value } })
    else if (kind === 'hidden') updatePhoto.mutate({ id: p.id, patch: { hidden: value } })
    else if (kind === 'label') updatePhoto.mutate({ id: p.id, patch: { label: value } })
    else if (kind === 'bin') updatePhoto.mutate({ id: p.id, patch: { deleted_at: new Date().toISOString(), featured: false } })
  }

  const deleteAlbum = async () => {
    await removeAlbum.mutateAsync(album.id)
    navigate('/portal/gallery', { replace: true })
  }

  return (
    <>
      <PageHeader
        eyebrow={
          <Link to="/portal/gallery" className="hover:text-white">
            &larr; All albums
          </Link>
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
              className={outlineBtnCls}
            >
              View on the site ↗
            </Link>
          </div>
        }
      />

      <DetailsForm album={album} />

      <Panel title="Photos" className="mb-6">
        <div className="mt-4">
          <DropZone onFiles={uploads.add} busy={uploading} />
          <UploadList items={uploads.items} onClear={uploads.clearDone} />
        </div>
        {(updatePhoto.error || updateAlbum.error || purge.error) && (
          <div className="mt-4">
            <ErrorText>{(updatePhoto.error || updateAlbum.error || purge.error).message}</ErrorText>
          </div>
        )}
        {photosQ.isPending ? (
          <Centered>
            <Spinner />
          </Centered>
        ) : photosQ.error ? (
          <ErrorText>Couldn’t load the photos: {photosQ.error.message}</ErrorText>
        ) : live.length === 0 ? (
          <p className="mt-6 text-sm text-silver/60">
            No photos yet. The album appears on the site once it has one.
          </p>
        ) : (
          <>
            <p className="mt-6 text-xs text-silver/55">
              {live.length} {live.length === 1 ? 'photo' : 'photos'}. The cover is the album card on the gallery page; a
              featured photo shows as a wide banner above the grid.
            </p>
            <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {live.map((p) => (
                <PhotoCard
                  key={p.id}
                  p={p}
                  isCover={p.id === album.cover_photo_id}
                  onAction={(kind, value) => act(p, kind, value)}
                  busy={busy}
                />
              ))}
            </ul>
          </>
        )}
      </Panel>

      <Bin
        photos={binned}
        busy={busy}
        onRestore={(p) => updatePhoto.mutate({ id: p.id, patch: { deleted_at: null } })}
        onPurge={(p) => purge.mutate(p)}
      />

      <Panel title="Delete album" className="mt-8">
        <p className="mt-3 text-xs text-silver/55">
          Removes the album, all its photos and its link from the site. This cannot be undone.
        </p>
        <div className="mt-4">
          <ConfirmButton
            label="Delete this album"
            confirmLabel="Delete album and photos"
            onConfirm={deleteAlbum}
            disabled={removeAlbum.isPending || uploading}
          />
        </div>
        {removeAlbum.error && <ErrorText>{removeAlbum.error.message}</ErrorText>}
      </Panel>
    </>
  )
}

export default function AlbumEditorPage() {
  const { slug } = useParams()
  const albums = useAlbums()
  const album = (albums.data || []).find((a) => a.slug === slug)
  usePageTitle(album ? `Edit ${album.title}` : 'Edit album')

  return (
    <GalleryGate>
      {albums.isPending ? (
        <Centered>
          <Spinner />
        </Centered>
      ) : albums.error ? (
        <Panel>
          <ErrorText>Couldn’t load the album: {albums.error.message}</ErrorText>
        </Panel>
      ) : !album ? (
        <Panel>
          <p className="text-sm text-silver/70">No album at /gallery/{slug}.</p>
          <Link to="/portal/gallery" className="mt-4 inline-block text-sm font-semibold text-medical-light hover:text-white">
            &larr; All albums
          </Link>
        </Panel>
      ) : (
        <AlbumEditor album={album} />
      )}
    </GalleryGate>
  )
}
