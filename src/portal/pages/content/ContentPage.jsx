import { Link } from 'react-router-dom'
import usePageTitle from '../../../hooks/usePageTitle.js'
import { contentSchema } from '../../../content/index.js'
import { useContentBlocks } from '../../contentQueries.js'
import { when } from '../../workUi.jsx'
import { ErrorText, PageHeader, Panel, Spinner } from '../../portalUi.jsx'

// /portal/content. The parts of the public site this person may edit: every
// one for the EB, and for an officer the ones that name their committee. The
// database decides the list (row-level security on content_blocks).

export function BlockStatus({ block }) {
  const chip = 'rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em]'
  return (
    <span className="flex flex-wrap items-center gap-2">
      {block.published_at ? (
        <span className={`${chip} bg-emerald-400/15 text-ok`}>Published</span>
      ) : (
        <span className={`${chip} bg-veil/10 text-soft/80`}>Built-in copy</span>
      )}
      {(block.has_draft || block.draft_saved_at) && (
        <span className={`${chip} bg-amber-400/15 text-warn`}>Unpublished draft</span>
      )}
    </span>
  )
}

export default function ContentPage() {
  usePageTitle('Site content')
  const blocks = useContentBlocks()
  // Only blocks this version of the site knows how to edit.
  const rows = (blocks.data || [])
    .map((block) => ({ block, schema: contentSchema(block.key) }))
    .filter((r) => r.schema)

  return (
    <>
      <PageHeader
        eyebrow="Site content"
        title="Edit the public site"
        subtitle="Text and pictures on the public pages that you can change yourself. Nothing reaches visitors until you publish it."
      />

      {blocks.isPending ? (
        <div className="py-16 text-center">
          <Spinner />
        </div>
      ) : blocks.error ? (
        <Panel>
          <ErrorText>Couldn’t load the list: {blocks.error.message}</ErrorText>
        </Panel>
      ) : rows.length === 0 ? (
        <Panel>
          <p className="text-sm text-soft/70">
            There is nothing here for you to edit yet. The Executive Board can edit every part; an
            officer sees the parts that belong to their committee.
          </p>
        </Panel>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {rows.map(({ block, schema }) => (
            <li key={block.key}>
              <Link
                to={`/portal/content/${block.key}`}
                className="flex h-full flex-col gap-3 rounded-2xl border border-line/10 bg-card p-5 transition-colors hover:border-medical/40"
              >
                <BlockStatus block={block} />
                <span className="heading-serif text-xl text-ink">{schema.title}</span>
                <span className="text-sm leading-relaxed text-soft/65">{schema.description}</span>
                <span className="mt-auto pt-1 text-xs text-soft/50">
                  {block.published_at
                    ? `Last published ${when(block.published_at)}`
                    : 'Never published from the portal'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
