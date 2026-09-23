import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import useReveal from '../hooks/useReveal.js'
import useMediaQuery from '../hooks/useMediaQuery.js'
import usePageTitle from '../hooks/usePageTitle.js'
import useFocusTrap from '../hooks/useFocusTrap.js'
import ImageTrail from '../components/ImageTrail.jsx'
import GalleryAurora from '../components/GalleryAurora.jsx'
import { albums as rawAlbums, trail } from '../data/gallery.js'
import {
  useGalleryRemovals,
  buildRemovalFile,
} from '../hooks/useGalleryRemovals.js'
import { society } from '../data/society.js'

// Visitors always read the union of committed + live removals (the live list
// is fetched from the backend on load). Inline admin mode (?admin=1) lets a
// committee member mark photos for export. The dedicated /gallery/admin page
// hides photos live for everyone. All three share ../hooks/useGalleryRemovals.

// Hide removed photos and recompute count/cover; drop now-empty albums.
function visibleAlbums(albums, effective) {
  if (effective.size === 0) return albums
  return albums
    .map((a) => {
      const photos = a.photos.filter((p) => !effective.has(p.full))
      return { ...a, photos, count: photos.length, cover: photos[0]?.thumb }
    })
    .filter((a) => a.count > 0)
}

export default function GalleryPage() {
  const { slug } = useParams()
  const [params] = useSearchParams()
  const isAdmin = params.get('admin') === '1'
  const removals = useGalleryRemovals(isAdmin ? 'local' : 'none')

  const album = slug ? rawAlbums.find((a) => a.slug === slug) : null
  usePageTitle(album ? album.title : 'Gallery')
  if (slug && !album) return <NotFoundAlbum slug={slug} />

  return album ? (
    <AlbumView album={album} isAdmin={isAdmin} removals={removals} />
  ) : (
    <GalleryIndex isAdmin={isAdmin} removals={removals} />
  )
}

// ───────────────────────── Index view ─────────────────────────

