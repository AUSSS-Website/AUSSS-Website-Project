import { useEffect } from 'react'

// Per-route document title, meta description, and canonical link. Every page
// shares the brand defaults from index.html unless it calls this hook; the
// cleanup restores them so nothing leaks across client-side navigations.
// Also feeds analytics, which reads document.title when tracking page views.
//
//   usePageTitle('Join AUSSS')                         // title only
//   usePageTitle('Join AUSSS', 'Apply to AUSSS…')      // + description
const BASE_TITLE = 'AUSSS, Life Savers, Change Makers'

function metaDescriptionEl() {
  return typeof document === 'undefined'
    ? null
    : document.querySelector('meta[name="description"]')
}

function canonicalEl() {
  if (typeof document === 'undefined') return null
  let el = document.querySelector('link[rel="canonical"]')
  if (!el) {
    el = document.createElement('link')
    el.setAttribute('rel', 'canonical')
    document.head.appendChild(el)
  }
  return el
}

export default function usePageTitle(title, description) {
  useEffect(() => {
    document.title = title ? `${title} · AUSSS` : BASE_TITLE

    const descEl = metaDescriptionEl()
    const baseDesc = descEl ? descEl.getAttribute('content') : null
    if (descEl && description) descEl.setAttribute('content', description)

    const canon = canonicalEl()
    const baseHref = canon ? canon.getAttribute('href') : null
    if (canon && typeof window !== 'undefined') {
      canon.setAttribute('href', window.location.origin + window.location.pathname)
    }

    return () => {
      document.title = BASE_TITLE
      if (descEl && baseDesc != null) descEl.setAttribute('content', baseDesc)
      if (canon && baseHref != null) canon.setAttribute('href', baseHref)
    }
  }, [title, description])
}
