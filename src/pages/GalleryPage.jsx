import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import useReveal from '../hooks/useReveal.js'
import useMediaQuery from '../hooks/useMediaQuery.js'
import usePageTitle from '../hooks/usePageTitle.js'
import useFocusTrap from '../hooks/useFocusTrap.js'
import ImageTrail from '../components/ImageTrail.jsx'
import GalleryAurora from '../components/GalleryAurora.jsx'
import {
  GALLERY_ARCHIVE_DESCRIPTION,
  GALLERY_ARCHIVE_TITLE,
  archivedByTerm,
  currentAlbums,
  findAlbum,
  useGallery,
} from '../lib/gallery.js'
import { society } from '../data/society.js'
import { usePublicEmail } from '../hooks/useSiteSettings.js'
import { useTermVars } from '../hooks/useCurrentTerm.js'
import { pressCls } from '../lib/motion.js'
import { releaseSpeed, restingPlace, rubberband, springAt, wrap } from '../lib/photoStrip.js'
import NotFoundPage from './NotFoundPage.jsx'

// The albums come from the database (the PNSD officers edit them in the portal);
// src/lib/gallery.js decides what to show while the live document loads. A photo
// hidden or removed in the editor is simply absent here. /gallery shows this term's
// albums, /gallery/archive the earlier terms' (archived at the rollover), and an
// album's own page works either way.

// The links that close a page are one line of text to the eye. This gives a
// finger 44px to land on (in px, since the root size shrinks on a 320px phone)
// and takes back whatever that adds to the line (1.25rem at text-sm) with a
// negative margin, so nothing moves.
const tapLinkCls = '-my-[calc((44px_-_1.25rem)/2)] inline-flex min-h-[44px] items-center'

export default function GalleryPage({ archive = false }) {
  const { slug } = useParams()
  const { albums, trail, loading } = useGallery()
  // The list the page started from: the one the build baked in, or the one
  // this browser kept. useGallery puts another in its place only when the
  // live list arrives with albums in it, so a different list is the live one.
  const [startedWith] = useState(albums)
  const live = albums !== startedWith

  const { album, redirectTo } = findAlbum(albums, slug)
  // A link shared before the album was renamed still opens it.
  if (redirectTo) return <Navigate to={`/gallery/${redirectTo}`} replace />
  // An address that names no album gets the site's "not found" page, which
  // also asks search engines to leave the address out. Only the live list can
  // say so for certain: the list the page starts from may be older than the
  // album, and a read that failed says nothing either way. The archive's
  // albums are in the same list, so theirs still open. The gallery's own
  // views are a component of their own below, so only one of the two sets the
  // page title.
  if (slug && !album && !loading && live) return <NotFoundPage />
  return <GalleryView archive={archive} slug={slug} album={album} albums={albums} trail={trail} loading={loading} />
}

function GalleryView({ archive, slug, album, albums, trail, loading }) {
  usePageTitle(
    album ? album.title : archive ? GALLERY_ARCHIVE_TITLE : 'Gallery',
    archive && !album ? GALLERY_ARCHIVE_DESCRIPTION : undefined,
  )
  if (slug && !album) return loading ? <LoadingAlbum /> : <NotFoundAlbum slug={slug} />

  if (album) return <AlbumView album={album} />
  if (archive) return <GalleryArchive albums={albums} loading={loading} />
  return <GalleryIndex albums={albums} trail={trail} loading={loading} />
}

// ───────────────────────── Index view ─────────────────────────

