import { describe, expect, it } from 'vitest'
import { publicEmail } from './emailConfig.js'

describe('publicEmail', () => {
  const role = { email: 'ausss.secgen@gmail.com', alias: 'secgen' }

  it('shows the Gmail inbox while the domain addresses are off', () => {
    expect(publicEmail(role)).toBe('ausss.secgen@gmail.com')
    expect(publicEmail(role, false)).toBe('ausss.secgen@gmail.com')
  })

  it('shows the address on the domain once they are on', () => {
    expect(publicEmail(role, true)).toBe('secgen@ausss-ainshams.org')
  })

  it('keeps the inbox for a role with no alias, and nothing for no role', () => {
    expect(publicEmail({ email: 'x@gmail.com' }, true)).toBe('x@gmail.com')
    expect(publicEmail(undefined, true)).toBe('')
  })
})
