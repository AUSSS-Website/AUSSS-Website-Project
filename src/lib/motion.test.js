import { afterEach, describe, expect, it, vi } from 'vitest'
import { prefersReducedMotion, pressCls, scrollBehavior } from './motion.js'

// A window whose matchMedia answers `reduced` to the reduced-motion question.
function stubWindow(reduced) {
  const asked = []
  vi.stubGlobal('window', {
    matchMedia: (query) => {
      asked.push(query)
      return { matches: reduced }
    },
  })
  return asked
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('prefersReducedMotion', () => {
  it('is false where there is no window, as when a page is pre-rendered', () => {
    expect(typeof window).toBe('undefined')
    expect(prefersReducedMotion()).toBe(false)
  })

  it('is false in a browser without matchMedia', () => {
    vi.stubGlobal('window', {})
    expect(prefersReducedMotion()).toBe(false)
  })

  it('asks the reduced-motion question and passes the answer on', () => {
    const asked = stubWindow(true)
    expect(prefersReducedMotion()).toBe(true)
    expect(asked).toEqual(['(prefers-reduced-motion: reduce)'])
    stubWindow(false)
    expect(prefersReducedMotion()).toBe(false)
  })
})

describe('scrollBehavior', () => {
  it('scrolls smoothly unless the reader asked for less motion', () => {
    stubWindow(false)
    expect(scrollBehavior()).toBe('smooth')
    stubWindow(true)
    expect(scrollBehavior()).toBe('auto')
  })

  it('answers each time it is asked, so a changed setting is picked up', () => {
    let reduced = false
    vi.stubGlobal('window', { matchMedia: () => ({ matches: reduced }) })
    expect(scrollBehavior()).toBe('smooth')
    reduced = true
    expect(scrollBehavior()).toBe('auto')
  })

  it('is smooth where there is no window', () => {
    expect(scrollBehavior()).toBe('smooth')
  })
})

describe('pressCls', () => {
  const classes = pressCls.split(' ')

  it('moves a pressed button only for a reader who has not asked for less motion', () => {
    const moving = classes.filter((c) => /scale|translate|rotate/.test(c))
    expect(moving).toEqual(['motion-safe:active:scale-[0.97]'])
  })

  it('keeps the colour fade under reduced motion', () => {
    expect(classes.some((c) => c.startsWith('motion-reduce:'))).toBe(false)
  })

  it('eases colours and the press together, so neither transition overrides the other', () => {
    expect(classes.filter((c) => c.startsWith('transition'))).toEqual(['transition-[color,background-color,border-color,transform]'])
  })
})
