import { useId, useState } from 'react'
import { composeForAll, composeForOne, greetingFor } from '../../../lib/gmail.js'
import { Field, TickBox, outlineBtnCls, primaryBtnCls } from '../../portalUi.jsx'
import { smallInputCls } from '../../workUi.jsx'

// Writing to the people on the Submissions page (docs/RUNBOOK.md section 18).
//
// Nothing is sent from the portal. A button here opens Gmail's own "new
// message" window in another tab, with the address, the subject and the first
// line filled in (src/lib/gmail.js writes the link), and the officer sends it
// from their own mailbox. Every email opens with "Dear" and the person's first
// name.
//
// One person: GmailButton, on every order, story and waitlist entry.
// Several: each entry has a tick box (PickBox), and the bar above the list
// (BulkEmail) takes the subject and the message once and then opens one email
// per person, each with that person's own greeting. One email cannot greet
// everybody by name, so the bar also offers a single "Dear all," message with
// the addresses in Bcc, where nobody is shown anybody else's.

// On a touch screen a button stands at least a thumb tall; in px and not rem,
// because the root size shrinks on a 320px phone.
const tapCls = '[@media(pointer:coarse)]:min-h-[44px]'

// What an email to one person is about, by what they sent in.
export const subjectFor = (kind, row) =>
  kind === 'orders' ? `Your AUSSS order${row.ref ? ` ${row.ref}` : ''}` : kind === 'stories' ? 'Your exchange story' : 'Joining AUSSS'

