// Messages handed to Gmail in a link. The link opens Gmail's own "new message"
// window with the address, the subject and the first words filled in; the
// officer reads it over and presses Send in their own mailbox. Nothing is sent
// from the site, and nothing here talks to Google: these functions only write
// the link.

const COMPOSE = 'https://mail.google.com/mail/'

// Longer than this and Google answers "Bad Request" where the message should
// open. Measured on 2026-10-12: a link of 7,000 characters opened and one of
// 12,000 did not.
export const GMAIL_LINK_MAX = 6000

// Words that are not a name by themselves: "Abdel Rahman", "Abd El Rahman",
// "El Sayed" and "Abu Bakr" are each one first name.
const PARTICLES = new Set(['abd', 'abdel', 'abdul', 'abdal', 'abdu', 'abu', 'abou', 'el', 'al'])
const TITLE = /^(dr|prof|eng|mr|mrs|ms|miss)\.?$/i

// A name typed all in capitals or all in small letters is given its capitals.
const tidy = (word) =>
  /[a-z]/.test(word) && /[A-Z]/.test(word) ? word : word.replace(/^(\p{L})(.*)$/u, (_, a, rest) => a.toUpperCase() + rest.toLowerCase())

// The name a letter would open with. Empty when there is none to go by.
export function firstNameOf(fullName) {
  const words = String(fullName || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  while (words.length > 1 && TITLE.test(words[0])) words.shift()
  if (words.length === 0) return ''
  let take = 1
  while (take < words.length && PARTICLES.has(words[take - 1].toLowerCase())) take++
  return words.slice(0, take).map(tidy).join(' ')
}

// How every email from the portal opens.
export const greetingFor = (fullName) => {
  const first = firstNameOf(fullName)
  return first ? `Dear ${first},` : 'Hello,'
}

// One line per person, by address: the first row with an address stands for
// everything else that address sent in. Rows with no usable address are left out.
export function uniquePeople(rows) {
  const seen = new Set()
  const people = []
  for (const row of rows || []) {
    const email = String(row?.email || '').trim()
    if (!/^\S+@\S+\.\S+$/.test(email) || seen.has(email.toLowerCase())) continue
    seen.add(email.toLowerCase())
    people.push({ id: row.id, name: String(row.name || '').trim(), email })
  }
  return people
}

// The link itself. `from` is the address of whoever is signed in to the
// portal: when it is a Gmail address, a browser signed in to several Google
// accounts opens the message in that one's mailbox and not in whichever comes
// first. Any other address is left out, since Google would ask it to sign in.
export function gmailComposeUrl({ to = [], bcc = [], subject = '', body = '', from = '' } = {}) {
  const parts = []
  const add = (key, value) => parts.push(`${key}=${encodeURIComponent(value)}`)
  if (/^[^@\s]+@(gmail|googlemail)\.com$/i.test(from)) add('authuser', from)
  parts.push('view=cm', 'fs=1')
  if (to.length) add('to', to.join(','))
  if (bcc.length) add('bcc', bcc.join(','))
  if (subject) add('su', subject)
  if (body) add('body', body)
  return `${COMPOSE}?${parts.join('&')}`
}

const letter = (opening, message) => {
  const text = String(message || '').trim()
  return text ? `${opening}\n\n${text}\n` : `${opening}\n\n`
}

// One person's email: to them alone, opening with their first name.
// `paste` is what did not fit in the link and has to be copied across by hand
// ({ what: 'message', text }), or null when everything is in the link.
export function composeForOne(person, { subject = '', message = '', from = '' } = {}) {
  const opening = greetingFor(person.name)
  const full = gmailComposeUrl({ to: [person.email], subject, body: letter(opening, message), from })
  if (full.length <= GMAIL_LINK_MAX) return { url: full, paste: null }
  return {
    url: gmailComposeUrl({ to: [person.email], subject, body: letter(opening, ''), from }),
    paste: { what: 'message', text: String(message).trim() },
  }
}

// One email to everybody at once: it opens "Dear all," and the addresses go in
// Bcc, so nobody is shown anybody else's. When the addresses are too many for
// a link they are what has to be pasted; when it is the message that is too
// long, the message is.
export function composeForAll(people, { subject = '', message = '', from = '' } = {}) {
  const bcc = people.map((p) => p.email)
  const opening = 'Dear all,'
  const full = gmailComposeUrl({ bcc, subject, body: letter(opening, message), from })
  if (full.length <= GMAIL_LINK_MAX) return { url: full, paste: null }
  const noMessage = gmailComposeUrl({ bcc, subject, body: letter(opening, ''), from })
  if (noMessage.length <= GMAIL_LINK_MAX) return { url: noMessage, paste: { what: 'message', text: String(message).trim() } }
  const noAddresses = gmailComposeUrl({ subject, body: letter(opening, message), from })
  return {
    url: noAddresses.length <= GMAIL_LINK_MAX ? noAddresses : gmailComposeUrl({ subject, body: letter(opening, ''), from }),
    paste: { what: 'addresses', text: bcc.join(', ') },
  }
}
