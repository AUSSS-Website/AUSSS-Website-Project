import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import PdfFrame from './PdfFrame.jsx'
import { pressCls } from '../lib/motion.js'
import { MIN_QUERY, buildPageIndex, matchRanges, searchDocument, snippet } from '../lib/pdfSearch.js'
import './PdfReader.css'

// A PDF read on the page, with a search bar above it.
//
// The browser's own PDF viewer (PdfFrame.jsx, an iframe) cannot be searched
// from the page, takes a while to start inside a frame, and shows nothing at
// all on most phones. So the pages are drawn here with pdf.js: each one as a
// picture with its words laid invisibly over it, which is what makes them
// selectable and searchable. Search finds a word or a phrase across the whole
// document, says how many times, steps through the matches and marks them on
// the page.
//
// It stays light. pdf.js (about 1 MB) is loaded only once the reader is near
// the screen; only the pages near view are drawn and far ones are let go, so
// a 70-page booklet does not fill a phone's memory; the file is fetched in
// pieces as pages are needed; and the words of the whole document are read
// only when someone first uses the search. If pdf.js cannot open the file,
// the old frame takes its place.
//
//   <PdfReader src="/assets/docs/x.pdf" title="AUSSS Constitution & Bylaws" />
//   heightClass  the height of the reading window (default 82vh)
//   startPage    the page it opens on (default 1)
//   large        a file of many megabytes: nothing is downloaded but the
//                pieces of the pages being read (a small file is quicker
//                fetched whole, in one request)

const MAX_FIT = 1100 // the widest a page is drawn at 100%, in CSS pixels
const MAX_PIXELS = 6_000_000 // one page's picture, so a phone keeps its memory
const ZOOMS = [1, 1.25, 1.5, 2, 2.5]
const NEAR = '900px 0px' // pages this close to view are drawn
const FAR = '3200px 0px' // pages beyond this are let go
const LIST_MAX = 200 // rows in the list of results
const NO_MATCHES = { query: '', matches: [], more: false }

// The pages that hold a reader are pre-rendered in Node, where a layout effect
// has nothing to do and React says so.
const useBeforePaint = typeof window === 'undefined' ? useEffect : useLayoutEffect

async function loadPdfJs() {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ])
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  return pdfjs
}