function GalleryIndex({ isAdmin, removals }) {
  useReveal()
  const isDesktop = useMediaQuery('(min-width: 768px)')
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const hasTrail = trail.length > 0
  const showTrail = isDesktop && !reduceMotion && hasTrail

  // Admins see every album (so they can mark/restore); visitors see filtered.
  const albums = isAdmin
    ? rawAlbums
    : visibleAlbums(rawAlbums, removals.effective)

  return (
    <article className="bg-forest-950">
      {/* Hero */}
      <header className="relative isolate flex min-h-[80vh] items-center overflow-hidden pt-24 sm:min-h-[88vh]">
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage: 'radial-gradient(circle, #C9D6DF 1px, transparent 1px)',
            backgroundSize: '34px 34px',
          }}
          aria-hidden="true"
        />

        <GalleryAurora />
        {showTrail && (
          <div className="absolute inset-0 z-0" aria-hidden="true">
            <ImageTrail items={trail} variant={7} />
          </div>
        )}
        {reduceMotion && hasTrail && (
          <div
            className="absolute inset-0 z-0 grid grid-cols-3 gap-2 p-4 opacity-25 sm:grid-cols-4 sm:gap-3 sm:p-6"
            aria-hidden="true"
          >
            {trail.slice(0, 12).map((src) => (
              <div
                key={src}
                className="aspect-square rounded-xl bg-cover bg-center"
                style={{ backgroundImage: `url(${src})` }}
              />
            ))}
          </div>
        )}

        <div className="container-prose pointer-events-none relative z-10 w-full py-12 text-center">
          <div className="pointer-events-auto mx-auto max-w-3xl rounded-3xl bg-forest-950/70 px-6 py-10 ring-1 ring-white/10 backdrop-blur-md sm:px-12 sm:py-14">
            <span className="eyebrow justify-center">
              <span className="h-px w-8 bg-medical" />
              Gallery
              <span className="h-px w-8 bg-medical" />
            </span>
            <h1 className="heading-serif mt-6 text-4xl text-white sm:text-6xl">
              55 years through your eyes
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-base font-light leading-relaxed text-silver/80 sm:text-lg">
              Camps, exchanges, assemblies, and the small in-between moments
              that make AUSSS what it is.
            </p>
            {showTrail && (
              <p className="mt-5 text-xs uppercase tracking-[0.2em] text-medical-light/80">
                Move your cursor →
              </p>
            )}
          </div>
        </div>
      </header>

      {/* Albums grid */}
      <div className="container-prose pb-20 pt-12">
        {albums.length === 0 ? (
          <p className="mx-auto max-w-xl rounded-2xl border border-dashed border-white/15 bg-white/[0.03] p-8 text-center text-sm text-silver/60">
            The gallery is loading. Photos will appear here once the asset
            pipeline finishes processing.
          </p>
        ) : (
          <>
            {/* Mobile: two staggered columns (zigzag), matching the merch page. */}
            <div className="grid grid-cols-2 gap-3 sm:hidden">
              <div className="flex flex-col gap-3">
                {albums.map((a, i) =>
                  i % 2 === 0 ? <AlbumCard key={a.slug} a={a} isAdmin={isAdmin} /> : null,
                )}
              </div>
              <div className="flex flex-col gap-3 pt-10">
                {albums.map((a, i) =>
                  i % 2 === 1 ? <AlbumCard key={a.slug} a={a} isAdmin={isAdmin} /> : null,
                )}
              </div>
            </div>

            {/* Desktop: even grid. */}
            <ul className="hidden gap-6 sm:grid sm:grid-cols-2 lg:grid-cols-3">
              {albums.map((a) => (
                <li key={a.slug}>
                  <AlbumCard a={a} isAdmin={isAdmin} />
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="reveal mt-16 text-center">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm font-semibold text-medical-light transition-colors hover:text-white"
          >
            ← Back to AUSSS home
          </Link>
        </div>

        <GalleryDisclaimer />
      </div>

      {isAdmin && <AdminBar removals={removals} />}
    </article>
  )
}

const AlbumCard = memo(function AlbumCard({ a, isAdmin }) {
  return (
    <Link
      to={`/gallery/${a.slug}${isAdmin ? '?admin=1' : ''}`}
      className="reveal group block overflow-hidden rounded-2xl border border-white/10 bg-forest-800 transition-colors hover:border-medical/40 sm:rounded-3xl"
    >
      <div className="relative aspect-[4/3] overflow-hidden">
        {a.cover ? (
          <img
            src={a.cover}
            alt={a.title}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
          />
        ) : (
          <div className="h-full w-full bg-forest-700" />
        )}
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-forest-950/85 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-3 sm:p-5">
          <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-medical-light sm:text-[10px]">
            {a.count} {a.count === 1 ? 'photo' : 'photos'}
          </p>
          <h2 className="heading-serif mt-1 text-base text-white sm:text-xl">
            {a.title}
          </h2>
        </div>
      </div>
      {a.blurb && (
        <p className="hidden px-5 py-4 text-sm leading-relaxed text-silver/70 sm:block">
          {a.blurb}
        </p>
      )}
    </Link>
  )
})

// ───────────────────────── Album view ─────────────────────────

function AlbumView({ album, isAdmin, removals }) {
  useReveal()
  const [openIdx, setOpenIdx] = useState(null)

  // Admins see all photos (with mark/restore overlays); visitors see filtered.
  const photos = useMemo(
    () =>
      isAdmin
        ? album.photos
        : album.photos.filter((p) => !removals.effective.has(p.full)),
    [album.photos, isAdmin, removals.effective],
  )

  const open = openIdx != null
  const close = useCallback(() => setOpenIdx(null), [])
  const next = useCallback(
    () => setOpenIdx((i) => (i == null ? null : (i + 1) % photos.length)),
    [photos.length],
  )
  const prev = useCallback(
    () =>
      setOpenIdx((i) =>
        i == null ? null : (i - 1 + photos.length) % photos.length,
      ),
    [photos.length],
  )

  // A pinned featured photo (pipeline puts it first) renders as a full-width
  // banner above the grid. The grid then shows the rest; `gridOffset` keeps
  // lightbox indices aligned with the full `photos` array.
  const featuredPhoto = photos[0]?.featured ? photos[0] : null
  const gridPhotos = featuredPhoto ? photos.slice(1) : photos
  const gridOffset = featuredPhoto ? 1 : 0

  return (
    <article className="bg-forest-950">
      <header className="relative isolate overflow-hidden pb-12 pt-32 text-center sm:pt-40">
        <GalleryAurora />
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-28 bg-gradient-to-t from-forest-950 to-transparent"
          aria-hidden="true"
        />
        <div className="container-prose relative z-10">
          <span className="eyebrow justify-center">
            <span className="h-px w-8 bg-medical" />
            {photos.length} {photos.length === 1 ? 'photo' : 'photos'}
            <span className="h-px w-8 bg-medical" />
          </span>
          <h1 className="heading-serif mt-6 text-4xl text-white sm:text-5xl">
            {album.title}
          </h1>
          {album.blurb && (
            <p className="mx-auto mt-4 max-w-xl text-base font-light leading-relaxed text-silver/75">
              {album.blurb}
            </p>
          )}
        </div>
      </header>

      <div className="container-prose pb-20">
        {featuredPhoto && (
          <figure className="reveal relative mb-3 sm:mb-4">
            <button
              type="button"
              onClick={() => setOpenIdx(0)}
              className="group block w-full overflow-hidden rounded-2xl bg-forest-800 focus:outline-none focus:ring-2 focus:ring-medical sm:rounded-3xl"
              aria-label={`Open featured photo (${featuredPhoto.label || 'featured'}) of ${photos.length}`}
            >
              <img
                src={featuredPhoto.full}
                alt={`${album.title}, ${featuredPhoto.label || 'featured photo'}`}
                width={featuredPhoto.w}
                height={featuredPhoto.h}
                decoding="async"
                fetchpriority="high"
                className={`max-h-[72vh] w-full object-contain transition-transform duration-700 group-hover:scale-[1.02] ${
                  removals.effective.has(featuredPhoto.full) ? 'opacity-30 grayscale' : ''
                }`}
              />
              <div
                className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-forest-950/70 to-transparent"
                aria-hidden="true"
              />
              {featuredPhoto.label && (
                <figcaption className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-full bg-forest-950/70 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-medical-light ring-1 ring-white/10 backdrop-blur-sm sm:bottom-5 sm:left-5 sm:text-xs">
                  <span className="h-1.5 w-1.5 rounded-full bg-medical" />
                  {featuredPhoto.label}
                </figcaption>
              )}
            </button>
            {isAdmin && (
              <button
                type="button"
                onClick={() => removals.toggle(featuredPhoto.full)}
                className={`absolute right-3 top-3 z-10 rounded-full px-3 py-1.5 text-xs font-semibold shadow-lg transition-colors ${
                  removals.effective.has(featuredPhoto.full)
                    ? 'bg-medical text-forest-950 hover:bg-medical-light'
                    : 'bg-red-600/90 text-white hover:bg-red-600'
                }`}
                aria-pressed={removals.effective.has(featuredPhoto.full)}
              >
                {removals.effective.has(featuredPhoto.full) ? 'Restore' : 'Remove'}
              </button>
            )}
          </figure>
        )}
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4">
          {gridPhotos.map((p, gi) => {
            const i = gi + gridOffset
            const marked = removals.effective.has(p.full)
            return (
              <li key={p.thumb} className="relative">
                <button
                  type="button"
                  onClick={() => setOpenIdx(i)}
                  className="group block w-full overflow-hidden rounded-xl bg-forest-800 focus:outline-none focus:ring-2 focus:ring-medical"
                  aria-label={`Open photo ${i + 1} of ${photos.length}`}
                >
                  <div className="relative aspect-square overflow-hidden">
                    <img
                      src={p.thumb}
                      alt={`${album.title}, photo ${i + 1}`}
                      loading="lazy"
                      width={p.w}
                      height={p.h}
                      className={`h-full w-full object-cover transition-transform duration-500 group-hover:scale-105 ${
                        marked ? 'opacity-30 grayscale' : ''
                      }`}
                    />
                  </div>
                </button>

                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => removals.toggle(p.full)}
                    className={`absolute right-2 top-2 z-10 rounded-full px-3 py-1.5 text-xs font-semibold shadow-lg transition-colors ${
                      marked
                        ? 'bg-medical text-forest-950 hover:bg-medical-light'
                        : 'bg-red-600/90 text-white hover:bg-red-600'
                    }`}
                    aria-pressed={marked}
                  >
                    {marked ? 'Restore' : 'Remove'}
                  </button>
                )}
              </li>
            )
          })}
        </ul>

        <div className="mt-16 flex flex-wrap items-center justify-center gap-6 text-sm">
          <Link
            to={`/gallery${isAdmin ? '?admin=1' : ''}`}
            className="font-semibold text-medical-light transition-colors hover:text-white"
          >
            ← All albums
          </Link>
          <Link
            to="/"
            className="font-semibold text-silver/60 transition-colors hover:text-white"
          >
            AUSSS home
          </Link>
        </div>

        <GalleryDisclaimer />
      </div>

      {open && (
        <Lightbox
          photos={photos}
          index={openIdx}
          onClose={close}
          onNext={next}
          onPrev={prev}
        />
      )}

      {isAdmin && <AdminBar removals={removals} />}
    </article>
  )
}

