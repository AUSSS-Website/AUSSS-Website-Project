import { useEffect, useState } from 'react'
import { outlineBtnCls } from '../../portalUi.jsx'

// Small pieces the two gallery editor pages share.

const SITE = 'https://ausss-ainshams.org'

export function siteAlbumUrl(slug) {
  return `${SITE}/gallery/${slug}`
}

// Copies the album's public link; uses the native share sheet on phones that
// have one. The label confirms the copy for two seconds.
export function ShareLinkButton({ slug, className = outlineBtnCls }) {
  const [state, setState] = useState('idle')
  useEffect(() => {
    if (state === 'idle') return
    const t = setTimeout(() => setState('idle'), 2000)
    return () => clearTimeout(t)
  }, [state])

  const share = async () => {
    const url = siteAlbumUrl(slug)
    try {
      if (typeof navigator !== 'undefined' && navigator.share && /Mobi|Android/i.test(navigator.userAgent)) {
        await navigator.share({ url })
        setState('shared')
        return
      }
      await navigator.clipboard.writeText(url)
      setState('copied')
    } catch {
      setState('failed')
    }
  }

  return (
    <button type="button" className={className} onClick={share} aria-live="polite">
      {state === 'copied' ? 'Link copied' : state === 'shared' ? 'Shared' : state === 'failed' ? 'Copy failed' : 'Share link'}
    </button>
  )
}

// A two-step destructive button: the first click arms it, the second fires.
// Avoids window.confirm (which blocks the page) while still asking twice.
export function ConfirmButton({ label, confirmLabel = 'Yes, do it', onConfirm, disabled, className = outlineBtnCls }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 6000)
    return () => clearTimeout(t)
  }, [armed])

  if (!armed) {
    return (
      <button type="button" className={className} onClick={() => setArmed(true)} disabled={disabled}>
        {label}
      </button>
    )
  }
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        className={`${className} border-red-400/50 text-red-200 hover:bg-red-500/10`}
        onClick={() => {
          setArmed(false)
          onConfirm()
        }}
        disabled={disabled}
      >
        {confirmLabel}
      </button>
      <button type="button" className={className} onClick={() => setArmed(false)}>
        Keep
      </button>
    </span>
  )
}
