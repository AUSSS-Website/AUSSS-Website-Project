import { useEffect, useState } from 'react'

// A small social "share" row for the magazine page.
//   - On mobile, the primary "Share" button opens the native Web Share sheet
//     (the only path to Instagram, which has no web share-intent URL).
//   - Explicit WhatsApp / Facebook / X / Telegram buttons always render as a
//     fallback, each opening the network's share intent in a new tab.
//   - "Copy link" copies the resolved URL to the clipboard.
//
// The URL is resolved into state on mount (client-only SPA), so anchors carry
// real hrefs and we never bake a stale window.location into render output.
export default function ShareBar({ url, title, className = '' }) {
  const [resolvedUrl, setResolvedUrl] = useState(url || '')
  const [canNativeShare, setCanNativeShare] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!url && typeof window !== 'undefined') {
      setResolvedUrl(window.location.href)
    }
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      setCanNativeShare(true)
    }
  }, [url])

  const shareUrl = resolvedUrl || (typeof window !== 'undefined' ? window.location.href : '')
  const text = `${title}, AUSSS Magazine`

  const targets = {
    whatsapp: `https://wa.me/?text=${encodeURIComponent(`${text} ${shareUrl}`)}`,
    telegram: `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(text)}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`,
    x: `https://twitter.com/intent/tweet?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(text)}`,
  }

  async function handleNativeShare() {
    const target = shareUrl || window.location.href
    try {
      await navigator.share({ title, text, url: target })
    } catch (err) {
      // The user dismissing the share sheet rejects with AbortError, ignore it.
      if (err && err.name !== 'AbortError') {
        // Any other failure is non-fatal; the fallback buttons still work.
        console.warn('Web Share failed:', err)
      }
    }
  }

  async function handleCopy() {
    const target = shareUrl || (typeof window !== 'undefined' ? window.location.href : '')
    if (!target) return
    let ok = false

    // Preferred path, the async Clipboard API. Requires a secure context
    // (HTTPS / localhost), which the live site is, so this is the normal path
    // in modern browsers, including mobile Safari and Chrome.
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(target)
        ok = true
      }
    } catch {
      ok = false
    }

    // Fallback for older browsers, plain-HTTP, or in-app webviews (e.g. the
    // Instagram browser) where navigator.clipboard is unavailable.
    if (!ok) {
      try {
        const ta = document.createElement('textarea')
        ta.value = target
        ta.setAttribute('readonly', '')
        ta.style.position = 'fixed'
        ta.style.top = '-9999px'
        document.body.appendChild(ta)
        ta.select()
        ta.setSelectionRange(0, target.length) // iOS needs an explicit range
        ok = document.execCommand('copy')
        document.body.removeChild(ta)
      } catch {
        ok = false
      }
    }

    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } else if (typeof window !== 'undefined') {
      // Last resort: surface the URL so the user can copy it by hand.
      window.prompt('Copy this link:', target)
    }
  }

  const pill =
    'inline-flex items-center gap-2 rounded-full border border-white/15 bg-forest-800 px-4 py-2 text-sm font-medium text-silver/80 transition-colors hover:border-medical/40 hover:text-white'

  return (
    <div className={className}>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-medical-light">
        Share this issue
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        {canNativeShare && (
          <button
            type="button"
            onClick={handleNativeShare}
            aria-label="Share"
            className="inline-flex items-center gap-2 rounded-full bg-medical px-4 py-2 text-sm font-semibold text-forest-950 transition-colors hover:bg-medical-light"
          >
            <ShareIcon />
            Share
          </button>
        )}

        <a href={targets.whatsapp} target="_blank" rel="noopener noreferrer" aria-label="Share on WhatsApp" className={pill}>
          <WhatsAppIcon />
          WhatsApp
        </a>
        <a href={targets.facebook} target="_blank" rel="noopener noreferrer" aria-label="Share on Facebook" className={pill}>
          <FacebookIcon />
          Facebook
        </a>
        <a href={targets.x} target="_blank" rel="noopener noreferrer" aria-label="Share on X" className={pill}>
          <XIcon />
          X
        </a>
        <a href={targets.telegram} target="_blank" rel="noopener noreferrer" aria-label="Share on Telegram" className={pill}>
          <TelegramIcon />
          Telegram
        </a>

        <button type="button" onClick={handleCopy} aria-label={copied ? 'Link copied' : 'Copy link'} className={pill}>
          <CopyIcon />
          {copied ? 'Copied!' : 'Copy link'}
        </button>
      </div>
    </div>
  )
}

// ── Icons (16px, stroke-based, inherit currentColor) ─────────────────────────
const iconProps = {
  viewBox: '0 0 24 24',
  className: 'h-4 w-4',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: '1.8',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
}

function ShareIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="18" cy="5" r="2.5" />
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="19" r="2.5" />
      <path d="M8.2 10.8 15.8 6.4M8.2 13.2l7.6 4.4" />
    </svg>
  )
}

function WhatsAppIcon() {
  return (
    <svg {...iconProps}>
      <path d="M3.5 20.5l1.3-4.2a8 8 0 1 1 3 2.9l-4.3 1.3Z" />
      <path d="M9 8.5c.2 1.6.9 3 2 4.1s2.5 1.8 4.1 2c.5.1.9-.2 1.1-.6l.4-.9-2.2-1-.7.8a6 6 0 0 1-2.3-2.3l.8-.7-1-2.2-.9.4c-.4.2-.7.6-.6 1.1Z" />
    </svg>
  )
}

function TelegramIcon() {
  return (
    <svg {...iconProps}>
      <path d="M21 4 3 11l5 2 2 6 3-4 5 4 3-15Z" />
      <path d="M8 13l10-7-7 8" />
    </svg>
  )
}

function FacebookIcon() {
  return (
    <svg {...iconProps}>
      <path d="M14 7h2V4h-2.2C11.7 4 11 5.4 11 7v1.5H9V11h2v9h3v-9h2.2L17 8.5h-3V7c0-.6.4-1 1-1Z" />
    </svg>
  )
}

function XIcon() {
  return (
    <svg {...iconProps}>
      <path d="M4 4l7.5 9.5M20 20l-7.5-9.5M4 4h3l13 16h-3L4 4Z" />
      <path d="M11.2 13.2 5 20M19 4l-5.8 6.4" />
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg {...iconProps}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </svg>
  )
}