// Everything pdf.js: the open document, the pages on screen, their words and
// the marks of the current search. React owns the frame around it and the
// empty box of each page; this fills and empties those boxes.
class Engine {
  constructor({ pdfjs, task, doc, title, scroller, onPage, onRatio, onRead }) {
    Object.assign(this, { pdfjs, task, doc, title, scroller, onPage, onRatio, onRead })
    this.slots = []
    this.wanted = new Set()
    this.texts = new Map() // page number → promise of { content, strings }
    this.indexes = [] // page number - 1 → the page's searchable line
    this.search = { matches: [], current: null }
    this.width = 0
    this.pageNow = 1
    this.busy = false
    this.dead = false
    this.reading = false
    this.pendingReveal = false
    this.nearObserver = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const n = Number(e.target.dataset.page)
          if (e.isIntersecting) this.wanted.add(n)
          else this.wanted.delete(n)
        }
        this.pump()
      },
      { root: scroller, rootMargin: NEAR },
    )
    this.farObserver = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (!e.isIntersecting) this.release(Number(e.target.dataset.page))
      },
      { root: scroller, rootMargin: FAR },
    )
    this.onScroll = () => {
      if (this.frame) return
      this.frame = requestAnimationFrame(() => {
        this.frame = 0
        this.trackPage()
      })
    }
    scroller.addEventListener('scroll', this.onScroll, { passive: true })
  }

  // The page boxes React has put in the scroller.
  attach() {
    this.scroller.querySelectorAll('[data-page]').forEach((el) => {
      const n = Number(el.dataset.page)
      const slot = this.slots[n - 1]
      if (slot?.el === el) return
      this.slots[n - 1] = { el, state: 'empty', token: 0, task: null, layer: null, strings: null, marked: [] }
      this.nearObserver.observe(el)
      this.farObserver.observe(el)
    })
  }

  // The width pages are drawn at. A change empties what is drawn and draws
  // what is in view again.
  setWidth(px) {
    if (!px || px === this.width) return
    this.width = px
    this.slots.forEach((_, i) => this.release(i + 1))
    this.pump()
  }

  trackPage() {
    const line = this.scroller.scrollTop + this.scroller.clientHeight * 0.4
    let now = this.slots.length || 1
    for (let i = 0; i < this.slots.length; i++) {
      const el = this.slots[i]?.el
      if (el && el.offsetTop + el.offsetHeight > line) {
        now = i + 1
        break
      }
    }
    if (now !== this.pageNow) {
      this.pageNow = now
      this.onPage(now)
    }
  }

  goTo(n) {
    const el = this.slots[n - 1]?.el
    if (el) this.scroller.scrollTop = Math.max(0, el.offsetTop - 12)
  }

  // One page at a time, the one nearest to where the reader is first.
  pump() {
    if (this.busy || this.dead || !this.width) return
    let best = 0
    let bestGap = Infinity
    for (const n of this.wanted) {
      if (this.slots[n - 1]?.state !== 'empty') continue
      const gap = Math.abs(n - this.pageNow)
      if (gap < bestGap) {
        best = n
        bestGap = gap
      }
    }
    if (!best) return
    this.busy = true
    this.draw(best)
      .catch(() => {})
      .finally(() => {
        this.busy = false
        this.pump()
      })
  }

  // A page's words: what pdf.js read, and the pieces as plain strings (the
  // same pieces, in the same order, that its text layer turns into spans).
  text(n) {
    if (!this.texts.has(n)) {
      this.texts.set(
        n,
        this.doc
          .getPage(n)
          .then((page) => page.getTextContent())
          .then((content) => {
            const strings = content.items.filter((item) => item.str !== undefined).map((item) => item.str)
            this.indexes[n - 1] = buildPageIndex(strings)
            return { content, strings }
          }),
      )
    }
    return this.texts.get(n)
  }

  // Reads every page's words, for the search. Started by the first use of
  // the search bar; reports how far it has got.
  async readAll() {
    if (this.reading) return
    this.reading = true
    const total = this.doc.numPages
    for (let n = 1; n <= total; n++) {
      if (this.dead) return
      try {
        await this.text(n)
      } catch {
        this.indexes[n - 1] = buildPageIndex([])
      }
      if (n % 4 === 0 || n === total) this.onRead(n)
    }
  }

  async draw(n) {
    const slot = this.slots[n - 1]
    if (!slot || slot.state !== 'empty') return
    slot.state = 'drawing'
    const token = ++slot.token
    const stale = () => this.dead || slot.token !== token
    try {
      const page = await this.doc.getPage(n)
      if (stale()) return
      const base = page.getViewport({ scale: 1 })
      const scale = this.width / base.width
      const viewport = page.getViewport({ scale })
      this.onRatio(n, base.height / base.width)

      // Sharp on a dense screen, within what a phone can hold.
      let dense = Math.min(window.devicePixelRatio || 1, 2)
      const area = viewport.width * viewport.height
      if (area * dense * dense > MAX_PIXELS) dense = Math.sqrt(MAX_PIXELS / area)
      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(viewport.width * dense)
      canvas.height = Math.floor(viewport.height * dense)
      canvas.setAttribute('role', 'img')
      canvas.setAttribute('aria-label', `${this.title}, page ${n}`)
      slot.task = page.render({
        canvas,
        viewport,
        transform: dense !== 1 ? [dense, 0, 0, dense, 0, 0] : undefined,
      })
      await slot.task.promise
      if (stale()) return

      const { content, strings } = await this.text(n)
      if (stale()) return
      const words = document.createElement('div')
      words.className = 'textLayer'
      slot.el.style.setProperty('--total-scale-factor', String(scale))
      slot.el.style.setProperty('--scale-factor', String(scale))
      slot.el.style.setProperty('--scale-round-x', '1px')
      slot.el.style.setProperty('--scale-round-y', '1px')
      slot.layer = new this.pdfjs.TextLayer({ textContentSource: content, container: words, viewport })
      await slot.layer.render()
      if (stale()) return
      slot.strings = strings

      const links = await this.links(page, viewport)
      if (stale()) return
      slot.el.replaceChildren(canvas, words, ...links)
      slot.state = 'ready'
      slot.task = null
      this.paint(n)
    } catch (err) {
      if (!stale()) {
        // The box stays empty. It is tried again only after it has left the
        // screen and come back (release), never in a loop.
        slot.state = 'failed'
        slot.task = null
        if (err?.name !== 'RenderingCancelledException') console.warn(`PDF page ${n} could not be drawn`, err)
      }
    }
  }

  // The page's links to the web, as real links over where the PDF has them.
  // A page is never held up by its links: any trouble here leaves it without.
  async links(page, viewport) {
    try {
      return this.linkNodes(await page.getAnnotations({ intent: 'display' }), viewport)
    } catch {
      return []
    }
  }

  linkNodes(notes, viewport) {
    const out = []
    for (const note of notes) {
      if (note.subtype !== 'Link' || typeof note.url !== 'string' || !/^https?:\/\//i.test(note.url)) continue
      if (!Array.isArray(note.rect) || note.rect.length !== 4) continue
      const [x1, y1] = viewport.convertToViewportPoint(note.rect[0], note.rect[1])
      const [x2, y2] = viewport.convertToViewportPoint(note.rect[2], note.rect[3])
      const a = document.createElement('a')
      a.className = 'pdf-link'
      a.href = note.url
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      let host = note.url
      try {
        host = new URL(note.url).hostname
      } catch {
        // keep the address as it is
      }
      a.setAttribute('aria-label', `Link to ${host}`)
      a.title = note.url
      a.style.left = `${Math.min(x1, x2)}px`
      a.style.top = `${Math.min(y1, y2)}px`
      a.style.width = `${Math.abs(x2 - x1)}px`
      a.style.height = `${Math.abs(y2 - y1)}px`
      out.push(a)
    }
    return out
  }

  release(n) {
    const slot = this.slots[n - 1]
    if (!slot || slot.state === 'empty') return
    slot.token++
    try {
      slot.task?.cancel()
      slot.layer?.cancel()
    } catch {
      // already finished
    }
    slot.el.replaceChildren()
    Object.assign(slot, { state: 'empty', task: null, layer: null, strings: null, marked: [] })
  }

  // The matches of the search and the one the reader is on.
  setSearch(matches, current) {
    this.search = { matches, current }
    this.slots.forEach((slot, i) => {
      if (slot?.state === 'ready') this.paint(i + 1)
    })
  }

  // Marks the matches on one drawn page: each matched stretch of a word's
  // span is wrapped in a span of its own. Built with DOM nodes, never HTML.
  paint(n) {
    const slot = this.slots[n - 1]
    if (!slot || slot.state !== 'ready') return
    for (const [span, str] of slot.marked) span.textContent = str
    slot.marked = []
    const index = this.indexes[n - 1]
    const { matches, current } = this.search
    if (index && matches.length) {
      const byPiece = new Map()
      for (const m of matches) {
        if (m.page !== n) continue
        const here = Boolean(current) && current.page === m.page && current.n === m.n
        for (const r of matchRanges(index, m)) {
          if (!byPiece.has(r.piece)) byPiece.set(r.piece, [])
          byPiece.get(r.piece).push({ from: r.from, to: r.to, here })
        }
      }
      for (const [piece, ranges] of byPiece) {
        const span = slot.layer.textDivs[piece]
        const str = slot.strings[piece]
        if (!span || typeof str !== 'string') continue
        ranges.sort((a, b) => a.from - b.from)
        const nodes = []
        let pos = 0
        for (const r of ranges) {
          if (r.from < pos) continue
          if (r.from > pos) nodes.push(document.createTextNode(str.slice(pos, r.from)))
          const mark = document.createElement('span')
          mark.className = r.here ? 'pdf-hit pdf-hit-current' : 'pdf-hit'
          mark.textContent = str.slice(r.from, r.to)
          nodes.push(mark)
          pos = r.to
        }
        if (pos < str.length) nodes.push(document.createTextNode(str.slice(pos)))
        span.replaceChildren(...nodes)
        slot.marked.push([span, str])
      }
    }
    if (this.pendingReveal && current?.page === n) this.reveal()
  }

  // Brings the current match into view: straight to it when its page is
  // drawn, else to its page first and to the match once that is drawn.
  reveal() {
    const { current } = this.search
    if (!current) return
    const slot = this.slots[current.page - 1]
    const hit = slot?.state === 'ready' ? slot.el.querySelector('.pdf-hit-current') : null
    if (!hit) {
      this.pendingReveal = true
      this.goTo(current.page)
      return
    }
    this.pendingReveal = false
    const box = this.scroller.getBoundingClientRect()
    const at = hit.getBoundingClientRect()
    this.scroller.scrollTop += at.top - box.top - this.scroller.clientHeight * 0.3
    if (at.left < box.left || at.right > box.right) {
      this.scroller.scrollLeft += at.left - box.left - this.scroller.clientWidth * 0.3
    }
  }

  destroy() {
    this.dead = true
    this.nearObserver.disconnect()
    this.farObserver.disconnect()
    this.scroller.removeEventListener('scroll', this.onScroll)
    if (this.frame) cancelAnimationFrame(this.frame)
    this.slots.forEach((_, i) => this.release(i + 1))
    // Frees the worker's memory (the loading task owns the document in pdf.js v5 and later).
    this.task.destroy().catch(() => {})
  }
}

