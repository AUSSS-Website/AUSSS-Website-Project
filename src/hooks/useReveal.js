import { useEffect } from 'react'

/**
 * Adds an IntersectionObserver that toggles `.is-visible` on any
 * element bearing the `.reveal` class as it scrolls into view.
 * Mount once per page.
 *
 * Content that arrives after the first paint (gallery albums, the magazine
 * shelf, published stories) mounts its `.reveal` elements later, so a
 * MutationObserver hands those to the same observer. Without it they stay
 * at opacity 0 and the page looks blank until a reload finds them cached.
 */
export default function useReveal() {
  useEffect(() => {
    if (!('IntersectionObserver' in window)) {
      // Too old to observe anything: turn the effect off rather than hide
      // content, including whatever mounts later.
      document.documentElement.classList.add('no-reveal')
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible')
            observer.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    )

    const pending = '.reveal:not(.is-visible)'
    const watch = (node) => {
      if (node.nodeType !== 1) return
      if (node.matches(pending)) observer.observe(node)
      node.querySelectorAll(pending).forEach((el) => observer.observe(el))
    }

    watch(document.body)
    const added = new MutationObserver((records) => {
      records.forEach((record) => record.addedNodes.forEach(watch))
    })
    added.observe(document.body, { childList: true, subtree: true })

    return () => {
      observer.disconnect()
      added.disconnect()
    }
  }, [])
}
