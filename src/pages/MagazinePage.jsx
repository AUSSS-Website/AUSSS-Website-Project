import { useState, lazy, Suspense, Component } from 'react'
import useReveal from '../hooks/useReveal.js'
import usePageTitle from '../hooks/usePageTitle.js'
import { magazine, shelfIssues, isMissing, ARCHIVE_CONTACT } from '../data/magazine.js'
import CanvaFrame from '../components/CanvaFrame.jsx'
import ShareBar from '../components/ShareBar.jsx'
import MagazineEngagement from '../components/MagazineEngagement.jsx'
import { trackMagazineDownload } from '../hooks/useMagazineEngagement.js'
import GalleryAurora from '../components/GalleryAurora.jsx'

// The flipbook pulls in pdf.js + react-pageflip, lazy-load it so the page
// shell paints immediately and the heavy reader streams in after.
const Flipbook = lazy(() => import('../components/Flipbook.jsx'))

// /magazine shows the latest published edition by default. Once two or more
// editions are published (see src/data/magazine.js) a small switcher lets
// readers move between them; with a single edition it renders nothing, so the
// single-issue experience is unchanged.
export default function MagazinePage() {
  usePageTitle('Magazine')
  useReveal()
  // Default to the latest published edition; `selected` tracks the switcher.
  const [selectedId, setSelectedId] = useState(magazine?.id ?? null)
  if (!magazine) return <EmptyShelf />
  const issue = shelfIssues.find((i) => i.id === selectedId) || magazine
  return (
    <IssueView issue={issue} issues={shelfIssues} onSelect={setSelectedId} />
  )
}

// Compact edition switcher, only rendered when 2+ editions are published.
function IssueSwitcher({ issues, currentId, onSelect }) {
  if (!issues || issues.length < 2) return null
  return (
    <div className="mt-6 flex flex-wrap items-center gap-2" role="group" aria-label="Choose an edition">
      {issues.map((it) => {
        const active = it.id === currentId
        const missing = isMissing(it)
        const style = active
          ? 'border-medical/40 bg-medical/15 text-medical-light'
          : missing
            ? 'border-dashed border-white/15 bg-transparent text-silver/40 hover:border-white/30 hover:text-silver/70'
            : 'border-white/15 bg-forest-800 text-silver/70 hover:border-medical/40 hover:text-white'
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => onSelect(it.id)}
            aria-pressed={active}
            title={missing ? 'We’re still locating this edition' : undefined}
            className={`rounded-full border px-4 py-1.5 text-xs font-semibold transition-colors ${style}`}
          >
            {it.switcherLabel || it.title}
          </button>
        )
      })}
    </div>
  )
}

// ── Cover thumbnail (image, or a gradient placeholder when none yet) ─────────
function Cover({ src, alt, label }) {
  const [failed, setFailed] = useState(false)
  if (src && !failed) {
    return (
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className="h-full w-full object-cover"
      />
    )
  }
  return (
    <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-forest-700 via-forest-800 to-forest-950 p-4 text-center">
      <span className="text-[9px] font-semibold uppercase tracking-[0.28em] text-medical-light">
        AUSSS Magazine
      </span>
      <span className="heading-serif mt-1 text-base text-white/90">{label}</span>
    </div>
  )
}

// The header thumbnail is the magazine's actual first page. Derive it from the
// built flipbook pages so every edition shows page 1 automatically (no separate
// cover file to keep in sync); fall back to the `cover` field for a Canva-only
// draft that has no pages yet.
function firstPageSrc(issue) {
  const p = issue.pages
  if (p?.count) return `${p.base}/${String(1).padStart(p.pad, '0')}.${p.ext}`
  return issue.cover || null
}

// ── The edition, Canva embedded ──────────────────────────────────────────────
function IssueView({ issue, issues, onSelect }) {
  return (
    <article className="relative overflow-hidden bg-forest-950">
      {/* The gallery's WebGL aurora, flipped to rise from the bottom of the
          page and turned up a little for more presence. */}
      <GalleryAurora
        className="[transform:scaleY(-1)]"
        opacityClass="opacity-100"
        amplitude={1.4}
        blend={0.6}
      />
      <div className="relative z-10">
      <header className="relative overflow-hidden pb-8 pt-24 sm:pt-28">
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage:
              'radial-gradient(circle, #C9D6DF 1px, transparent 1px)',
            backgroundSize: '34px 34px',
          }}
        />
        <div className="container-prose relative">
          <div className="flex flex-col items-center gap-6 text-center sm:flex-row sm:items-end sm:text-left">
            <div className="aspect-[1300/1839] w-28 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-forest-800">
              <Cover src={firstPageSrc(issue)} alt={`${issue.title} cover`} label={issue.title} />
            </div>
            <div>
              <h1 className="heading-serif text-4xl text-white sm:text-5xl">
                {issue.title}
              </h1>
              {issue.date && (
                <p className="mt-2 text-xs font-semibold uppercase tracking-[0.24em] text-medical-light">
                  {issue.date}
                </p>
              )}
            </div>
          </div>
          <IssueSwitcher issues={issues} currentId={issue.id} onSelect={onSelect} />
          {issue.blurb && (
            <p className="mt-6 max-w-2xl text-base leading-relaxed text-silver/75">
              {issue.blurb}
            </p>
          )}
          {(issue.download || issue.canva) && (
            <div className="mt-6 flex flex-wrap gap-3">
              {issue.download && (
                <a
                  href={issue.download}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => trackMagazineDownload(issue.id)}
                  className="inline-flex items-center gap-2 rounded-full bg-medical px-5 py-2.5 text-sm font-semibold text-forest-950 transition-colors hover:bg-medical-light"
                >
                  <DownloadIcon />
                  Download (full quality)
                </a>
              )}
              {issue.canva && (
                <a
                  href={issue.canva}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-full border border-white/20 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/10"
                >
                  <ExternalIcon />
                  Open on Canva
                </a>
              )}
            </div>
          )}
          {!isMissing(issue) && (
            <>
              <MagazineEngagement issueId={issue.id} className="mt-6" />
              <ShareBar title={issue.title} className="mt-6" />
            </>
          )}
        </div>
      </header>

      <div className="container-prose pb-20 sm:pb-28">
        <MagazineReader issue={issue} />
      </div>
      </div>
    </article>
  )
}