export function GmailButton({ kind, row, from, className = '' }) {
  if (!row.email) return null
  const { url } = composeForOne({ name: row.name, email: row.email }, { subject: subjectFor(kind, row), from })
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Write to ${row.name || row.email} in Gmail`}
      className={`${outlineBtnCls} ${tapCls} ${className}`}
    >
      Write in Gmail
    </a>
  )
}

// The tick box of one entry. The label around it is 44px each way and takes
// that room back with its margin, so the row keeps its shape.
export function PickBox({ checked, onChange, label }) {
  return (
    <label className="group/check -m-3 flex shrink-0 cursor-pointer p-3">
      <TickBox checked={checked} onChange={onChange} label={label} />
    </label>
  )
}

// The clipboard is asked while the page still has the focus, before a new tab
// takes it. False when the browser refuses.
async function copy(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

const many = (n, one, more) => `${n} ${n === 1 ? one : more}`

// `people` are the ticked entries, one per address (uniquePeople), and
// `tickedCount` is how many entries are ticked: two orders from one buyer are
// two entries and one email.
export function BulkEmail({ shownCount, allTicked, onTickAll, tickedCount, people, onClear, from }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  // The addresses whose email has been opened in Gmail, so the next press
  // opens the next person's and the list shows who is left.
  const [opened, setOpened] = useState({})
  const [notice, setNotice] = useState('')
  // The addresses, shown to be copied by hand, when the browser would not copy them.
  const [byHand, setByHand] = useState('')

  if (shownCount === 0 && tickedCount === 0) return null

  const next = people.find((p) => !opened[p.email])
  const done = people.filter((p) => opened[p.email]).length
  const addresses = people.map((p) => p.email).join(', ')

  const pasted = async (paste, under) => {
    if (!paste) return setNotice('')
    const ok = await copy(paste.text)
    if (paste.what === 'addresses') {
      if (!ok) setByHand(paste.text)
      setNotice(
        ok
          ? 'There are too many addresses for a link, so they have been copied. Paste them into Bcc.'
          : 'There are too many addresses for a link. Copy them from the box below and paste them into Bcc.',
      )
    } else {
      setNotice(
        ok
          ? `Your message is too long for a link, so it has been copied. Paste it under ${under}.`
          : `Your message is too long for a link. Copy it from the box above and paste it under ${under}.`,
      )
    }
  }

  const openOne = (person) => {
    const { url, paste } = composeForOne(person, { subject, message, from })
    const after = pasted(paste, 'the greeting')
    window.open(url, '_blank', 'noopener')
    setOpened((o) => ({ ...o, [person.email]: true }))
    return after
  }
  const openAll = () => {
    const { url, paste } = composeForAll(people, { subject, message, from })
    const after = pasted(paste, '“Dear all,”')
    window.open(url, '_blank', 'noopener')
    return after
  }
  const copyAddresses = async () => {
    const ok = await copy(addresses)
    setByHand(ok ? '' : addresses)
    setNotice(ok ? `${many(people.length, 'address', 'addresses')} copied.` : 'Your browser would not copy them. Copy them from the box below.')
  }
  const clear = () => {
    setOpen(false)
    setOpened({})
    setNotice('')
    setByHand('')
    onClear()
  }

  return (
    <section aria-label="Write to several people" className="rounded-2xl border border-line/10 bg-card px-5 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="group/check -my-1 flex min-h-[44px] cursor-pointer items-center gap-3">
          <TickBox checked={allTicked} onChange={onTickAll} labelledBy={`${id}-all`} disabled={shownCount === 0} />
          <span id={`${id}-all`} className="text-sm text-ink">
            Select all {shownCount} listed
          </span>
        </label>
        {tickedCount === 0 ? (
          <p className="text-xs text-soft/55">Tick the people you want to write to.</p>
        ) : (
          <>
            <p className="text-sm font-medium text-ink">
              {tickedCount} selected
              {people.length !== tickedCount && <span className="font-normal text-soft/60">, {many(people.length, 'address', 'addresses')}</span>}
            </p>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <button
                type="button"
                aria-expanded={open}
                aria-controls={`${id}-write`}
                disabled={people.length === 0}
                onClick={() => setOpen((o) => !o)}
                className={`${outlineBtnCls} ${tapCls}`}
              >
                {open ? 'Close' : 'Write to them'}
              </button>
              <button type="button" disabled={people.length === 0} onClick={copyAddresses} className={`${outlineBtnCls} ${tapCls}`}>
                Copy addresses
              </button>
              <button type="button" onClick={clear} className={`${outlineBtnCls} ${tapCls}`}>
                Clear
              </button>
            </div>
          </>
        )}
      </div>

      {open && people.length > 0 && (
        <div id={`${id}-write`} className="mt-3 space-y-4 border-t border-line/10 pb-2 pt-4">
          <Field label="Subject" htmlFor={`${id}-subject`}>
            <input
              id={`${id}-subject`}
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={200}
              className={smallInputCls}
            />
          </Field>
          <Field
            label="Message"
            hint="Every email opens with “Dear” and the person’s first name, then this. You can still change each one in Gmail before you send it."
            htmlFor={`${id}-message`}
          >
            <textarea
              id={`${id}-message`}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={5}
              className={`${smallInputCls} resize-y`}
            />
          </Field>

          <div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <button type="button" disabled={!next} onClick={() => openOne(next)} className={`${primaryBtnCls} min-w-0 break-all`}>
                {next ? `Open the email to ${next.name || next.email} in Gmail` : 'All of them are open'}
              </button>
              <p className="text-xs text-soft/60">
                {done} of {people.length} opened. Each opens in its own tab, ready to send; come back here for the next.
              </p>
            </div>
            <ul className="mt-3 max-h-72 divide-y divide-line/10 overflow-y-auto rounded-xl border border-line/10 bg-page/60 px-4">
              {people.map((p) => (
                <li key={p.email} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <span className="break-words text-sm font-medium text-ink">{greetingFor(p.name)}</span>
                  <span className="min-w-0 flex-1 break-all text-xs text-soft/60">{p.email}</span>
                  {opened[p.email] && <span className="text-xs text-ok">Opened</span>}
                  <button
                    type="button"
                    onClick={() => openOne(p)}
                    aria-label={`Open the email to ${p.name || p.email} in Gmail`}
                    className={`${outlineBtnCls} ${tapCls}`}
                  >
                    {opened[p.email] ? 'Open again' : 'Open'}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <button type="button" onClick={openAll} className={`${outlineBtnCls} ${tapCls}`}>
              Or write one email to all of them
            </button>
            <p className="min-w-0 flex-1 text-xs text-soft/60">
              It opens with “Dear all,” and their addresses go in Bcc, so nobody is shown anybody else’s.
            </p>
          </div>
        </div>
      )}

      {/* Always in the page, so the line is read out when it comes. */}
      <p role="status" className={notice ? 'mt-2 text-xs text-soft/70' : 'sr-only'}>
        {notice}
      </p>
      {byHand && (
        <textarea
          readOnly
          aria-label="The addresses, to copy"
          value={byHand}
          rows={3}
          onFocus={(e) => e.target.select()}
          className={`${smallInputCls} mt-2 resize-y`}
        />
      )}
    </section>
  )
}
