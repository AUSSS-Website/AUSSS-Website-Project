import { useMemo, useState } from 'react'
import usePageTitle from '../../hooks/usePageTitle.js'
import { useDirectory } from '../queries.js'
import { ErrorText, PageHeader, PageLoading, Panel, inputCls, outlineBtnCls } from '../portalUi.jsx'
import { Avatar } from '../Avatar.jsx'
import { normalize } from '../../lib/text.js'
import { errorText } from '../../lib/errorText.js'

// /portal/directory. Every member with an account, with the positions they
// hold this term. Name, photo and positions only: no contact details.
// rpc/directory answers verified members and position holders, and lists the
// same people; anyone else gets its refusal, which this page puts in its own
// words. Any other failure can be tried again from here.

const EMPTY = []

// The portal's pills are under 44px tall to the eye. This ::after gives a
// finger the difference without changing how they look.
const tapCls = "relative after:absolute after:inset-x-0 after:-inset-y-[10px] after:content-['']"

function positionLine(p) {
  return p.committee ? `${p.committee} · ${p.title}` : p.title
}

export default function DirectoryPage() {
  usePageTitle('Directory')
  const directory = useDirectory()
  const [q, setQ] = useState('')
  const rows = directory.data || EMPTY

  const shown = useMemo(() => {
    const words = normalize(q).split(' ').filter(Boolean)
    if (!words.length) return rows
    return rows.filter((m) => {
      const hay = normalize(`${m.full_name} ${m.positions.map(positionLine).join(' ')}`)
      return words.every((w) => hay.includes(w))
    })
  }, [rows, q])

  return (
    <>
      <PageHeader
        eyebrow="Directory"
        title="Members directory"
        subtitle="Every member with a portal account, and the positions they hold this term."
      />

      {directory.isPending ? (
        <PageLoading />
      ) : directory.error ? (
        <Panel>
          {directory.error.code === '42501' ? (
            <p className="text-sm text-soft/70">
              The directory is for verified members. Once your membership is verified it opens here.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
              <ErrorText>{errorText(directory.error, 'Couldn’t load the directory.')}</ErrorText>
              <button type="button" onClick={() => directory.refetch()} className={`${outlineBtnCls} ${tapCls}`}>
                Try again
              </button>
            </div>
          )}
        </Panel>
      ) : rows.length === 0 ? (
        <Panel>
          <p className="text-sm text-soft/70">Nobody is listed yet.</p>
        </Panel>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 pb-5">
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name, committee or position"
              aria-label="Search the directory"
              className={`${inputCls} max-w-sm`}
            />
            <span className="text-xs text-soft/50" aria-live="polite">
              {shown.length} {shown.length === 1 ? 'member' : 'members'}
            </span>
          </div>
          {shown.length === 0 ? (
            <Panel>
              <p className="text-sm text-soft/70">Nobody matches that.</p>
            </Panel>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {shown.map((m) => (
                <li
                  key={m.id}
                  className="flex min-w-0 items-center gap-4 rounded-2xl border border-line/10 bg-card p-4"
                >
                  <Avatar name={m.full_name} src={m.avatar_url} size="row" />
                  <div className="min-w-0">
                    <p className="break-words text-sm font-semibold text-ink">{m.full_name}</p>
                    {m.positions.length === 0 ? (
                      <p className="mt-0.5 text-xs text-soft/45">Member</p>
                    ) : (
                      m.positions.map((p, i) => (
                        <p key={i} className="mt-0.5 break-words text-xs text-soft/60">
                          {positionLine(p)}
                        </p>
                      ))
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  )
}
