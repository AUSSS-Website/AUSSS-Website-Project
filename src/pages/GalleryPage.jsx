import { memo, useCallback, useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import useReveal from '../hooks/useReveal.js'
import useMediaQuery from '../hooks/useMediaQuery.js'
import usePageTitle from '../hooks/usePageTitle.js'
import useFocusTrap from '../hooks/useFocusTrap.js'
import ImageTrail from '../components/ImageTrail.jsx'
import GalleryAurora from '../components/GalleryAurora.jsx'
import { findAlbum, useGallery } from '../lib/gallery.js'
import { society } from '../data/society.js'

// The albums come from the database (the PNSD officers edit them in the portal);
// src/lib/gallery.js decides what to show while the live document loads. A photo
// hidden or removed in the editor is simply absent here.

export default function GalleryPage() {
  const { slug } = useParams()
  const { albums, trail, loading } = useGallery()

  const { album, redirectTo } = findAlbum(albums, slug)
  usePageTitle(album ? album.title : 'Gallery')
  // A link shared before the album was renamed still opens it.
  if (redirectTo) return <Navigate to={`/gallery/${redirectTo}`} replace />
  if (slug && !album) return loading ? <LoadingAlbum /> : <NotFoundAlbum slug={slug} />

  return album ? <AlbumView album={album} /> : <GalleryIndex albums={albums} trail={trail} />
}

// ───────────────────────── Index view ─────────────────────────

function GalleryIndex({ albums, trail }) {
  useReveal()
  const isDesktop = useMediaQuery('(min-width: 768px)')
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const hasTrail = trail.length > 0
  const showTrail = isDesktop && !reduceMotion && hasTrail

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
            <ImageTrail items={trail} />
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
            No albums to show yet. Check back soon.
          </p>
        ) : (
          <>
            {/* Mobile: two staggered columns (zigzag), matching the merch page. */}
            <div className="grid grid-cols-2 gap-3 sm:hidden">
              <div className="flex flex-col gap-3">
                {albums.map((a, i) => (i % 2 === 0 ? <AlbumCard key={a.slug} a={a} /> : null))}
              </div>
              <div className="flex flex-col gap-3 pt-10">
                {albums.map((a, i) => (i % 2 === 1 ? <AlbumCard key={a.slug} a={a} /> : null))}
              </div>
            </div>

            {/* Desktop: even grid. */}
            <ul className="hidden gap-6 sm:grid sm:grid-cols-2 lg:grid-cols-3">
              {albums.map((a) => (
                <li key={a.slug}>
                  <AlbumCard a={a} />
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
    </article>
  )
}

const AlbumCard = memo(function AlbumCard({ a }) {
  return (
    <Link
      to={`/gallery/${a.slug}`}
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

function AlbumView({ album }) {
  useReveal()
  const [openIdx, setOpenIdx] = useState(null)
  const photos = album.photos

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

  // A featured photo (the editor puts it first) renders as a full-width
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
                className="max-h-[72vh] w-full object-contain transition-transform duration-700 group-hover:scale-[1.02]"
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
          </figure>
        )}
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4">
          {gridPhotos.map((p, gi) => {
            const i = gi + gridOffset
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
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  </div>
                </button>
              </li>
            )
          })}
        </ul>

        <div className="mt-16 flex flex-wrap items-center justify-center gap-6 text-sm">
          <Link
            to="/gallery"
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
    </article>
  )
}

// ───────────────────────── Disclaimer ─────────────────────────

function GalleryDisclaimer() {
  return (
    <p className="mx-auto mt-12 max-w-2xl text-center text-xs leading-relaxed text-silver/45">
      These photos were taken at society events and shared by AUSSS members. If
      you&rsquo;d like a photo of you taken down, email{' '}
      <a
        href={`mailto:${society.contactEmail}?subject=Photo%20removal%20request`}
        className="text-medical-light underline-offset-2 transition-colors hover:text-white hover:underline"
      >
        {society.contactEmail}
      </a>{' '}
      and we&rsquo;ll remove it promptly.
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

// ───────────────────────── Loading / not-found ─────────────────────────

// Shown for an album slug we do not know yet while the live list is still on
// its way (a brand-new album opened from a shared link).
function LoadingAlbum() {
  return (
    <article className="relative isolate overflow-hidden bg-forest-950">
      <GalleryAurora />
      <div className="container-prose relative z-10 flex min-h-[60vh] items-center justify-center pt-32">
        <span className="h-10 w-10 animate-spin rounded-full border-2 border-white/15 border-t-medical-light" aria-label="Loading album" />
      </div>
    </article>
  )
}

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
