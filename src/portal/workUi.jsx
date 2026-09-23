import { todayCairo } from './officerQueries.js'

// Small shared pieces for the tasks, updates and notifications pages: labels
// for the database's status / priority / kind values, due-date wording, and
// the chips every list renders.

export const TASK_STATUSES = [
  ['todo', 'To do'],
  ['doing', 'In progress'],
  ['blocked', 'Blocked'],
  ['done', 'Done'],
]
export const STATUS_LABEL = Object.fromEntries(TASK_STATUSES)

export const TASK_PRIORITIES = [
  ['low', 'Low'],
  ['normal', 'Normal'],
  ['high', 'High'],
  ['urgent', 'Urgent'],
]
export const PRIORITY_RANK = { urgent: 3, high: 2, normal: 1, low: 0 }

export const POST_KINDS = [
  ['announcement', 'Announcement'],
  ['news', 'News'],
  ['resource', 'Resource'],
]
export const POST_KIND_LABEL = Object.fromEntries(POST_KINDS)

export const LEVEL_LABELS = [
  ['officer', 'Officers'],
  ['assistant', 'Assistants'],
  ['member', 'Members'],
]

const STATUS_CLS = {
  todo: 'bg-white/10 text-silver/80',
  doing: 'bg-medical/20 text-medical-light',
  blocked: 'bg-red-400/15 text-red-300',
  done: 'bg-emerald-400/15 text-emerald-300',
}

const pillCls = 'rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em]'

export function TaskStatusPill({ status }) {
  return (
    <span className={`${pillCls} ${STATUS_CLS[status] || STATUS_CLS.todo}`}>
      {STATUS_LABEL[status] || status}
    </span>
  )
}

// Only the priorities worth shouting about get a chip.
export function PriorityPill({ priority }) {
  if (priority !== 'high' && priority !== 'urgent') return null
  return (
    <span
      className={`${pillCls} ${
        priority === 'urgent' ? 'bg-red-400/15 text-red-300' : 'bg-amber-400/15 text-amber-300'
      }`}
    >
      {priority}
    </span>
  )
}

// Committee colour as a hairline chip; "AUSSS" for society-wide rows.
export function CommitteeTag({ committee }) {
  const hex6 = committee?.color && /^#[0-9a-f]{6}$/i.test(committee.color)
  return (
    <span
      className="inline-flex items-center rounded-full border border-white/15 px-2.5 py-0.5 text-[11px] font-semibold text-white"
      style={hex6 ? { borderColor: committee.color, backgroundColor: `${committee.color}22` } : undefined}
      title={committee?.name || 'Whole society'}
    >
      {committee?.abbr || 'AUSSS'}
    </span>
  )
}

function dayDiff(due) {
  const a = Date.parse(`${due}T00:00:00Z`)
  const b = Date.parse(`${todayCairo()}T00:00:00Z`)
  return Math.round((a - b) / 86400000)
}

// Due dates are Cairo calendar days and the day itself is still on time.
function dueInfo(task) {
  if (!task.due_on) return null
  const d = dayDiff(task.due_on)
  const date = new Date(`${task.due_on}T12:00:00`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  })
  if (task.status === 'done') return { label: `Was due ${date}`, tone: 'muted' }
  if (d < 0) return { label: `Overdue since ${date}`, tone: 'late' }
  if (d === 0) return { label: 'Due today', tone: 'soon' }
  if (d === 1) return { label: 'Due tomorrow', tone: 'soon' }
  if (d <= 7) return { label: `Due in ${d} days`, tone: 'normal' }
  return { label: `Due ${date}`, tone: 'normal' }
}

const DUE_CLS = {
  muted: 'text-silver/40',
  late: 'text-red-300',
  soon: 'text-amber-300',
  normal: 'text-silver/60',
}

export function DueLabel({ task }) {
  const info = dueInfo(task)
  if (!info) return null
  return <span className={`text-xs font-semibold ${DUE_CLS[info.tone]}`}>{info.label}</span>
}

export function when(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return ''
  }
}

export function personName(names, id, fallback = 'Someone') {
  return names[id]?.full_name || fallback
}

// Bodies are plain text: keep the line breaks, make bare links clickable.
const URL_RE = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/g

export function RichText({ text, className = '' }) {
  if (!text) return null
  const parts = String(text).split(URL_RE)
  return (
    <p className={`whitespace-pre-wrap break-words ${className}`}>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="text-medical-light underline decoration-white/20 underline-offset-2 hover:text-white"
          >
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </p>
  )
}

export function UnreadDot({ label = 'Unread' }) {
  return <span role="img" aria-label={label} className="inline-block h-2 w-2 shrink-0 rounded-full bg-medical-light" />
}

export const smallInputCls =
  'w-full rounded-lg border border-white/15 bg-forest-950 px-3 py-2 text-sm text-white placeholder:text-silver/40 focus:border-medical focus:outline-none'

export const chipBtnCls = (active) =>
  `rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
    active
      ? 'border-medical bg-medical/15 text-white'
      : 'border-white/15 text-silver/65 hover:border-white/30 hover:text-white'
  }`