// Picks the reader: the page-flipping PDF if one is set, else the Canva embed,
// else a placeholder, so nothing 404s during a draft.
function MagazineReader({ issue }) {
  if (isMissing(issue)) return <MissingPanel issue={issue} />
  const p = issue.pages
  if (p?.count) {
    const urls = Array.from({ length: p.count }, (_, i) => {
      const n = String(i + 1).padStart(p.pad || 3, '0')
      return `${p.base}/${n}.${p.ext || 'jpg'}`
    })
    return (
      // key by issue id so switching editions remounts the reader cleanly
      // (fresh page-flip state + aspect probe).
      <ReaderBoundary issue={issue} key={issue.id}>
        <Suspense fallback={<ReaderLoading />}>
          <Flipbook pages={urls} title={issue.title} />
        </Suspense>
      </ReaderBoundary>
    )
  }
  if (issue.canva) {
    return (
      <CanvaFrame
        src={issue.canva}
        title={`${issue.title}, AUSSS Magazine`}
        ratio={issue.aspect || undefined}
      />
    )
  }
  return (
    <div className="flex aspect-[1/1] w-full flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.03] p-8 text-center sm:aspect-[4/3]">
      <span className="text-silver/45">
        <MagazineIcon />
      </span>
      <p className="mt-4 max-w-sm text-sm text-silver/55">
        The magazine will appear here once a PDF is added. Drop it in{' '}
        <code className="text-silver/70">public/assets/magazine/</code> and set
        its path in <code className="text-silver/70">magazine.js</code>.
      </p>
    </div>
  )
}

// Placeholder for a known back-issue we haven't tracked down a copy of yet.
function MissingPanel({ issue }) {
  const { team, email } = ARCHIVE_CONTACT
  return (
    <div className="flex aspect-[1/1] w-full flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.03] p-8 text-center sm:aspect-[4/3]">
      <span className="text-silver/45">
        <MagazineIcon />
      </span>
      <h3 className="heading-serif mt-4 text-2xl text-white">
        We’re still locating this edition
      </h3>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-silver/60">
        We haven’t tracked down a copy of {issue.title} of the AUSSS Magazine
        yet. If you have it, or know who might, please help us complete the
        archive.
      </p>
      {email && (
        <a
          href={`mailto:${email}?subject=${encodeURIComponent(
            `AUSSS Magazine: ${issue.title}`,
          )}`}
          className="mt-5 inline-flex items-center gap-2 rounded-full bg-medical px-5 py-2.5 text-sm font-semibold text-forest-950 transition-colors hover:bg-medical-light"
        >
          Contact {team}
        </a>
      )}
      {email && <p className="mt-3 text-xs text-silver/40">{email}</p>}
    </div>
  )
}

// If the flip reader (pdf.js / react-pageflip) throws, don't blank the page,
// fall back to a friendly panel with the open/download links.
class ReaderBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error) {
    console.error('Magazine reader failed:', error)
  }
  render() {
    if (!this.state.failed) return this.props.children
    const { issue } = this.props
    const href = issue.download || issue.pdf || issue.canva
    return (
      <div className="flex aspect-[4/3] w-full flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.03] p-8 text-center">
        <span className="text-silver/45">
          <MagazineIcon />
        </span>
        <p className="mt-4 max-w-sm text-sm text-silver/60">
          The in-page reader couldn’t start in this browser.{' '}
          {href && (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-medical-light underline-offset-2 hover:text-white hover:underline"
            >
              Open the magazine in a new tab
            </a>
          )}
          .
        </p>
      </div>
    )
  }
}

function ReaderLoading() {
  return (
    <div className="reveal flex aspect-[4/3] w-full flex-col items-center justify-center rounded-2xl border border-white/10 bg-forest-800">
      <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/15 border-t-medical-light" />
      <p className="mt-4 text-sm text-silver/60">Preparing the reader…</p>
    </div>
  )
}

function EmptyShelf() {
  return (
    <article className="bg-forest-950">
      <div className="container-prose flex min-h-[60vh] flex-col items-center justify-center pt-32 text-center sm:pt-40">
        <h1 className="heading-serif text-4xl text-white sm:text-5xl">
          The Magazine
        </h1>
        <p className="mt-4 max-w-md text-sm text-silver/60">
          The first edition is on its way. Check back soon.
        </p>
      </div>
    </article>
  )
}

function MagazineIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M4 5h7v15H4zM13 5h7v15h-7z" strokeLinejoin="round" />
      <path d="M7 9h1M7 12h1M16 9h1M16 12h1" strokeLinecap="round" />
    </svg>
  )
}

function ExternalIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M14 4h6v6M20 4l-9 9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 3v12M7 11l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 20h14" strokeLinecap="round" />
    </svg>
  )
}
