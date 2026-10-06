// Every part of the site that is edited from the portal's content editor.
// Adding one: a row in public.content_blocks (a migration), a schema file in
// ./schemas, a line here, and the page reading it with useContentBlock
// (src/lib/content.js). RUNBOOK section 25 walks through it.
import joinFaq from './schemas/joinFaq.js'
import exchangeIncomings from './schemas/exchangeIncomings.js'
import exchangeOutgoings from './schemas/exchangeOutgoings.js'
import siteContact from './schemas/siteContact.js'

export const contentSchemas = [joinFaq, exchangeIncomings, exchangeOutgoings, siteContact]

export function contentSchema(key) {
  return contentSchemas.find((s) => s.key === key) || null
}