function GalleryIndex({ albums: all, trail, loading }) {
  useReveal()
  // The society's age follows the current term (src/lib/anniversary.js).
  const { years } = useTermVars()
  const albums = currentAlbums(all)
  const hasArchive = albums.length < all.length
  const isDesktop = useMediaQuery('(min-width: 768px)')
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const hasTrail = trail.length > 0
  const showTrail = isDesktop && !reduceMotion && hasTrail

  return (
    <article className="bg-page">
      {/* Hero */}
      <header className="relative isolate flex min-h-[80vh] items-center overflow-hidden pt-24 sm:min-h-[88vh]">
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage: 'radial-gradient(circle, rgb(var(--c-soft)) 1px, transparent 1px)',
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
          {/* The panel is see-through over the aurora and the trail. It turns
              solid for a reader who asked for fewer see-through surfaces or
              for more contrast. */}
          <div className="pointer-events-auto mx-auto max-w-3xl rounded-3xl bg-page/70 px-6 py-10 ring-1 ring-line/10 backdrop-blur-md reduce-transparency:bg-page reduce-transparency:backdrop-filter-none contrast-more:bg-page contrast-more:backdrop-filter-none sm:px-12 sm:py-14">
            <span className="eyebrow justify-center">
              <span className="h-px w-8 bg-medical" />
              Gallery
              <span className="h-px w-8 bg-medical" />
            </span>
            <h1 className="heading-serif mt-6 text-4xl text-ink sm:text-6xl">
              {years} years through your eyes
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-base font-normal leading-relaxed text-soft/80 dark:font-light sm:text-lg">
              Camps, exchanges, assemblies, and the small in-between moments
              that make AUSSS what it is.
            </p>
            {showTrail && (
              <p className="mt-5 text-xs uppercase tracking-[0.2em] text-accent">
                Move your cursor →
              </p>
            )}
          </div>
        </div>
      </header>

      {/* Albums grid */}
      <div className="container-prose pb-20 pt-12">
        {albums.length === 0 && loading ? (
          // First visit: nothing cached yet and the live list is on its way.
          <div className="flex justify-center py-10">
            <span
              className="h-10 w-10 animate-spin rounded-full border-2 border-line/15 border-t-accent"
              role="status"
              aria-label="Loading albums"
            />
          </div>
        ) : albums.length === 0 ? (
          <p className="mx-auto max-w-xl rounded-2xl border border-dashed border-line/15 bg-veil/[0.03] p-8 text-center text-sm text-soft/60">
            {hasArchive ? (
              <>
                This term&rsquo;s albums are on their way. Earlier terms are in the{' '}
                <Link to="/gallery/archive" className="font-semibold text-accent hover:text-ink">
                  archive
                </Link>
                .
              </>
            ) : (
              'No albums to show yet. Check back soon.'
            )}
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

        <div className="reveal mt-16 flex flex-wrap items-center justify-center gap-6 text-sm">
          {hasArchive && albums.length > 0 && (
            <Link
              to="/gallery/archive"
              className={`${tapLinkCls} font-semibold text-accent transition-colors hover:text-ink`}
            >
              Earlier terms →
            </Link>
          )}
          <Link
            to="/"
            className={`${tapLinkCls} font-semibold transition-colors hover:text-ink ${
              hasArchive && albums.length > 0 ? 'text-soft/60' : 'text-accent'
            }`}
          >
            ← Back to AUSSS home
          </Link>
        </div>

        <GalleryDisclaimer />
      </div>
    </article>
  )
}

// ───────────────────────── Archive ─────────────────────────

function GalleryArchive({ albums, loading }) {
  useReveal()
  const terms = archivedByTerm(albums)

  return (
    <article className="bg-page">
      <header className="relative isolate overflow-hidden pb-12 pt-32 text-center sm:pt-40">
        <GalleryAurora />
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-28 bg-gradient-to-t from-page to-transparent"
          aria-hidden="true"
        />
        <div className="container-prose relative z-10">
          <span className="eyebrow justify-center">
            <span className="h-px w-8 bg-medical" />
            Archive
            <span className="h-px w-8 bg-medical" />
          </span>
          <h1 className="heading-serif mt-6 text-4xl text-ink sm:text-5xl">
            {GALLERY_ARCHIVE_TITLE}
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base font-normal leading-relaxed text-soft/75 dark:font-light">
            Every term&rsquo;s albums, kept once the term is over.
          </p>
        </div>
      </header>

      <div className="container-prose pb-20">
        {terms.length === 0 && loading ? (
          <div className="flex justify-center py-10">
            <span
              className="h-10 w-10 animate-spin rounded-full border-2 border-line/15 border-t-accent"
              role="status"
              aria-label="Loading the archive"
            />
          </div>
        ) : terms.length === 0 ? (
          <p className="mx-auto max-w-xl rounded-2xl border border-dashed border-line/15 bg-veil/[0.03] p-8 text-center text-sm text-soft/60">
            Nothing in the archive yet. A term&rsquo;s albums move here when it ends.
          </p>
        ) : (
          <div className="space-y-16">
            {terms.map((g) => (
              <section key={g.term} aria-labelledby={`term-${g.term}`}>
                <h2 id={`term-${g.term}`} className="heading-serif text-2xl text-ink sm:text-3xl">
                  Term {g.term}
                </h2>
                <p className="mt-1 text-sm text-soft/55">
                  {g.albums.length} {g.albums.length === 1 ? 'album' : 'albums'}
                </p>
                <ul className="mt-6 grid grid-cols-2 gap-3 sm:gap-6 lg:grid-cols-3">
                  {g.albums.map((a) => (
                    <li key={a.slug}>
                      <AlbumCard a={a} headingLevel={3} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        <div className="mt-16 flex flex-wrap items-center justify-center gap-6 text-sm">
          <Link to="/gallery" className={`${tapLinkCls} font-semibold text-accent transition-colors hover:text-ink`}>
            ← This term&rsquo;s albums
          </Link>
          <Link to="/" className={`${tapLinkCls} font-semibold text-soft/60 transition-colors hover:text-ink`}>
            AUSSS home
          </Link>
        </div>

        <GalleryDisclaimer />
      </div>
    </article>
  )
}

const AlbumCard = memo(function AlbumCard({ a, headingLevel = 2 }) {
  const Heading = `h${headingLevel}`
  return (
    // The reveal sits on a wrapper: on the link itself its transition would
    // replace the link's own, and the border would snap instead of easing.
    <div className="reveal">
      <Link
        to={`/gallery/${a.slug}`}
        className="group block overflow-hidden rounded-2xl border border-line/10 bg-card transition-colors hover:border-medical/40 active:border-medical/40 sm:rounded-3xl"
      >
        <div className="dark relative aspect-[4/3] overflow-hidden">
          {a.cover ? (
            <img
              src={a.cover}
              alt={a.title}
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-700 motion-safe:group-hover:scale-105"
            />
          ) : (
            <div className="h-full w-full bg-forest-700" />
          )}
          <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-page/85 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-3 sm:p-5">
            <p className="text-3xs font-bold uppercase tracking-[0.2em] text-accent">
              {a.count} {a.count === 1 ? 'photo' : 'photos'}
            </p>
            <Heading className="heading-serif mt-1 line-clamp-2 text-base text-ink sm:text-xl">
              {a.title}
            </Heading>
          </div>
        </div>
        {a.blurb && (
          <p className="hidden px-5 py-4 text-sm leading-relaxed text-soft/70 sm:block">
            {a.blurb}
          </p>
        )}
      </Link>
    </div>
  )
})

// ───────────────────────── Album view ─────────────────────────

function AlbumView({ album }) {
  useReveal()
  const [openIdx, setOpenIdx] = useState(null)
  const photos = album.photos

  // The album only knows which photo was opened. From there the lightbox
  // keeps its own place, since a swipe moves it between two photos.
  const open = openIdx != null
  const close = useCallback(() => setOpenIdx(null), [])

  // A featured photo (the editor puts it first) renders as a full-width
  // banner above the grid. The grid then shows the rest; `gridOffset` keeps
  // lightbox indices aligned with the full `photos` array.
  const featuredPhoto = photos[0]?.featured ? photos[0] : null
  const gridPhotos = featuredPhoto ? photos.slice(1) : photos
  const gridOffset = featuredPhoto ? 1 : 0

  return (
    <article className="bg-page">
      <header className="relative isolate overflow-hidden pb-12 pt-32 text-center sm:pt-40">
        <GalleryAurora />
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-28 bg-gradient-to-t from-page to-transparent"
          aria-hidden="true"
        />
        <div className="container-prose relative z-10">
          <span className="eyebrow justify-center">
            <span className="h-px w-8 bg-medical" />
            {album.term && `Term ${album.term} · `}
            {photos.length} {photos.length === 1 ? 'photo' : 'photos'}
            <span className="h-px w-8 bg-medical" />
          </span>
          <h1 className="heading-serif mt-6 text-4xl text-ink sm:text-5xl">
            {album.title}
          </h1>
          {album.blurb && (
            <p className="mx-auto mt-4 max-w-xl text-base font-normal leading-relaxed text-soft/75 dark:font-light">
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
              className="group block w-full overflow-hidden rounded-2xl bg-card focus:outline-none focus:ring-2 focus:ring-medical sm:rounded-3xl"
              aria-label={`Open featured photo (${featuredPhoto.label || 'featured'}) of ${photos.length}`}
            >
              <img
                src={featuredPhoto.full}
                alt={`${album.title}, ${featuredPhoto.label || 'featured photo'}`}
                width={featuredPhoto.w}
                height={featuredPhoto.h}
                decoding="async"
                fetchpriority="high"
                className="max-h-[72vh] w-full object-contain transition-transform duration-700 motion-safe:group-hover:scale-[1.02]"
              />
              <div
                className="dark pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-page/70 to-transparent"
                aria-hidden="true"
              />
              {featuredPhoto.label && (
                <figcaption className="dark absolute bottom-3 left-3 flex items-center gap-1.5 rounded-full bg-page/70 px-3 py-1.5 text-3xs font-bold uppercase tracking-[0.2em] text-accent ring-1 ring-line/10 backdrop-blur-sm reduce-transparency:bg-page reduce-transparency:backdrop-filter-none contrast-more:bg-page contrast-more:backdrop-filter-none sm:bottom-5 sm:left-5 sm:text-xs">
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
                  className="group block w-full overflow-hidden rounded-xl bg-card focus:outline-none focus:ring-2 focus:ring-medical"
                  aria-label={`Open photo ${i + 1} of ${photos.length}`}
                >
                  <div className="relative aspect-square overflow-hidden">
                    <img
                      src={p.thumb}
                      alt={`${album.title}, photo ${i + 1}`}
                      loading="lazy"
                      width={p.w}
                      height={p.h}
                      className="h-full w-full object-cover transition-transform duration-500 motion-safe:group-hover:scale-105"
                    />
                  </div>
                </button>
              </li>
            )
          })}
        </ul>

        <div className="mt-16 flex flex-wrap items-center justify-center gap-6 text-sm">
          <Link
            to={album.term ? '/gallery/archive' : '/gallery'}
            className={`${tapLinkCls} font-semibold text-accent transition-colors hover:text-ink`}
          >
            {album.term ? '← Gallery archive' : '← All albums'}
          </Link>
          <Link
            to="/"
            className={`${tapLinkCls} font-semibold text-soft/60 transition-colors hover:text-ink`}
          >
            AUSSS home
          </Link>
        </div>

        <GalleryDisclaimer />
      </div>

      {open && <Lightbox photos={photos} startIndex={openIdx} onClose={close} />}
    </article>
  )
}

// ───────────────────────── Disclaimer ─────────────────────────

function GalleryDisclaimer() {
  const email = usePublicEmail()(society.contact)
  return (
    <p className="mx-auto mt-12 max-w-2xl text-center text-xs leading-relaxed text-soft/45">
      These photos were taken at society events and shared by AUSSS members. If
      you&rsquo;d like a photo of you taken down, email{' '}
      <a
        href={`mailto:${email}?subject=Photo%20removal%20request`}
        className="text-accent underline-offset-2 transition-colors hover:text-ink hover:underline"
      >
        {email}
      </a>{' '}
      and we&rsquo;ll remove it promptly.
    </p>
  )
}

// ───────────────────────── Lightbox ─────────────────────────

// The photos sit side by side on a strip with no end: each has a place, a
// whole number, and past the last photo the album starts again. `at` is where
// the strip is, counted in photos, so 3.25 is a quarter of the way from place
// 3 to place 4. A drag sets it straight from the finger, and a spring carries
// it to rest on a whole number afterwards. None of it is a CSS transition, so
// a finger can take hold of a moving photo and it stops under it. The sums
// (the spring, the pull on a lone photo, the finger's speed and the place a
// release comes to rest on) are in src/lib/photoStrip.js, with their tests.

const LOCK_PX = 10 // a finger travels this far before its direction is read
const AT_REST = 0.0004 // nearer its place than this, the strip has arrived
const LEAVE_MS = 200 // the fade out, as long as the fade in (.enter-scrim)

// The strip's moving parts. `center` is the place nearest the middle of the
// screen (the photo either side of it is kept ready) and `shown` the place
// the strip rests on or is heading for. With `fade` (reduced motion) the
// photos stay where they are and cross-fade by the same measure, so a drag
// still answers the finger and nothing slides.
function usePhotoStrip({ start, count, fade, onBackdrop }) {
  const [center, setCenter] = useState(start)
  const [shown, setShown] = useState(start)
  const stage = useRef(null)
  const slides = useRef(new Map())
  const s = useRef({
    at: start,
    speed: 0, // photos per second
    heading: start,
    spring: null,
    frame: 0,
    drag: null,
    swiped: false,
    onPhoto: false,
  }).current
  // What the handlers read at the moment they run.
  const latest = useRef(null)
  latest.current = { count, fade, onBackdrop }

  const paint = useCallback(() => {
    for (const [place, el] of slides.current) {
      const away = place - s.at
      if (latest.current.fade) {
        el.style.transform = ''
        el.style.opacity = String(Math.max(0, 1 - Math.abs(away)))
      } else {
        el.style.opacity = ''
        el.style.transform = `translate3d(${away * 100}%, 0, 0)`
      }
    }
    setCenter(Math.round(s.at) || 0)
  }, [s])

  const tick = useCallback(() => {
    s.frame = 0
    const g = s.spring
    if (!g) return
    const next = springAt(g.from, g.speed, g.to, (performance.now() - g.since) / 1000)
    if (Math.abs(next.at - g.to) < AT_REST && Math.abs(next.speed) < 0.02) {
      // Arrived: put it exactly in place and stop asking for frames.
      s.at = g.to
      s.speed = 0
      s.spring = null
    } else {
      s.at = next.at
      s.speed = next.speed
      s.frame = requestAnimationFrame(tick)
    }
    paint()
  }, [s, paint])

  // Head for a place from wherever the strip is, at whatever speed it has.
  // Called while it is still moving, this bends the same motion to the new
  // place: nothing restarts and nothing jumps.
  const settle = useCallback(
    (to) => {
      s.heading = to
      setShown(to)
      s.spring = { from: s.at, speed: s.speed, to, since: performance.now() }
      if (!s.frame) s.frame = requestAnimationFrame(tick)
    },
    [s, tick],
  )

  // The buttons and the arrow keys: one photo on from where it is heading.
  const step = useCallback(
    (by) => {
      if (latest.current.count > 1) settle(s.heading + by)
    },
    [s, settle],
  )

  // Photos that have just come into the page are put in place before they
  // are seen.
  useLayoutEffect(paint)
  useEffect(() => () => cancelAnimationFrame(s.frame), [s])

  // Chrome reads a sideways flick as a scroll of its own, even where
  // touch-action leaves it nothing to scroll, and then swallows the next tap
  // as "the tap that stops the scroll": after a flick, Close or Next took two
  // taps. A touchmove of a drag we have taken is cancelled here, so that
  // scroll never begins. It needs a listener of its own, since React's are
  // passive and cannot cancel.
  useEffect(() => {
    const el = stage.current
    if (!el) return undefined
    const claim = (e) => {
      if (s.drag?.sideways && e.cancelable) e.preventDefault()
    }
    el.addEventListener('touchmove', claim, { passive: false })
    return () => el.removeEventListener('touchmove', claim)
  }, [s])

  const onPointerDown = (e) => {
    if (!e.isPrimary || e.button !== 0) return
    s.swiped = false
    s.onPhoto = e.target.tagName === 'IMG'
    // Pinched in to look closer: one finger then moves the picture about,
    // and that is the browser's job.
    if ((window.visualViewport?.scale || 1) > 1.01) return
    // A finger on a moving photo stops it there. Which way it was going is
    // kept for the release.
    const toward = s.spring ? Math.sign(s.heading - s.at) : 0
    cancelAnimationFrame(s.frame)
    s.frame = 0
    s.spring = null
    s.speed = 0
    s.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, sideways: null, from: s.at, toward, path: [] }
    // Keep hearing from this finger when it passes over a button or leaves
    // the window.
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }

  const onPointerMove = (e) => {
    const d = s.drag
    if (!d || e.pointerId !== d.id) return
    if (d.sideways === null) {
      const dx = e.clientX - d.x
      const dy = e.clientY - d.y
      if (Math.hypot(dx, dy) < LOCK_PX) return
      d.sideways = Math.abs(dx) > Math.abs(dy)
      // Follow from here, so the photo does not jump the distance the finger
      // has already covered.
      d.x = e.clientX
    }
    if (!d.sideways) return
    const width = stage.current?.clientWidth || 1
    const pull = e.clientX - d.x
    s.at = d.from - (latest.current.count > 1 ? pull : rubberband(pull, width)) / width
    d.path.push({ t: e.timeStamp, x: e.clientX })
    while (d.path.length > 1 && e.timeStamp - d.path[0].t > 100) d.path.shift()
    paint()
  }

  // `cancelled` is the browser taking the gesture over (a second finger, say):
  // the strip goes back to the photo it was heading for.
  const release = (e, cancelled) => {
    const d = s.drag
    if (!d || e.pointerId !== d.id) return
    s.drag = null
    let to = s.heading
    if (d.sideways) {
      // The click that ends a drag is not a tap on the dark around the photo.
      s.swiped = true
      if (!cancelled && latest.current.count > 1) {
        const speed = releaseSpeed(d.path, e.timeStamp)
        to = restingPlace({ at: s.at, moved: s.at - d.from, speed, heading: s.heading, toward: d.toward })
        // The spring starts at the finger's speed, so there is no seam
        // between the drag and the glide.
        s.speed = (-speed * 1000) / (stage.current?.clientWidth || 1)
      }
    }
    settle(to)
  }

  // A tap on the photo keeps the lightbox open; a tap on the dark around it
  // closes. Where the press began is remembered, because a captured pointer's
  // click may be reported on the stage whatever was under it.
  const onClick = (e) => {
    const wasTap = !s.swiped && !s.onPhoto && e.target.tagName !== 'IMG'
    s.swiped = false
    s.onPhoto = false
    if (wasTap) latest.current.onBackdrop()
  }

  return {
    stage,
    slides,
    center,
    shown,
    step,
    handlers: {
      // A press on the stage would take the focus out of the lightbox, and
      // with it Escape and the Tab order. This keeps it on the button it is on.
      onMouseDown: (e) => e.preventDefault(),
      onPointerDown,
      onPointerMove,
      onPointerUp: (e) => release(e, false),
      onPointerCancel: (e) => release(e, true),
      onLostPointerCapture: (e) => release(e, true),
      onClick,
    },
  }
}

function Lightbox({ photos, startIndex, onClose }) {
  const count = photos.length
  const fade = useMediaQuery('(prefers-reduced-motion: reduce)')

  // Closing fades the lightbox out the way it came in, then hands back to the
  // album, which takes it away.
  const [leaving, setLeaving] = useState(false)
  const leave = useCallback(() => setLeaving(true), [])
  useEffect(() => {
    if (!leaving) return undefined
    const timer = setTimeout(onClose, LEAVE_MS)
    return () => clearTimeout(timer)
  }, [leaving, onClose])

  // Trap focus inside the lightbox and return it to the trigger on close.
  const trapRef = useFocusTrap(true, leave)
  const strip = usePhotoStrip({ start: startIndex, count, fade, onBackdrop: leave })
  const { step } = strip

  // The arrow keys, wherever the focus is. Escape is the focus trap's: it
  // hears it inside the lightbox and, since it listens on the document too,
  // when the focus has got out.
  useEffect(() => {
    const onKey = (e) => {
      // Alt with an arrow is the browser's Back and Forward.
      if (e.altKey || e.ctrlKey || e.metaKey) return
      if (e.key === 'ArrowRight') step(1)
      else if (e.key === 'ArrowLeft') step(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step])

  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [])

  // While the reader is pinched in, sideways drags go back to the browser so
  // the enlarged picture can be moved about.
  const [zoomed, setZoomed] = useState(false)
  useEffect(() => {
    const view = window.visualViewport
    if (!view) return undefined
    const read = () => setZoomed(view.scale > 1.01)
    read()
    view.addEventListener('resize', read)
    return () => view.removeEventListener('resize', read)
  }, [])

  if (count === 0) return null

  const number = wrap(strip.shown, count) + 1
  const places = count > 1 ? [strip.center - 1, strip.center, strip.center + 1] : [strip.center]
  // The pressed colour is what answers a finger where nothing hovers and,
  // with reduced motion, nothing sinks.
  const roundBtn = `absolute z-10 grid h-12 w-12 place-items-center rounded-full bg-veil/10 text-ink hover:bg-veil/20 active:bg-veil/20 ${pressCls}`

  return (
    // On its way out the lightbox still takes every tap and does nothing with
    // it. Were it to let them through, the second tap of a double tap on
    // Close would land on the menu button of the site's header behind it.
    <div
      ref={trapRef}
      className={`dark enter-scrim fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-page/95 backdrop-blur-sm reduce-transparency:backdrop-filter-none ${
        leaving ? '[&>*]:pointer-events-none' : ''
      }`}
      style={leaving ? { opacity: 0 } : undefined}
      role="dialog"
      aria-modal="true"
      aria-label={`Photo ${number} of ${count}`}
    >
      {/* The stage takes the drags. Up and down, and two fingers, stay with
          the browser (touch-action), so the page can still be pinched. On the
          way out it sinks back the way it rose, unless motion is reduced. */}
      <div
        ref={strip.stage}
        className="enter-panel absolute inset-0 select-none"
        style={{
          touchAction: zoomed ? 'auto' : 'pan-y pinch-zoom',
          ...(leaving && !fade ? { opacity: 0, translate: '0 8px', scale: '0.98' } : null),
        }}
        {...strip.handlers}
      >
        {places.map((place) => {
          const i = wrap(place, count)
          const current = place === strip.shown
          return (
            <div
              key={place}
              ref={(el) => {
                if (el) strip.slides.current.set(place, el)
                else strip.slides.current.delete(place)
              }}
              aria-hidden={current ? undefined : true}
              className={`absolute inset-0 grid place-items-center ${current ? '' : 'pointer-events-none'}`}
            >
              <LightboxPhoto photo={photos[i]} alt={`Photo ${i + 1} of ${count}`} current={current} />
            </div>
          )
        })}
      </div>

      <button
        type="button"
        onClick={leave}
        className={`${roundBtn} right-4 top-4`}
        aria-label="Close"
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
        </svg>
      </button>

      {count > 1 && (
        <>
          <button
            type="button"
            onClick={() => step(-1)}
            className={`${roundBtn} left-2 sm:left-6`}
            aria-label="Previous photo"
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          <button
            type="button"
            onClick={() => step(1)}
            className={`${roundBtn} right-2 sm:right-6`}
            aria-label="Next photo"
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </>
      )}

      {/* The number is said aloud as it changes; the figures are for the eye. */}
      <p
        role="status"
        className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-veil/10 px-4 py-1.5 text-xs font-semibold text-ink"
      >
        <span aria-hidden="true">
          {number} / {count}
        </span>
        <span className="sr-only">
          Photo {number} of {count}
        </span>
      </p>
    </div>
  )
}

// One photo, in the box it will fill once its file arrives. The grid's small
// copy, already in the browser, fills the box until then (and hides the
// words that stand in for a picture still loading), so a swipe never lands on
// an empty frame. A photo saved without its size waits as before.
function LightboxPhoto({ photo, alt, current }) {
  const sized = photo.w > 0 && photo.h > 0
  return (
    <img
      src={photo.full}
      alt={alt}
      draggable={false}
      decoding="async"
      fetchpriority={current ? 'high' : 'low'}
      className={`max-h-[88vh] max-w-[92vw] rounded-lg object-contain shadow-2xl ${sized ? 'text-transparent' : ''}`}
      style={
        sized
          ? {
              aspectRatio: `${photo.w} / ${photo.h}`,
              width: `min(92vw, ${((88 * photo.w) / photo.h).toFixed(2)}vh, ${photo.w}px)`,
              backgroundImage: `url("${photo.thumb}")`,
              backgroundSize: 'cover',
            }
          : undefined
      }
    />
  )
}

// ───────────────────────── Loading / not-found ─────────────────────────

// Shown for an album slug we do not know yet while the live list is still on
// its way (a brand-new album opened from a shared link).
function LoadingAlbum() {
  return (
    <article className="relative isolate overflow-hidden bg-page">
      <GalleryAurora />
      <div className="container-prose relative z-10 flex min-h-[60vh] items-center justify-center pt-32">
        <span
          className="h-10 w-10 animate-spin rounded-full border-2 border-line/15 border-t-accent"
          role="status"
          aria-label="Loading album"
        />
      </div>
    </article>
  )
}

// Shown for an album the page does not know when the live list never came
// (the read failed, or it came back with no albums at all): the album may be
// a new one, so this says so on the gallery's own page and leaves the
// address to search engines. Once the live list has it or has it not, the
// page is the album or the site's "not found" page (GalleryPage above).
function NotFoundAlbum({ slug }) {
  return (
    <article className="relative isolate overflow-hidden bg-page">
      <GalleryAurora />
      <div className="container-prose relative z-10 flex min-h-[60vh] flex-col items-center justify-center pt-32 text-center">
        <h1 className="heading-serif text-3xl text-ink sm:text-4xl">
          Album not found
        </h1>
        <p className="mt-3 text-soft/60">
          We couldn&rsquo;t find an album called{' '}
          <code className="text-accent">{slug}</code>.
        </p>
        <Link
          to="/gallery"
          className={`mt-8 inline-flex items-center gap-2 rounded-full bg-cta px-6 py-3 text-sm font-semibold text-on-cta hover:bg-cta-hover ${pressCls}`}
        >
          See all albums
        </Link>
      </div>
    </article>
  )
}
