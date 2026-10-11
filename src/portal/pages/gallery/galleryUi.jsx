import { useEffect, useState } from 'react'
import { outlineBtnCls } from '../../portalUi.jsx'

// Small pieces the two gallery editor pages share.

const SITE = 'https://ausss-ainshams.org'

export function siteAlbumUrl(slug) {
  return `${SITE}/gallery/${slug}`
}

// On a touch screen a pill is at least 44px tall, the least a finger lands on
// reliably; with a mouse it keeps its compact height. In px, not rem, because
// the root size shrinks on a 320px phone.
export const tapCls = '[@media(pointer:coarse)]:min-h-[44px]'

// A share sheet closed without choosing anything rejects with an AbortError.
// That is a change of mind, not a failure.
export function isCancelledShare(err) {
  return err?.name === 'AbortError'
}

const SHARE_WORDINGS = [
  ['idle', 'Share link'],
  ['copied', 'Link copied'],
  ['shared', 'Shared'],
  ['failed', 'Copy failed'],
]

// Copies the album's public link; uses the native share sheet on phones that
// have one. The label confirms the copy for two seconds, and the wordings share
// one grid cell, so the button keeps its width and nothing beside it moves.
export function ShareLinkButton({ slug, className = `${outlineBtnCls} ${tapCls}` }) {
  const [state, setState] = useState('idle')
  useEffect(() => {
    if (state === 'idle') return
    const t = setTimeout(() => setState('idle'), 2000)
    return () => clearTimeout(t)
  }, [state])

  const share = async () => {
    const url = siteAlbumUrl(slug)
    if (typeof navigator !== 'undefined' && navigator.share && /Mobi|Android/i.test(navigator.userAgent)) {
      try {
        await navigator.share({ url })
        setState('shared')
        return
      } catch (err) {
        if (isCancelledShare(err)) return
        // The sheet could not open at all: copy the link instead.
      }
    }
    try {
      await navigator.clipboard.writeText(url)
      setState('copied')
    } catch {
      setState('failed')
    }
  }

  return (
    <>
      <button type="button" className={className} onClick={share}>
        <span className="grid items-center justify-items-center">
          {SHARE_WORDINGS.map(([key, wording]) => (
            <span
              key={key}
              aria-hidden={key === state ? undefined : true}
              className={`col-start-1 row-start-1 ${key === state ? '' : 'invisible'}`}
            >
              {wording}
            </span>
          ))}
        </span>
      </button>
      {/* What the click did, said aloud: a button whose wording changes under the reader is not read again. */}
      <span className="sr-only" role="status">
        {state === 'idle' ? '' : SHARE_WORDINGS.find(([key]) => key === state)[1]}
      </span>
    </>
  )
}

// The two-click remove button lives in portalUi.jsx now; re-exported so the
// editors that import it from here keep working.
export { ConfirmButton } from '../../portalUi.jsx'
