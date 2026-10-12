import { describe, expect, it } from 'vitest'
import { GMAIL_LINK_MAX, composeForAll, composeForOne, firstNameOf, gmailComposeUrl, greetingFor, uniquePeople } from './gmail.js'

const query = (url) => new URL(url).searchParams

describe('firstNameOf', () => {
  it('takes the first word of a name', () => {
    expect(firstNameOf('Amal Samir Hassan')).toBe('Amal')
    expect(firstNameOf('  Omar   Example ')).toBe('Omar')
  })
  it('keeps the particles of a name with the name', () => {
    expect(firstNameOf('Abdel Rahman Mostafa')).toBe('Abdel Rahman')
    expect(firstNameOf('Abd El Rahman Mostafa')).toBe('Abd El Rahman')
    expect(firstNameOf('El Sayed Ahmed')).toBe('El Sayed')
    expect(firstNameOf('Abu Bakr Ali')).toBe('Abu Bakr')
    expect(firstNameOf('Abdelrahman Mostafa')).toBe('Abdelrahman')
  })
  it('leaves a title out', () => {
    expect(firstNameOf('Dr. Mona Adel')).toBe('Mona')
    expect(firstNameOf('Prof Hany Fouad')).toBe('Hany')
    expect(firstNameOf('Dr')).toBe('Dr')
  })
  it('gives capitals to a name typed without them, and leaves the rest alone', () => {
    expect(firstNameOf('amal samir')).toBe('Amal')
    expect(firstNameOf('AMAL SAMIR')).toBe('Amal')
    expect(firstNameOf('McKenzie Reid')).toBe('McKenzie')
    expect(firstNameOf('أمل سمير')).toBe('أمل')
  })
  it('is empty when there is no name', () => {
    expect(firstNameOf('')).toBe('')
    expect(firstNameOf(null)).toBe('')
    expect(firstNameOf('   ')).toBe('')
  })
})

describe('greetingFor', () => {
  it('opens with Dear and the first name', () => {
    expect(greetingFor('Amal Samir')).toBe('Dear Amal,')
  })
  it('says Hello to somebody who left no name', () => {
    expect(greetingFor('')).toBe('Hello,')
  })
})

describe('uniquePeople', () => {
  it('lists an address once, whatever its capitals, under the first row that has it', () => {
    const people = uniquePeople([
      { id: 'a', name: 'Amal Samir', email: 'amal@example.com' },
      { id: 'b', name: 'A. Samir', email: 'Amal@Example.com ' },
      { id: 'c', name: 'Omar', email: 'omar@example.com' },
    ])
    expect(people).toEqual([
      { id: 'a', name: 'Amal Samir', email: 'amal@example.com' },
      { id: 'c', name: 'Omar', email: 'omar@example.com' },
    ])
  })
  it('leaves out a row with no usable address', () => {
    expect(uniquePeople([{ id: 'a', name: 'x', email: '' }, { id: 'b', name: 'y', email: 'not an address' }, { id: 'c', email: null }])).toEqual([])
    expect(uniquePeople(null)).toEqual([])
  })
})

describe('gmailComposeUrl', () => {
  it('opens a new message in Gmail with what it was given', () => {
    const url = gmailComposeUrl({ to: ['amal@example.com'], subject: 'Your AUSSS order AUSSS-7F3K2Q', body: 'Dear Amal,\n\nHello & welcome' })
    expect(url.startsWith('https://mail.google.com/mail/?')).toBe(true)
    const q = query(url)
    expect(q.get('view')).toBe('cm')
    expect(q.get('to')).toBe('amal@example.com')
    expect(q.get('su')).toBe('Your AUSSS order AUSSS-7F3K2Q')
    expect(q.get('body')).toBe('Dear Amal,\n\nHello & welcome')
    expect(q.has('bcc')).toBe(false)
    expect(q.has('authuser')).toBe(false)
  })
  it('writes a space as %20, which Gmail reads in a subject and in a message alike', () => {
    expect(gmailComposeUrl({ subject: 'two words' })).toContain('su=two%20words')
  })
  it('keeps a plus in an address', () => {
    expect(query(gmailComposeUrl({ to: ['amal+shop@example.com'] })).get('to')).toBe('amal+shop@example.com')
  })
  it('names the mailbox to write from only when it is a Gmail one', () => {
    expect(query(gmailComposeUrl({ from: 'ausss.vpe@gmail.com' })).get('authuser')).toBe('ausss.vpe@gmail.com')
    expect(query(gmailComposeUrl({ from: 'vpe@ausss-ainshams.org' })).has('authuser')).toBe(false)
    expect(query(gmailComposeUrl({ from: '' })).has('authuser')).toBe(false)
  })
})

describe('composeForOne', () => {
  const amal = { name: 'Amal Samir', email: 'amal@example.com' }
  it('addresses one person and opens with their first name', () => {
    const { url, paste } = composeForOne(amal, { subject: 'Hello', message: 'We open on Sunday.' })
    const q = query(url)
    expect(q.get('to')).toBe('amal@example.com')
    expect(q.get('body')).toBe('Dear Amal,\n\nWe open on Sunday.\n')
    expect(paste).toBeNull()
  })
  it('leaves room under the greeting when no message was written', () => {
    expect(query(composeForOne(amal).url).get('body')).toBe('Dear Amal,\n\n')
  })
  it('hands over a message too long for a link to be pasted, and keeps the greeting in the link', () => {
    const message = 'ا'.repeat(1200)
    const { url, paste } = composeForOne(amal, { subject: 'Hello', message })
    expect(url.length).toBeLessThanOrEqual(GMAIL_LINK_MAX)
    expect(query(url).get('body')).toBe('Dear Amal,\n\n')
    expect(paste).toEqual({ what: 'message', text: message })
  })
})

describe('composeForAll', () => {
  const people = (n) => Array.from({ length: n }, (_, i) => ({ name: `Person ${i}`, email: `person${i}@students.example.edu.eg` }))
  it('puts everybody in Bcc and opens with Dear all', () => {
    const { url, paste } = composeForAll(people(3), { subject: 'Recruitment', message: 'It opens on Sunday.' })
    const q = query(url)
    expect(q.has('to')).toBe(false)
    expect(q.get('bcc')).toBe('person0@students.example.edu.eg,person1@students.example.edu.eg,person2@students.example.edu.eg')
    expect(q.get('body')).toBe('Dear all,\n\nIt opens on Sunday.\n')
    expect(paste).toBeNull()
  })
  it('hands over a long message to be pasted while the addresses still fit', () => {
    const message = 'ا'.repeat(1200)
    const { url, paste } = composeForAll(people(3), { message })
    expect(url.length).toBeLessThanOrEqual(GMAIL_LINK_MAX)
    expect(query(url).get('bcc')).toContain('person2@')
    expect(paste).toEqual({ what: 'message', text: message })
  })
  it('hands over the addresses to be pasted when they are too many for a link', () => {
    const many = people(400)
    const { url, paste } = composeForAll(many, { subject: 'Recruitment', message: 'It opens on Sunday.' })
    expect(url.length).toBeLessThanOrEqual(GMAIL_LINK_MAX)
    expect(query(url).has('bcc')).toBe(false)
    expect(query(url).get('body')).toBe('Dear all,\n\nIt opens on Sunday.\n')
    expect(paste.what).toBe('addresses')
    expect(paste.text.split(', ')).toHaveLength(400)
  })
})
