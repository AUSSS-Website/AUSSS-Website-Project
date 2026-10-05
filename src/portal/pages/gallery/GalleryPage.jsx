import { useState } from 'react'
import { Link } from 'react-router-dom'
import usePageTitle from '../../../hooks/usePageTitle.js'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { useAlbumMutations, useAlbums } from '../../galleryQueries.js'
import {
  Centered,
  ErrorText,
  Field,
  PageHeader,
  Panel,
  Spinner,
  inputCls,
  outlineBtnCls,
  primaryBtnCls,
} from '../../portalUi.jsx'
import SortableList from '../../SortableList.jsx'
import { ShareLinkButton, siteAlbumUrl } from './galleryUi.jsx'

// /portal/gallery. The shelf: every album in the order visitors see it, with
// its cover, photo count and shareable link. PNSD officers and the EB add
// albums here and drag them into order (the handle at the left of each row;
// the arrow keys work on it too); the album itself is edited on its own page.

export function GalleryGate({ children }) {
  const { officerOf } = useAuth()
  if (officerOf('pnsd')) return children
  return (
    <Panel>
      <p className="text-sm text-soft/70">
        The gallery is edited by the PNSD officers and the Executive Board. If
        you think you should have access, ask the webmaster to check your
        assignment for this term.
      </p>
      <Link
        to="/portal"
        className="mt-4 inline-block text-sm font-semibold text-accent hover:text-ink"
      >
        &larr; Back to your dashboard
      </Link>
    </Panel>
  )
}

function NewAlbumForm({ onDone }) {
  const { create } = useAlbumMutations()
  const [title, setTitle] = useState('')
  const [blurb, setBlurb] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    if (!title.trim()) return
    const row = await create.mutateAsync({ title: title.trim(), blurb: blurb.trim() })
    onDone(row)
  }

  return (
    <Panel title="New album" className="mb-8">
      <form onSubmit={submit} className="mt-4 grid gap-5">
        <Field label="Title" htmlFor="new-album-title" hint="The link is made from it, for example /gallery/aswan-nga-2026. You can change both later.">
          <input
            id="new-album-title"
            className={inputCls}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            required
            autoFocus
          />
        </Field>
        <Field label="Blurb" htmlFor="new-album-blurb" hint="One line under the title. Optional.">
          <input
            id="new-album-blurb"
            className={inputCls}
            value={blurb}
            onChange={(e) => setBlurb(e.target.value)}
            maxLength={500}
          />
        </Field>
        {create.error && <ErrorText>{create.error.message}</ErrorText>}
        <div className="flex flex-wrap gap-3">
          <button type="submit" className={primaryBtnCls} disabled={create.isPending || !title.trim()}>
            {create.isPending ? 'Creating…' : 'Create and add photos'}
          </button>
          <button type="button" className={outlineBtnCls} onClick={() => onDone(null)}>
            Cancel
          </button>
        </div>
      </form>
    </Panel>
  )
}

function AlbumRow({ a, handle }) {
  return (
    <div className="flex flex-wrap items-center gap-3 p-3 sm:flex-nowrap sm:gap-4">
      {handle}
      <Link to={`/portal/gallery/${a.slug}`} className="block h-20 w-28 shrink-0 overflow-hidden rounded-xl bg-page">
        {a.cover ? (
          <img src={a.cover} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <span className="grid h-full w-full place-items-center text-[10px] uppercase tracking-[0.2em] text-soft/40">
            No photos
          </span>
        )}
      </Link>
      <div className="min-w-0 flex-1">
        <Link to={`/portal/gallery/${a.slug}`} className="heading-serif block truncate text-lg text-ink hover:text-accent">
          {a.title}
        </Link>
        <p className="mt-0.5 truncate text-xs text-soft/55">
          {a.visibleCount} {a.visibleCount === 1 ? 'photo' : 'photos'}
          {a.photoCount > a.visibleCount && ` (${a.photoCount - a.visibleCount} hidden)`}
          {!a.published && ' · not published'}
          {a.published && a.visibleCount === 0 && ' · not shown until it has a photo'}
          {' · '}
          <span className="text-soft/40">{siteAlbumUrl(a.slug).replace(/^https?:\/\//, '')}</span>
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <ShareLinkButton slug={a.slug} />
        <Link to={`/portal/gallery/${a.slug}`} className={outlineBtnCls}>
          Edit
        </Link>
      </div>
    </div>
  )
}

export default function GalleryPage() {
  usePageTitle('Gallery editor')
  const albums = useAlbums()
  const { reorder } = useAlbumMutations()
  const [adding, setAdding] = useState(false)
  const [created, setCreated] = useState(null)

  return (
    <GalleryGate>
      <PageHeader
        eyebrow="PNSD"
        title="Gallery"
        subtitle="Albums in the order visitors see them. Drag an album by its handle to move it. Changes are live on the site the moment they are saved."
        action={
          <div className="flex flex-wrap gap-2">
            <Link
              to="/gallery"
              target="_blank"
              rel="noopener noreferrer"
              className={outlineBtnCls}
            >
              View public gallery ↗
            </Link>
            {!adding && (
              <button type="button" className={primaryBtnCls} onClick={() => setAdding(true)}>
                New album
              </button>
            )}
          </div>
        }
      />

      {adding && (
        <NewAlbumForm
          onDone={(row) => {
            setAdding(false)
            if (row) setCreated(row)
          }}
        />
      )}

      {created && (
        <p className="mb-6 rounded-xl border border-medical/40 bg-medical/10 px-4 py-3 text-sm text-accent">
          Album created.{' '}
          <Link to={`/portal/gallery/${created.slug}`} className="font-semibold underline-offset-2 hover:underline">
            Add photos to {created.title} &rarr;
          </Link>
        </p>
      )}

      {albums.isPending ? (
        <Centered>
          <Spinner />
        </Centered>
      ) : albums.error ? (
        <Panel>
          <ErrorText>Couldn’t load the albums: {albums.error.message}</ErrorText>
        </Panel>
      ) : albums.data.length === 0 ? (
        <Panel>
          <p className="text-sm text-soft/70">
            No albums yet. Create one, then drop the photos onto its page.
          </p>
        </Panel>
      ) : (
        <>
          {reorder.error && <ErrorText>{reorder.error.message}</ErrorText>}
          <SortableList
            items={albums.data}
            getId={(a) => a.id}
            getLabel={(a) => a.title}
            onReorder={(ids) => reorder.mutate(ids)}
            className="grid gap-3"
            itemClassName="min-w-0 rounded-2xl border border-line/10 bg-card"
            renderItem={(a, handle) => <AlbumRow a={a} handle={handle} />}
          />
        </>
      )}
    </GalleryGate>
  )
}
