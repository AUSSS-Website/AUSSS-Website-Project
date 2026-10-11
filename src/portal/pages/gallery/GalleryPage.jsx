import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import usePageTitle from '../../../hooks/usePageTitle.js'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { galleryError, useAlbumMutations, useAlbums, useCurrentTerm } from '../../galleryQueries.js'
import {
  ErrorText,
  Field,
  PageHeader,
  PageLoading,
  Panel,
  UndoLine,
  inputCls,
  outlineBtnCls,
  primaryBtnCls,
} from '../../portalUi.jsx'
import SortableList from '../../SortableList.jsx'
import { ShareLinkButton, siteAlbumUrl, tapCls } from './galleryUi.jsx'

// /portal/gallery. The shelf: every album in the order visitors see it, with
// its cover, photo count and shareable link. PNSD officers and the EB add
// albums here and drag them into order (the handle at the left of each row;
// the arrow keys work on it too); the album itself is edited on its own page.
// Below the shelf, the archive: last terms' albums, filed by term at the
// rollover (or one at a time with "Archive"), still reachable at their links.

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
      {/* The padding is the link's own, for a finger; the margins take it back out of the layout. */}
      <Link
        to="/portal"
        className="-mb-3 mt-1 inline-block py-3 text-sm font-semibold text-accent hover:text-ink"
      >
        &larr; Back to your dashboard
      </Link>
    </Panel>
  )
}

function NewAlbumForm({ onCreated, onCancel }) {
  const { create } = useAlbumMutations()
  const [title, setTitle] = useState('')
  const [blurb, setBlurb] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    if (!title.trim()) return
    let row
    try {
      row = await create.mutateAsync({ title: title.trim(), blurb: blurb.trim() })
    } catch {
      // create.error says why, above the buttons.
      return
    }
    onCreated(row)
  }

  return (
    <Panel title="New album" className="mb-8">
      <form onSubmit={submit} className="mt-4 grid gap-5">
        <Field label="Title" htmlFor="new-album-title" hint="The link is made from it, for example /gallery/aswan-nga-2026. You can change both later.">
          <input
            id="new-album-title"
            className={`${inputCls} ${tapCls}`}
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
            className={`${inputCls} ${tapCls}`}
            value={blurb}
            onChange={(e) => setBlurb(e.target.value)}
            maxLength={500}
          />
        </Field>
        {create.error && <ErrorText>{galleryError(create.error, 'Couldn’t create the album.')}</ErrorText>}
        <div className="flex flex-wrap gap-3">
          <button type="submit" className={`${primaryBtnCls} ${tapCls}`} disabled={create.isPending || !title.trim()}>
            {create.isPending ? 'Creating…' : 'Create and add photos'}
          </button>
          {/* Off while the album is being made: it would open a moment later all the same. */}
          <button type="button" className={`${outlineBtnCls} ${tapCls}`} onClick={onCancel} disabled={create.isPending}>
            Cancel
          </button>
        </div>
      </form>
    </Panel>
  )
}

function AlbumRow({ a, handle, onMove }) {
  return (
    <div className="flex flex-wrap items-center gap-3 p-3 sm:flex-nowrap sm:gap-4">
      {handle}
      {/* The cover goes where the title beside it goes, so it is one link to the
          keyboard and to a screen reader: the title's. */}
      <Link
        to={`/portal/gallery/${a.slug}`}
        tabIndex={-1}
        aria-hidden="true"
        className="block h-20 w-28 shrink-0 overflow-hidden rounded-xl bg-page"
      >
        {a.cover ? (
          <img src={a.cover} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <span className="grid h-full w-full place-items-center text-3xs uppercase tracking-[0.2em] text-soft/40">
            No photos
          </span>
        )}
      </Link>
      <div className="min-w-0 flex-1">
        {/* Beside the cover a phone has room for ten letters or so, and two
            albums of one event read alike when cut there: the title takes two
            lines on a phone, one from a tablet up. */}
        <Link
          to={`/portal/gallery/${a.slug}`}
          className="heading-serif line-clamp-2 break-words text-lg leading-snug text-ink transition-colors duration-150 hover:text-accent sm:line-clamp-1"
        >
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
      {/* On a phone the buttons have a line to themselves and may wrap within
          it; beside the title, from a tablet up, they keep their width. */}
      <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
        <ShareLinkButton slug={a.slug} />
        <Link to={`/portal/gallery/${a.slug}`} className={`${outlineBtnCls} ${tapCls}`}>
          Edit
        </Link>
        {onMove && (
          <button type="button" className={`${outlineBtnCls} ${tapCls}`} onClick={onMove}>
            {a.archived_term_id ? 'Back to the gallery' : 'Archive'}
          </button>
        )}
      </div>
    </div>
  )
}

