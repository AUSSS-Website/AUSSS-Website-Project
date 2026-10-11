import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

// workUi.jsx reaches the portal's database client through officerQueries.js,
// which builds it as it loads. Only its class names are read here, so the
// client is left out.
vi.mock('./supabase.js', () => ({ supabase: null, supabaseEnabled: false }))

import Button from '../components/ui/Button.jsx'
import { outlineBtnCls, primaryBtnCls } from '../portal/portalUi.jsx'
import { chipBtnCls } from '../portal/workUi.jsx'
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

// pressCls moves a pressed button and changes no colour. On a phone nothing
// hovers, and with reduced motion nothing moves, so each shared button has a
// fill of its own for the moment it is pressed.
describe('a press where nothing hovers and nothing moves', () => {
  // The classes that give a pressed button a fill, whatever stands before them.
  const pressedFill = (cls) => cls.split(/\s+/).filter((c) => /(^|:)active:!?bg-/.test(c))

  it('is answered with a fill by the portal’s pills and chips, which also carry pressCls', () => {
    for (const cls of [primaryBtnCls, outlineBtnCls, chipBtnCls(true), chipBtnCls(false)]) {
      expect(cls).toContain(pressCls)
      expect(pressedFill(cls)).toHaveLength(1)
    }
  })

  it('only on a pill or a chip that is switched on, and on a link styled as one', () => {
    // enabled: would never match a link, so the rule is written with :not(:disabled).
    for (const cls of [primaryBtnCls, outlineBtnCls, chipBtnCls(true), chipBtnCls(false)]) {
      expect(pressedFill(cls)[0].startsWith('[&:not(:disabled)]:active:')).toBe(true)
    }
  })

  it('is answered with a fill by every variant of <Button>, in both themes', () => {
    for (const variant of ['primary', 'accent', 'forest', 'outline']) {
      const html = renderToStaticMarkup(createElement(Button, { variant }, 'Go'))
      const cls = html.match(/class="([^"]*)"/)[1]
      expect(cls).toContain(pressCls)
      expect(pressedFill(cls).some((c) => c.startsWith('active:'))).toBe(true)
      // A variant that names a dark fill names a dark pressed fill as well.
      if (/(^|\s)dark:bg-/.test(cls)) expect(pressedFill(cls).some((c) => c.startsWith('dark:active:'))).toBe(true)
    }
  })
})