// ───────────────────────── Admin bar ─────────────────────────

function AdminBar({ removals }) {
  const { localMarks, clearLocal } = removals
  const [copied, setCopied] = useState(false)

  const total = removals.effective.size

  const copyList = async () => {
    const file = buildRemovalFile(removals.effective)
    try {
      await navigator.clipboard.writeText(file)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard blocked, dump to console as a fallback.
      // eslint-disable-next-line no-console
      console.log(file)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-[90] border-t border-white/15 bg-forest-950/95 px-4 py-3 backdrop-blur-md">
      <div className="container-prose flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-silver/80">
          <span className="font-semibold text-white">Admin mode</span> ·{' '}
          {total} marked for removal
          {localMarks.length > 0 && (
            <span className="text-silver/50"> ({localMarks.length} new)</span>
          )}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={copyList}
            disabled={total === 0}
            className="rounded-full bg-medical px-4 py-2 text-xs font-semibold text-forest-950 transition-colors hover:bg-medical-light disabled:opacity-40"
          >
            {copied ? 'Copied to clipboard' : 'Copy removal list'}
          </button>
          <button
            type="button"
            onClick={clearLocal}
            disabled={localMarks.length === 0}
            className="rounded-full border border-white/20 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/10 disabled:opacity-40"
          >
            Clear new marks
          </button>
        </div>
      </div>
      <p className="container-prose mt-1.5 text-[11px] leading-relaxed text-silver/45">
        Paste the copied list into{' '}
        <code className="text-medical-light">src/data/galleryRemovals.js</code>{' '}
        and redeploy to hide these for everyone. Marks are stored only in this
        browser until then. Tip:{' '}
        <Link
          to="/gallery/admin"
          className="text-medical-light underline-offset-2 hover:underline"
        >
          open the full admin page
        </Link>{' '}
        to see every album&rsquo;s photos on one screen.
      </p>
    </div>
  )
}

// ───────────────────────── Disclaimer ─────────────────────────

function GalleryDisclaimer() {
  return (
    <p className="mx-auto mt-12 max-w-2xl text-center text-xs leading-relaxed text-silver/45">
      These photos are shared by AUSSS members and from society events. If
      you&rsquo;d like a photo of you removed, contact us at{' '}
      <a
        href={`mailto:${society.contactEmail}?subject=Photo%20removal%20request`}
        className="text-medical-light underline-offset-2 transition-colors hover:text-white hover:underline"
      >
        {society.contactEmail}
      </a>{' '}
      and we&rsquo;ll take it down promptly.
    </p>
  )
}

// ───────────────────────── Lightbox ─────────────────────────

function Lightbox({ photos, index, onClose, onNext, onPrev }) {
  const photo = photos[index]
  // Trap focus inside the lightbox and return it to the trigger on close.
  const trapRef = useFocusTrap(true, onClose)

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowRight') onNext()
      else if (e.key === 'ArrowLeft') onPrev()
    }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose, onNext, onPrev])

  const [touchStart, setTouchStart] = useState(null)
  const onTouchStart = (e) => setTouchStart(e.touches[0].clientX)
  const onTouchEnd = (e) => {
    if (touchStart == null) return
    const dx = e.changedTouches[0].clientX - touchStart
    if (dx > 50) onPrev()
    else if (dx < -50) onNext()
    setTouchStart(null)
  }

  if (!photo) return null

  return (
    <div
      ref={trapRef}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-forest-950/95 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`Photo ${index + 1} of ${photos.length}`}
      onClick={onClose}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        className="absolute right-4 top-4 z-10 grid h-12 w-12 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
        aria-label="Close"
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
        </svg>
      </button>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onPrev()
        }}
        className="absolute left-2 z-10 grid h-12 w-12 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 sm:left-6"
        aria-label="Previous photo"
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onNext()
        }}
        className="absolute right-2 z-10 grid h-12 w-12 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 sm:right-6"
        aria-label="Next photo"
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <img
        src={photo.full}
        alt={`Photo ${index + 1} of ${photos.length}`}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[88vh] max-w-[92vw] rounded-lg object-contain shadow-2xl"
      />

      <p className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold text-white">
        {index + 1} / {photos.length}
      </p>
    </div>
  )
}

// ───────────────────────── Not-found ─────────────────────────

function NotFoundAlbum({ slug }) {
  return (
    <article className="relative isolate overflow-hidden bg-forest-950">
      <GalleryAurora />
      <div className="container-prose relative z-10 flex min-h-[60vh] flex-col items-center justify-center pt-32 text-center">
        <h1 className="heading-serif text-3xl text-white sm:text-4xl">
          Album not found
        </h1>
        <p className="mt-3 text-silver/60">
          We couldn&rsquo;t find an album called{' '}
          <code className="text-medical-light">{slug}</code>.
        </p>
        <Link
          to="/gallery"
          className="mt-8 inline-flex items-center gap-2 rounded-full bg-medical px-6 py-3 text-sm font-semibold text-forest-950 hover:bg-medical-light"
        >
          See all albums
        </Link>
      </div>
    </article>
  )
}
