// Sends the daily portal digest through Resend.
//
// The database decides who gets what: rpc/admin_digest_batch returns, per person, the unread
// notifications that were never emailed and the live updates they have not read (people who
// switched the digest off, or have nothing new, are simply not in it). This function turns each
// entry into one email, sends it, and reports back through rpc/admin_digest_mark so nothing is
// sent twice. Only people whose email Resend accepted are marked; the rest stay queued for
// the next run.
//
// Resend's free plan: 100 emails a day (shared with sign-in links) and 2 requests a second.
// Hence the batch size (80, set in the RPC call) and the pause between sends. A 429 or a
// quota error stops the run early instead of burning through the rest of the list.
//
// Callers (checked here, so the function is deployed with verify_jwt = false): the daily
// pg_cron job with its Vault secret. `{"dry": true}` in the body returns the counts without
// sending anything.
//
// Secrets: RESEND_API_KEY (Dashboard > Edge Functions > Secrets). Without it the function
// answers { skipped } and sends nothing.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const FROM = Deno.env.get('DIGEST_FROM') ?? 'AUSSS Portal <portal@ausss-ainshams.org>'
const PORTAL = Deno.env.get('PORTAL_URL') ?? 'https://ausss-ainshams.org/portal'
const MAX_PEOPLE = 80
const PAUSE_MS = 600

type Notification = { kind: string; payload: Record<string, string | null>; created_at: string }
type Post = { id: string; title: string; kind: string; committee: string | null }
type Person = {
  profile_id: string
  email: string
  full_name: string | null
  notifications: Notification[]
  posts: Post[]
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

async function rpc(fn: string, args: Record<string, unknown> = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(body?.message || `${fn} failed (${res.status})`)
  return body
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

const STATUS: Record<string, string> = {
  todo: 'To do',
  doing: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
}

// The actor's name is deliberately left out: profiles are private between members and an
// email is forever. The portal shows who did it.
function describe(n: Notification) {
  const title = n.payload.title || 'a task'
  switch (n.kind) {
    case 'task_assigned':
      return `You were assigned “${title}”`
    case 'task_status':
      return `“${title}” moved to ${STATUS[n.payload.to ?? ''] || n.payload.to}`
    case 'task_comment':
      return `New comment on “${title}”`
    case 'order_new':
      return `New merch pre-order ${n.payload.ref || ''}${n.payload.subtotal ? ` (${n.payload.subtotal} EGP)` : ''}`
    case 'story_new':
      return `New exchange story ${n.payload.ref || ''}`
    default:
      return `Activity on “${title}”`
  }
}

function render(p: Person) {
  const first = (p.full_name || '').trim().split(/\s+/)[0]
  const hello = first ? `Hi ${first},` : 'Hi,'
  // 'tasks' also carries the website submissions; the heading below covers both
  const tasks = p.notifications.map((n) => ({
    text: describe(n),
    url: n.payload.task_id
      ? `${PORTAL}/tasks/${n.payload.task_id}`
      : n.kind === 'order_new'
        ? `${PORTAL}/submissions?tab=orders`
        : n.kind === 'story_new'
          ? `${PORTAL}/submissions?tab=stories`
          : `${PORTAL}/notifications`,
  }))
  const posts = p.posts.map((x) => ({
    text: `${x.committee || 'AUSSS'}: ${x.title}`,
    url: `${PORTAL}/updates`,
  }))
  const count = tasks.length + posts.length
  const subject =
    count === 1 ? `AUSSS portal: ${(tasks[0] || posts[0]).text}` : `AUSSS portal: ${count} things waiting for you`

  const section = (heading: string, rows: { text: string; url: string }[]) =>
    rows.length
      ? `<h2 style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#5B8DB8;margin:24px 0 8px">${heading}</h2>
         <ul style="padding-left:18px;margin:0">${rows
           .map((r) => `<li style="margin:6px 0"><a href="${esc(r.url)}" style="color:#06402B">${esc(r.text)}</a></li>`)
           .join('')}</ul>`
      : ''
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1b1b1b;max-width:560px">
    <p>${esc(hello)}</p>
    <p>Here is what is waiting for you in the AUSSS members portal.</p>
    ${section('Your tasks and new submissions', tasks)}
    ${section('Updates you have not read', posts)}
    <p style="margin-top:28px"><a href="${esc(PORTAL)}" style="background:#06402B;color:#ffffff;padding:10px 18px;border-radius:999px;text-decoration:none">Open the portal</a></p>
    <p style="margin-top:28px;font-size:12px;color:#777">You get this at most once a day, only when something is unread.
    Switch it off any time in the portal under <a href="${esc(PORTAL)}/profile" style="color:#777">Profile</a>.</p>
  </div>`

  const lines = [hello, '', 'Here is what is waiting for you in the AUSSS members portal.']
  if (tasks.length) lines.push('', 'YOUR TASKS AND NEW SUBMISSIONS', ...tasks.map((r) => `- ${r.text}\n  ${r.url}`))
  if (posts.length) lines.push('', 'UPDATES YOU HAVE NOT READ', ...posts.map((r) => `- ${r.text}`), `  ${PORTAL}/updates`)
  lines.push('', `Open the portal: ${PORTAL}`, '', `At most once a day, only when something is unread. Switch it off under Profile: ${PORTAL}/profile`)
  return { subject: subject.slice(0, 180), html, text: lines.join('\n') }
}

// true = accepted; false = this one failed; 'stop' = quota or rate limit, end the run
async function send(p: Person): Promise<boolean | 'stop'> {
  const mail = render(p)
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [p.email], ...mail }),
  })
  if (res.ok) return true
  const detail = await res.text().catch(() => '')
  console.error(`email-digest: Resend ${res.status} for ${p.profile_id}: ${detail.slice(0, 300)}`)
  return res.status === 429 || /quota/i.test(detail) ? 'stop' : false
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  try {
    const secret = req.headers.get('x-cron-secret')
    if (!secret || (await rpc('admin_digest_cron_secret_ok', { secret })) !== true) {
      return json({ ok: false, error: 'Not allowed.' }, 401)
    }
    const body = await req.json().catch(() => ({}))
    const people: Person[] = await rpc('admin_digest_batch', { max_people: MAX_PEOPLE })
    if (body?.dry) return json({ ok: true, dry: true, people: people.length })
    if (!RESEND_API_KEY) return json({ ok: false, skipped: 'RESEND_API_KEY is not set.', people: people.length })
    if (people.length === 0) return json({ ok: true, sent: 0 })

    const sent: string[] = []
    let failed = 0
    let note = ''
    for (const p of people) {
      const result = await send(p)
      if (result === 'stop') {
        note = `Stopped early at Resend's limit after ${sent.length} of ${people.length}.`
        break
      }
      if (result) sent.push(p.profile_id)
      else failed += 1
      await new Promise((r) => setTimeout(r, PAUSE_MS))
    }
    await rpc('admin_digest_mark', { sent, failed, note })
    return json({ ok: true, sent: sent.length, failed, note })
  } catch (e) {
    console.error('email-digest:', e)
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
