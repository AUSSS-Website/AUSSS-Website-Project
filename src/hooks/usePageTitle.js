import { useEffect } from 'react'

// Per-route document title, meta description, and canonical link. Every page
// shares the brand defaults from index.html unless it calls this hook; the
// cleanup restores them so nothing leaks across client-side navigations.
//
// Crawlers never see this hook run: the public pages are pre-rendered at build
// time from src/seo/pages.js, which must carry the same title and description
// for the page (RUNBOOK section 15).
//
//   usePageTitle('Join AUSSS')                         // title only
//   usePageTitle('Join AUSSS', 'Apply to AUSSS…')      // + description
//
// A page that stands in for a missing one passes `noindex`, which asks search
// engines to leave the address out of their results. The tag is in the head
// only while that page is shown, so it never rides along to a real page.
//
//   usePageTitle('Page not found', undefined, { noindex: true })
const BASE_TITLE = "AUSSS, Ain Shams University Students' Scientific Society"

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

export default function usePageTitle(title, description, { noindex = false } = {}) {
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

    // A tag of this page's own, so taking it away again cannot touch one that
    // index.html may carry some day.
    let robots = null
    if (noindex) {
      robots = document.createElement('meta')
      robots.setAttribute('name', 'robots')
      robots.setAttribute('content', 'noindex')
      document.head.appendChild(robots)
    }

    return () => {
      document.title = BASE_TITLE
      if (descEl && baseDesc != null) descEl.setAttribute('content', baseDesc)
      if (canon && baseHref != null) canon.setAttribute('href', baseHref)
      robots?.remove()
    }
  }, [title, description, noindex])
}
