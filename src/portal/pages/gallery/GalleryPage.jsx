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
import { ShareLinkButton, siteAlbumUrl } from './galleryUi.jsx'

// /portal/gallery. The shelf: every album in the order visitors see it, with
// its cover, photo count and shareable link. PNSD officers and the EB add
// albums here and reorder them; the album itself is edited on its own page.

export function GalleryGate({ children }) {
  const { officerOf } = useAuth()
  if (officerOf('pnsd')) return children
  return (
    <Panel>
      <p className="text-sm text-silver/70">
        The gallery is edited by the PNSD officers and the Executive Board. If
        you think you should have access, ask the webmaster to check your
        assignment for this term.
      </p>
      <Link
        to="/portal"
        className="mt-4 inline-block text-sm font-semibold text-medical-light hover:text-white"
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

function AlbumRow({ a, index, total, onMove, moving }) {
  return (
    <li className="flex flex-wrap items-center gap-4 rounded-2xl border border-white/10 bg-forest-800 p-3 sm:flex-nowrap">
      <Link to={`/portal/gallery/${a.slug}`} className="block h-20 w-28 shrink-0 overflow-hidden rounded-xl bg-forest-950">
        {a.cover ? (
          <img src={a.cover} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <span className="grid h-full w-full place-items-center text-[10px] uppercase tracking-[0.2em] text-silver/40">
            No photos
          </span>
        )}
      </Link>
      <div className="min-w-0 flex-1">
        <Link to={`/portal/gallery/${a.slug}`} className="heading-serif block truncate text-lg text-white hover:text-medical-light">
          {a.title}
        </Link>
        <p className="mt-0.5 truncate text-xs text-silver/55">
          {a.visibleCount} {a.visibleCount === 1 ? 'photo' : 'photos'}
          {a.photoCount > a.visibleCount && ` (${a.photoCount - a.visibleCount} hidden)`}
          {!a.published && ' · not published'}
          {a.published && a.visibleCount === 0 && ' · not shown until it has a photo'}
          {' · '}
          <span className="text-silver/40">{siteAlbumUrl(a.slug).replace(/^https?:\/\//, '')}</span>
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <ShareLinkButton slug={a.slug} />
        <button
          type="button"
          className={outlineBtnCls}
          onClick={() => onMove(index, index - 1)}
          disabled={moving || index === 0}
          aria-label={`Move ${a.title} up`}
        >
          ↑
        </button>
        <button
          type="button"
          className={outlineBtnCls}
          onClick={() => onMove(index, index + 1)}
          disabled={moving || index === total - 1}
          aria-label={`Move ${a.title} down`}
        >
          ↓
        </button>
        <Link to={`/portal/gallery/${a.slug}`} className={outlineBtnCls}>
          Edit
        </Link>
      </div>
    </li>
  )
}

export default function GalleryPage() {
  usePageTitle('Gallery editor')
  const albums = useAlbums()
  const { reorder } = useAlbumMutations()
  const [adding, setAdding] = useState(false)
  const [created, setCreated] = useState(null)

  const move = (from, to) => {
    const ids = (albums.data || []).map((a) => a.id)
    if (to < 0 || to >= ids.length) return
    const [id] = ids.splice(from, 1)
    ids.splice(to, 0, id)
    reorder.mutate(ids)
  }

  return (
    <GalleryGate>
      <PageHeader
        eyebrow="PNSD"
        title="Gallery"
        subtitle="Albums in the order visitors see them. Changes are live on the site the moment they are saved."
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
        <p className="mb-6 rounded-xl border border-medical/40 bg-medical/10 px-4 py-3 text-sm text-medical-light">
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
          <p className="text-sm text-silver/70">
            No albums yet. Create one, then drop the photos onto its page.
          </p>
        </Panel>
      ) : (
        <>
          {reorder.error && <ErrorText>{reorder.error.message}</ErrorText>}
          <ul className="grid gap-3">
            {albums.data.map((a, i) => (
              <AlbumRow
                key={a.id}
                a={a}
                index={i}
                total={albums.data.length}
                onMove={move}
                moving={reorder.isPending}
              />
            ))}
          </ul>
        </>
      )}
    </GalleryGate>
  )
}
