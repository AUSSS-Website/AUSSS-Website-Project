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

// The two-click remove button lives in portalUi.jsx now; re-exported so the
// editors that import it from here keep working.
export { ConfirmButton } from '../../portalUi.jsx'
