import { describe, expect, it } from 'vitest'
import siteContact, { mapEmbed, mapLink, networkName, SOCIAL_NETWORKS } from './schemas/siteContact.js'
import { normalizeDoc, resolveDoc, validateDoc } from './schema.js'

describe('the footer and contact details', () => {
  it('only ever point the map at Google Maps, with the pin text encoded', () => {
    const odd = 'Ain Shams "Faculty" & <script>'
    expect(mapLink(odd)).toBe('https://maps.google.com/maps?q=Ain%20Shams%20%22Faculty%22%20%26%20%3Cscript%3E')
    expect(mapEmbed(odd).startsWith('https://maps.google.com/maps?q=')).toBe(true)
    expect(mapEmbed(odd).endsWith('&z=16&output=embed')).toBe(true)
  })

  it('name each network, and have an icon choice for every one', () => {
    expect(networkName('tiktok')).toBe('TikTok')
    expect(networkName('myspace')).toBe('')
    expect(new Set(SOCIAL_NETWORKS.map((n) => n.value)).size).toBe(SOCIAL_NETWORKS.length)
  })

  it('turn an unknown network into the first choice and refuse a channel with no address', () => {
    const doc = normalizeDoc(siteContact, {
      ...siteContact.defaults,
      socials: [{ network: 'myspace', handle: '@x', href: '' }],
    })
    expect(doc.socials[0].network).toBe('instagram')
    expect(validateDoc(siteContact, doc)).toHaveProperty(['socials.0.href'])
  })

  it('fall back to the shipped copy when the published one would leave the footer without channels', () => {
    const shown = resolveDoc(siteContact, { ...siteContact.defaults, socials: [] })
    expect(shown.socials).toHaveLength(siteContact.defaults.socials.length)
  })
})