// The bar's buttons are 44px, a thumb's width: the reader is used on phones.
// A button that reaches its own end under the reader's hand (the two zoom
// buttons) is marked aria-disabled and not `disabled`: the browser takes the
// focus away from a button that is switched off and leaves it on the page
// itself, so a keyboard pressing "Larger" to the last step would be thrown out
// of the bar.
const barBtn = `inline-flex h-11 min-w-11 shrink-0 items-center justify-center rounded-full border border-line/15 bg-card px-2.5 text-sm font-medium text-soft/80 hover:border-medical/40 hover:text-ink disabled:opacity-40 disabled:hover:border-line/15 disabled:hover:text-soft/80 aria-disabled:pointer-events-none aria-disabled:opacity-40 ${pressCls}`

export default function PdfReader({ src, title, heightClass = 'h-[82vh]', startPage = 1, large = false }) {
  const id = useId()
  const wrapRef = useRef(null)
  const scrollerRef = useRef(null)
  const engineRef = useRef(null)
  const revealedFor = useRef('')
  const placeRef = useRef({ page: 1, into: 0, above: 0 }) // where the reader is (see notePlace)
  const sizedAt = useRef(0) // the page width that place was last laid out at

  const [near, setNear] = useState(false) // close enough to the screen to start loading
  const [status, setStatus] = useState('waiting') // waiting | loading | ready | failed
  const [pages, setPages] = useState(0)
  const [ratio, setRatio] = useState(1.4142) // height ÷ width of the first page
  const [ratios, setRatios] = useState({}) // pages shaped differently from the first
  const [fit, setFit] = useState(0) // the width of a page at 100%
  const [zoom, setZoom] = useState(1)
  const [pageNow, setPageNow] = useState(1)
  const [query, setQuery] = useState('')
  const [asked, setAsked] = useState('') // the query once typing has paused
  const [read, setRead] = useState(0) // pages whose words have been read
  const [at, setAt] = useState(0) // which match the reader is on
  const [listOpen, setListOpen] = useState(false)

  // Start only when the reader is near the screen.
  useEffect(() => {
    const el = wrapRef.current
    if (!el || near) return undefined
    if (!('IntersectionObserver' in window)) {
      setNear(true)
      return undefined
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true)
      },
      { rootMargin: '800px 0px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [near])

  // The room there is for a page.
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return undefined
    const measure = () => {
      const room = scroller.clientWidth
      const side = room < 500 ? 8 : 20
      setFit(Math.max(120, Math.min(MAX_FIT, room - side * 2)))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(scroller)
    return () => observer.disconnect()
  }, [status])

  // Open the document.
  useEffect(() => {
    if (!near) return undefined
    let dead = false
    let engine = null
    setStatus('loading')
    ;(async () => {
      try {
        const pdfjs = await loadPdfJs()
        if (dead) return
        const task = pdfjs.getDocument({
          url: src,
          // never fetch the rest of the file behind the reader's back
          disableAutoFetch: true,
          // a large file: only the pieces its pages need, a quarter of a megabyte at a time
          disableStream: large,
          rangeChunkSize: large ? 262144 : 65536,
          // the site's content policy allows neither WebAssembly nor code made from text;
          // none of these files needs either
          useWasm: false,
          isEvalSupported: false,
        })
        const doc = await task.promise
        if (dead) {
          task.destroy().catch(() => {})
          return
        }
        const first = await doc.getPage(1)
        const base = first.getViewport({ scale: 1 })
        if (dead) {
          task.destroy().catch(() => {})
          return
        }
        engine = new Engine({
          pdfjs,
          task,
          doc,
          title,
          scroller: scrollerRef.current,
          onPage: (n) => !dead && setPageNow(n),
          onRatio: (n, r) =>
            !dead && setRatios((old) => (Math.abs(r - base.height / base.width) < 0.01 || old[n] === r ? old : { ...old, [n]: r })),
          onRead: (n) => !dead && setRead(n),
        })
        engineRef.current = engine
        setRatio(base.height / base.width)
        setRatios({})
        setRead(0)
        setPageNow(1)
        setPages(doc.numPages)
        setStatus('ready')
      } catch (err) {
        if (!dead) {
          console.warn('The document reader could not open the file; showing it in a frame instead.', err)
          setStatus('failed')
        }
      }
    })()
    return () => {
      dead = true
      engine?.destroy()
      if (engineRef.current === engine) engineRef.current = null
    }
  }, [near, src, title, large])

  // Where the reader is: the page across the top edge of the window and how
  // far down it, as a share of its height. In the gap above a page it is that
  // page and the pixels above it, since the gaps do not grow with the pages.
  const notePlace = useCallback(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const top = scroller.scrollTop
    for (const el of scroller.querySelectorAll('[data-page]')) {
      if (el.offsetTop + el.offsetHeight > top) {
        const down = top - el.offsetTop
        placeRef.current = {
          page: Number(el.dataset.page),
          into: down > 0 ? down / el.offsetHeight : 0,
          above: down < 0 ? -down : 0,
        }
        return
      }
    }
  }, [])

  // Hand the page boxes to the engine, and open on the page asked for. The
  // place is noted here and now: the scroll event of that move comes a frame
  // later, and the pages can change width before it does (a scrollbar appears
  // with the pages and takes its room from them), which would put the reader
  // back at the place noted before, the top of page 1.
  useEffect(() => {
    const engine = engineRef.current
    if (status !== 'ready' || !engine || !pages) return
    engine.attach()
    if (startPage > 1 && startPage <= pages && !engine.opened) engine.goTo(startPage)
    engine.opened = true
    engine.trackPage()
    notePlace()
  }, [status, pages, startPage, notePlace])

  // Draw at the width there is: at once the first time, then after a short
  // wait, so dragging a window's edge does not redraw at every step.
  const width = Math.round(fit * zoom)
  useEffect(() => {
    const engine = engineRef.current
    if (status !== 'ready' || !width || !engine) return undefined
    if (!engine.width) {
      engine.setWidth(width)
      return undefined
    }
    const t = setTimeout(() => engine.setWidth(width), 120)
    return () => clearTimeout(t)
  }, [status, width, pages])

  // The place is noted again as the reader scrolls.
  useEffect(() => {
    const scroller = scrollerRef.current
    if (status !== 'ready' || !scroller) return undefined
    let frame = 0
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        notePlace()
      })
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
    }
  }, [status, notePlace])

  // Keep that place when the pages change size (the zoom buttons, a turned
  // phone, a window's edge dragged). Left alone, the window stays the same
  // number of pixels down a column that has just grown or shrunk: pressing
  // "Larger" on page 20 showed page 16, under a label still saying 20. Done
  // before the browser paints, so the other page is never seen.
  useBeforePaint(() => {
    const scroller = scrollerRef.current
    if (status !== 'ready' || !width || !scroller) {
      sizedAt.current = 0
      return
    }
    const was = sizedAt.current
    sizedAt.current = width
    if (!was || was === width) return
    const { page, into, above } = placeRef.current
    const el = scroller.querySelector(`[data-page="${page}"]`)
    if (el) scroller.scrollTop = Math.max(0, el.offsetTop - above + into * el.offsetHeight)
    engineRef.current?.trackPage()
  }, [status, width])

  // Search once typing has paused; an emptied box clears at once.
  useEffect(() => {
    if (query.trim().length < MIN_QUERY) {
      setAsked('')
      return undefined
    }
    const t = setTimeout(() => setAsked(query), 250)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => {
    setAt(0)
    if (asked) engineRef.current?.readAll()
  }, [asked])

  // `read` is here because the engine's page indexes fill in as it reads.
  const found = useMemo(
    () => (status === 'ready' && asked && engineRef.current ? searchDocument(engineRef.current.indexes, asked) : NO_MATCHES),
    [status, asked, read],
  )
  const matches = found.matches
  const current = matches.length ? matches[Math.min(at, matches.length - 1)] : null
  const reading = Boolean(asked) && read < pages

  // Mark the matches, and go to the first one of a new search.
  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    engine.setSearch(matches, current)
    if (current && revealedFor.current !== asked) {
      revealedFor.current = asked
      engine.reveal()
    }
    if (!asked) revealedFor.current = ''
  }, [matches, current, asked])

  const step = (by) => {
    if (!matches.length) return
    const next = (Math.min(at, matches.length - 1) + by + matches.length) % matches.length
    setAt(next)
    const engine = engineRef.current
    if (engine) {
      engine.setSearch(matches, matches[next])
      engine.reveal()
    }
  }
  const jump = (i) => {
    setAt(i)
    const engine = engineRef.current
    if (engine) {
      engine.setSearch(matches, matches[i])
      engine.reveal()
    }
  }

  if (status === 'failed') return <PdfFrame src={src} title={title} heightClass={heightClass} />

  const count = !asked
    ? ''
    : matches.length
      ? `${Math.min(at, matches.length - 1) + 1} of ${matches.length}${found.more ? '+' : ''}`
      : reading
        ? 'Searching…'
        : 'No matches'
  const zoomAt = ZOOMS.indexOf(zoom)
  // One step smaller or larger; nothing at either end.
  const zoomBy = (step) => {
    const next = ZOOMS[zoomAt + step]
    if (next) setZoom(next)
  }

  return (
    <div ref={wrapRef}>
      <div className="overflow-hidden rounded-2xl border border-line/10 bg-card">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2 border-b border-line/10 px-3 py-2.5 sm:gap-x-3 sm:px-4">
          <form
            role="search"
            className="flex min-w-0 flex-1 basis-56 items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              step(1)
            }}
          >
            <label htmlFor={`${id}-q`} className="sr-only">
              Search {title}
            </label>
            <div className="relative min-w-0 flex-1">
              <svg
                viewBox="0 0 24 24"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-soft/60"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" strokeLinecap="round" />
              </svg>
              <input
                id={`${id}-q`}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onFocus={() => engineRef.current?.readAll()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.shiftKey) {
                    e.preventDefault()
                    step(-1)
                  } else if (e.key === 'Escape' && query) {
                    e.preventDefault()
                    setQuery('')
                  }
                }}
                placeholder="Search this document"
                autoComplete="off"
                spellCheck={false}
                disabled={status !== 'ready'}
                className="h-11 w-full rounded-full border border-line/15 bg-sunk pl-9 pr-3 text-base text-ink placeholder:text-soft/55 focus:border-medical focus:outline-none focus-visible:ring-2 focus-visible:ring-medical/60 sm:text-sm"
              />
            </div>
            <button type="button" className={barBtn} onClick={() => step(-1)} disabled={matches.length < 2} aria-label="Previous match">
              ‹
            </button>
            <button type="submit" className={barBtn} disabled={matches.length < 2} aria-label="Next match">
              ›
            </button>
          </form>

          <p role="status" aria-live="polite" className="min-w-[3.5rem] text-xs font-medium text-soft/75 sm:min-w-[4.5rem]">
            {count}
          </p>
          {matches.length > 1 && (
            <button
              type="button"
              className={`${barBtn} px-3 text-xs`}
              onClick={() => setListOpen((v) => !v)}
              aria-expanded={listOpen}
              aria-controls={`${id}-list`}
            >
              {listOpen ? 'Hide list' : 'List'}
            </button>
          )}

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              className={barBtn}
              onClick={() => zoomBy(-1)}
              disabled={status !== 'ready'}
              aria-disabled={zoomAt <= 0}
              aria-label="Smaller"
            >
              −
            </button>
            <button
              type="button"
              className={barBtn}
              onClick={() => zoomBy(1)}
              disabled={status !== 'ready'}
              aria-disabled={zoomAt === ZOOMS.length - 1}
              aria-label="Larger"
            >
              +
            </button>
            <p className="whitespace-nowrap text-xs font-medium text-soft/75">
              {pages ? `Page ${pageNow} of ${pages}` : ''}
            </p>
          </div>
        </div>

        {listOpen && matches.length > 1 && (
          <ol id={`${id}-list`} className="max-h-60 overflow-y-auto border-b border-line/10 bg-sunk/60 px-2 py-2 sm:px-3">
            {matches.slice(0, LIST_MAX).map((m, i) => {
              const s = snippet(engineRef.current.indexes[m.page - 1], m)
              const here = current && current.page === m.page && current.n === m.n
              return (
                <li key={`${m.page}-${m.n}`}>
                  <button
                    type="button"
                    onClick={() => jump(i)}
                    aria-current={here ? 'true' : undefined}
                    className={`flex min-h-11 w-full gap-3 rounded-lg px-2 py-3 text-left text-xs leading-relaxed transition-colors hover:bg-veil/10 ${
                      here ? 'bg-veil/10' : ''
                    }`}
                  >
                    <span className="w-12 shrink-0 font-semibold text-accent">p. {m.page}</span>
                    <span className="min-w-0 break-words text-soft/80">
                      {s.before}
                      {/* On the dark theme the word is dark on a full amber: white
                          on the see-through amber came to under 3:1. */}
                      <mark className="rounded bg-amber-300/60 px-0.5 text-ink dark:bg-amber-300/90 dark:text-forest-950">
                        {s.hit}
                      </mark>
                      {s.after}
                    </span>
                  </button>
                </li>
              )
            })}
            {matches.length > LIST_MAX && (
              <li className="px-2 py-1.5 text-xs text-soft/70">
                The first {LIST_MAX} are listed. Add a word to narrow the search.
              </li>
            )}
          </ol>
        )}

        <div
          ref={scrollerRef}
          tabIndex={0}
          role="group"
          aria-label={title}
          className={`relative overflow-auto bg-sunk focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-medical/60 ${heightClass}`}
        >
          {status !== 'ready' ? (
            <div role="status" className="flex h-full flex-col items-center justify-center">
              <span
                aria-hidden="true"
                className="h-8 w-8 animate-spin rounded-full border-2 border-line/15 border-t-accent"
              />
              <p className="mt-4 text-sm text-soft/70">Opening the document…</p>
            </div>
          ) : (
            <div className="min-w-full space-y-3 px-2 py-3 sm:space-y-4 sm:px-5 sm:py-5" style={{ width: 'max-content' }}>
              {Array.from({ length: pages }, (_, i) => (
                <div
                  key={i}
                  data-page={i + 1}
                  className="pdf-page"
                  style={{ width, height: Math.round(width * (ratios[i + 1] || ratio)) }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      <p className="mt-3 text-center text-xs text-soft/60">
        Prefer your own viewer?{' '}
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-accent underline-offset-2 hover:text-ink hover:underline"
        >
          Open the PDF in a new tab
        </a>
        .
      </p>
    </div>
  )
}