// The archive's albums by term, latest term first.
function archiveGroups(albums) {
  const groups = new Map()
  for (const a of albums) {
    const term = a.archived_term?.label || 'Archive'
    if (!groups.has(term)) groups.set(term, [])
    groups.get(term).push(a)
  }
  return [...groups.entries()].sort(([x], [y]) => y.localeCompare(x))
}

export default function GalleryPage() {
  usePageTitle('Gallery editor')
  const navigate = useNavigate()
  const albums = useAlbums()
  const term = useCurrentTerm()
  const { reorder, set } = useAlbumMutations()
  const shelf = (albums.data || []).filter((a) => !a.archived_term_id)
  const archived = (albums.data || []).filter((a) => a.archived_term_id)
  const [adding, setAdding] = useState(false)

  // Cancel takes the form away, and the keyboard goes back to the button that
  // opened it.
  const newAlbum = useRef(null)
  const refocus = useRef(false)
  useEffect(() => {
    if (adding || !refocus.current) return
    refocus.current = false
    newAlbum.current?.focus()
  }, [adding])

  // An album sent to the archive, or back to the gallery, moves at once and
  // leaves the list it was in. `moved` is the last such move, for the line
  // that offers to take it back, shown where the album was (`from`): its id
  // and title, the term it was filed under before, and `undone` once it has
  // been taken back. `failed` is the move that did not save, said in the same
  // place.
  const [moved, setMoved] = useState(null)
  const [failed, setFailed] = useState(null)

  // The button that was pressed leaves with its row (Archive, Back to the
  // gallery), or goes once there is nothing left to take back (Undo). Either
  // way the keyboard would be left on the page itself, to start again from the
  // top. It is put on the line that says what happened, and Undo is the next
  // stop from there. `landing` is the list whose line is waited for, and
  // whether the page may scroll to it: for a key press it should, so the line
  // is in sight; under a pointer the page stays where it is.
  const lines = useRef({})
  const landing = useRef(null)
  const land = (where, e) => {
    if (e?.currentTarget === document.activeElement) landing.current = { where, scroll: e.detail === 0 }
  }

  const file = (id, termId, archivedTerm) =>
    set.mutateAsync({ id, patch: { archived_term_id: termId }, shown: { archived_term: archivedTerm } })

  const move = (a, e) => {
    const toArchive = !a.archived_term_id
    const from = toArchive ? 'gallery' : 'archive'
    land(from, e)
    setFailed(null)
    // `holds`: this list's line is up already, about the move before this one.
    setMoved({ id: a.id, title: a.title, from, termId: a.archived_term_id, term: a.archived_term, holds: lineIn === from })
    file(a.id, toArchive ? term.data.id : null, toArchive ? { label: term.data.label } : null).catch((err) => {
      // The album is back where it was: there is nothing to undo.
      setMoved((m) => (m?.id === a.id ? null : m))
      const fallback = toArchive ? `Couldn’t archive ${a.title}.` : `Couldn’t move ${a.title} back to the gallery.`
      setFailed({ from, text: galleryError(err, fallback) })
    })
  }
  const undoMove = (e) => {
    const m = moved
    land(m.from, e)
    setFailed(null)
    setMoved({ ...m, undone: true })
    file(m.id, m.termId, m.term).catch((err) => {
      // The album is still where the move put it, and can still be taken back.
      setMoved((now) => (now?.id === m.id && now.undone ? { ...now, undone: false } : now))
      setFailed({ from: m.from, text: galleryError(err, `Couldn’t move ${m.title} back.`) })
    })
  }

  // What the line says goes by where the album is now, not by what was
  // pressed: the album moves a moment after the press, and the line changes
  // with it, in one step. While the album is where the move put it the line
  // says so and offers Undo; once Undo has taken it back the line says that,
  // with nothing left to take back. If the album is somewhere else for another
  // reason (the move failed, another editor moved it) there is nothing to say.
  const there = moved && (albums.data || []).find((a) => a.id === moved.id)
  const toArchive = moved?.from === 'gallery'
  const inPlace = Boolean(there) && Boolean(there.archived_term_id) === toArchive
  const lineText = !there
    ? null
    : inPlace
      ? `${moved.title} moved ${toArchive ? 'to the archive' : 'back to the gallery'}.`
      : moved.undone
        ? `${moved.title} is back in the ${toArchive ? 'gallery' : 'archive'}.`
        : null
  const lineIn = lineText ? moved.from : null
  // A move made while the line was up takes the line over a moment before its
  // own words are ready. The line keeps its height for that moment, so the
  // list under it does not jump up and back.
  const holdIn = !lineText && there && moved.holds && !moved.undone ? moved.from : null

  useEffect(() => {
    const due = landing.current
    if (!due || lineIn !== due.where) return
    landing.current = null
    const held = document.activeElement
    if (!held || held === document.body) lines.current[due.where]?.focus({ preventScroll: !due.scroll })
  })

  // Both lists keep their line in the page, empty until there is something to
  // say, so a screen reader reads it when it comes. The box around it is what
  // the keyboard is put on (see `land`).
  const moveLine = (where) => (
    <div
      ref={(el) => {
        lines.current[where] = el
      }}
      tabIndex={-1}
      // The side padding, taken back out by the margin, keeps the outline off the words.
      className="-mx-2 rounded-lg px-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
    >
      <UndoLine onUndo={inPlace && !moved.undone ? undoMove : undefined} className="mb-3 py-2">
        {lineIn === where ? lineText : holdIn === where ? <span aria-hidden="true">&nbsp;</span> : null}
      </UndoLine>
      {failed?.from === where && (
        <div className="mb-3">
          <ErrorText>{failed.text}</ErrorText>
        </div>
      )}
    </div>
  )

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
              className={`${outlineBtnCls} ${tapCls}`}
            >
              View public gallery ↗
            </Link>
            {!adding && (
              <button ref={newAlbum} type="button" className={`${primaryBtnCls} ${tapCls}`} onClick={() => setAdding(true)}>
                New album
              </button>
            )}
          </div>
        }
      />

      {adding && (
        <NewAlbumForm
          // Straight to the new album's own page, where the photos are added.
          onCreated={(row) => navigate(`/portal/gallery/${row.slug}`)}
          onCancel={() => {
            refocus.current = true
            setAdding(false)
          }}
        />
      )}

      {/* A shelf already on screen stays there if reading it again fails: the
          error is for a shelf that could not be read at all. */}
      {albums.isPending ? (
        <PageLoading />
      ) : !albums.data ? (
        <Panel>
          <ErrorText>{galleryError(albums.error, 'Couldn’t load the albums.')}</ErrorText>
        </Panel>
      ) : albums.data.length === 0 ? (
        <Panel>
          <p className="text-sm text-soft/70">
            No albums yet. Create one, then drop the photos onto its page.
          </p>
        </Panel>
      ) : (
        <>
          {reorder.error && (
            <div className="mb-3">
              <ErrorText>{galleryError(reorder.error, 'Couldn’t save the new order.')}</ErrorText>
            </div>
          )}
          {moveLine('gallery')}
          {shelf.length === 0 ? (
            <Panel>
              <p className="text-sm text-soft/70">
                The gallery is empty: every album is in the archive. Create one for this term.
              </p>
            </Panel>
          ) : (
            <SortableList
              items={shelf}
              getId={(a) => a.id}
              getLabel={(a) => a.title}
              onReorder={(ids) => reorder.mutate(ids)}
              className="grid gap-3"
              itemClassName="min-w-0 rounded-2xl border border-line/10 bg-card"
              renderItem={(a, handle) => <AlbumRow a={a} handle={handle} onMove={term.data ? (e) => move(a, e) : null} />}
            />
          )}

          {/* The archive stays while its line has something to say, even with
              its last album gone back to the gallery. */}
          {(archived.length > 0 || lineIn === 'archive' || failed?.from === 'archive') && (
            <section className="mt-12" aria-labelledby="gallery-archive">
              <h2 id="gallery-archive" className="heading-serif text-2xl text-ink">
                Archive
              </h2>
              <p className="mb-3 mt-1 text-sm text-soft/60">
                Earlier terms’ albums. Visitors find them under{' '}
                <a href="/gallery/archive" target="_blank" rel="noopener noreferrer" className="font-semibold text-accent hover:text-ink">
                  Gallery archive ↗
                </a>
                , and their links still work.
              </p>
              {moveLine('archive')}
              {archiveGroups(archived).map(([label, list]) => (
                <div key={label} className="mt-6">
                  <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
                    {/^\d{4}-\d{2}$/.test(label) ? `Term ${label}` : label}
                  </h3>
                  <ul className="mt-3 grid gap-3">
                    {list.map((a) => (
                      <li key={a.id} className="min-w-0 rounded-2xl border border-line/10 bg-card">
                        <AlbumRow a={a} onMove={(e) => move(a, e)} />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          )}
        </>
      )}
    </GalleryGate>
  )
}
