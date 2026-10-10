// The portal walked with a made-up session and sample rows: every portal page
// at a list of widths in both themes, measured for sideways scrolling and
// text contrast and saved as a screenshot. It needs no sign-in and shows no
// real person, and nothing it does reaches production: every Supabase call is
// answered here, except anonymous reads of the public committees and settings
// tables. Use it to check a design change on the portal; the signed-in walk
// (scripts/page-walk.mjs with --login) is still the one that sees real data.
//
//   npm run walk:portal-sample                      everything (needs npm run dev)
//   npm run walk:portal-sample -- light 320,375     themes, then widths
//   npm run walk:portal-sample -- dark 1440 /portal/tasks
//
// The sample rows below follow the columns the portal selects. When a page
// gains a query, give it a row here or the page shows its empty state. An
// entry of `rpcs` is the function's answer, or a function of what the page
// sent when the answer depends on it (which exam, which paper, which word).
//
// The exchange exam is walked from both sides: the portal's Exam pages
// (/portal/exam), and the pages students sit it on (/exam/<word>), which are no
// part of the portal. There the word in the address chooses what the student
// meets, from the sign-in card to "Your exam was received." (see `doors`).
//
//   npm run walk:portal-sample -- light,dark 320,375 /exam
//
// A few screens only show after a tap (a question's form, a wrong start code,
// a hand-in that got no answer): `acts` holds what the walk does on those
// routes before it measures. The part after # in a route names such a screen
// and means nothing to the page, except on the paper, where #review is its
// last step.
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { chromium } from 'playwright'
import { measureCutOff } from './walk-checks.mjs'

const themes = (process.argv[2] || 'dark,light').split(',')
const widths = (process.argv[3] || '320,375,768,1024,1440,1920').split(',').map(Number)
const only = process.argv[4] || ''
const base = 'http://localhost:5173'
const REF = 'wjijkqrdaakiwbtdssio'
const uid = '00000000-0000-4000-8000-000000000001'
const other = '00000000-0000-4000-8000-000000000002'
const now = Math.floor(Date.now() / 1000)
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, role: 'authenticated', email: 'webmaster@example.com', exp: now + 86400, iat: now, aud: 'authenticated' })}.sig`
const user = {
  id: uid,
  aud: 'authenticated',
  role: 'authenticated',
  email: 'webmaster@example.com',
  app_metadata: { provider: 'email' },
  user_metadata: { full_name: 'Sample Webmaster' },
  created_at: '2026-09-01T00:00:00Z',
}
const session = { access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 86400, expires_at: now + 86400, user }

const iso = (daysAgo) => new Date(Date.now() - daysAgo * 864e5).toISOString()
const day = (ahead) => new Date(Date.now() + ahead * 864e5).toISOString().slice(0, 10)
const scope = { id: 'c-scope', slug: 'scope', abbr: 'SCOPE', name: 'Professional Exchange', color: '#0181c1' }
// Events around today: three coming up (one over multiple days with hours
// of their own), a multi-day all-day draft, two over.
const at = (daysAhead, hour) => {
  const d = new Date(Date.now() + daysAhead * 864e5)
  d.setUTCHours(hour - 2, 0, 0, 0)
  return d.toISOString()
}
const scoph = { slug: 'scoph', abbr: 'SCOPH', name: 'Public Health', color: '#1b9e4b' }
const scora = { slug: 'scora', abbr: 'SCORA', name: 'Sexual & Reproductive Health and Rights incl. HIV & AIDS', color: '#d1477a' }
const springDays = [
  { starts_at: at(8, 10), ends_at: at(8, 16) },
  { starts_at: at(9, 12), ends_at: at(9, 18) },
  { starts_at: at(10, 9), ends_at: at(10, 13) },
]
const sampleEvents = [
  { id: 'ev-6', slug: 'spring-school-on-research-methods-2026', committee_id: 'c-score', committee: { slug: 'score', abbr: 'SCORE', name: 'Research Exchange', color: '#e5b513' }, title: 'Spring school on research methods', description: 'Three days of workshops, from a research question to a poster.', starts_at: springDays[0].starts_at, ends_at: springDays[2].ends_at, all_day: false, days: springDays, place: 'Lecture hall 4, Faculty of Medicine', image: '', signup_url: 'https://forms.gle/example', published: true, created_at: iso(2), updated_at: iso(1) },
  { id: 'ev-1', slug: 'world-health-day-stand-2026', committee_id: 'c-scoph', committee: scoph, title: 'World Health Day stand', description: 'Blood pressure checks, a **quiz** and free leaflets.\n\n- Bring your student card\n- Volunteers meet at 10:30\n\nQuestions? Ask on [our page](/committees/scoph).', starts_at: at(5, 11), ends_at: at(5, 15), all_day: false, place: 'Faculty garden, Ain Shams Faculty of Medicine', image: '/assets/exchange/incomings/campus.jpg', signup_url: 'https://forms.gle/example', published: true, created_at: iso(3), updated_at: iso(1) },
  { id: 'ev-2', slug: 'first-general-assembly-2026', committee_id: null, committee: null, title: 'First general assembly', description: '', starts_at: at(12, 17), ends_at: null, all_day: false, place: '', image: '', signup_url: '', published: true, created_at: iso(3), updated_at: iso(1) },
  { id: 'ev-3', slug: 'summer-camp-on-sexual-and-reproductive-health-and-rights-2026', committee_id: 'c-scora', committee: scora, title: 'Summer camp on sexual and reproductive health and rights, with a title long enough to wrap', description: 'Three days of workshops.', starts_at: at(30, 0), ends_at: at(32, 0), all_day: true, place: 'Ain Sokhna', image: '/assets/exchange/sama-02.jpg', signup_url: '', published: false, created_at: iso(2), updated_at: iso(0.5) },
  { id: 'ev-4', slug: 'incomings-welcome-night-2026', committee_id: 'c-scope', committee: { slug: 'scope', abbr: 'SCOPE', name: 'Professional Exchange', color: '#0181c1' }, title: 'Incomings welcome night', description: 'Dinner on the Nile with the August incomings.', starts_at: at(-40, 19), ends_at: at(-40, 23), all_day: false, place: 'Zamalek', image: '/assets/exchange/incomings/together.jpg', signup_url: '', published: true, created_at: iso(60), updated_at: iso(40) },
  { id: 'ev-5', slug: 'national-general-assembly-aswan-2025', committee_id: null, committee: null, title: 'National General Assembly, Aswan', description: '', starts_at: at(-400, 0), ends_at: at(-397, 0), all_day: true, place: 'Aswan', image: '', signup_url: '', published: true, created_at: iso(420), updated_at: iso(400) },
]
const termOf = (iso) => {
  const d = new Date(iso)
  const y = d.getUTCFullYear()
  return d.getUTCMonth() >= 8 ? `${y}-${String(y + 1).slice(2)}` : `${y - 1}-${String(y).slice(2)}`
}
const overOf = (e) => {
  const last = Date.parse(e.ends_at || e.starts_at)
  return new Date(e.all_day ? last + 864e5 : last).toISOString()
}

// ---- the exchange exam --------------------------------------------------------
// Three exams. This term's (ex-1) is being sat as the walk runs: it opened
// three hours ago, a student can start for one more hour, and every paper runs
// two hours from its own start. Beside it a draft (ex-2), and last term's
// (ex-0), whose list and papers went with its term. A real exam has about a
// hundred questions; a dozen keep the portal's pages short enough to look at.
const minutesAgo = (m) => new Date(Date.now() - m * 6e4).toISOString()
// `correct` is the right option's place from 0; `keep` keeps the options as
// written. Among them: a long question with six options, questions with two,
// three and five, one in Arabic, and one with an address that has no space
// to wrap at.
const examQuestions = [
  { body: 'Which chamber of the heart pumps blood into the aorta?', options: ['The right atrium', 'The right ventricle', 'The left atrium', 'The left ventricle'], correct: 3 },
  { body: 'How many weeks does a SCORE research exchange last?', options: ['Two', 'Four', 'Six', 'Eight'], correct: 1 },
  {
    body: 'A 24-year-old exchange student comes to the emergency department on the third day of a clerkship abroad with a fever of 39.2 °C, a headache that began the evening before, a stiff neck and a new rash on both legs that does not fade when a glass is pressed on it. Nobody on the ward speaks the student’s first language, and the resident asks you, the contact person, to stay.\n\nWhich of these should happen first?',
    options: [
      'Give the first dose of intravenous antibiotics without waiting for the lumbar puncture, and call the senior on duty',
      'Book a CT scan of the head and wait for its report before any treatment',
      'Send the student back to the dormitory with paracetamol and see them again in the morning',
      'Wait for an interpreter, so that a full history can be taken first',
      'Start antibiotics by mouth and book a clinic visit for the next working day',
      'Ask the student to come back with a friend who can translate',
    ],
    correct: 0,
  },
  { body: 'Which of these are signs of dehydration in an adult?', options: ['A dry mouth', 'Passing little urine', 'Dizziness on standing up', 'All of the above'], correct: 3, keep: true },
  { body: 'Insulin lowers the level of glucose in the blood.', options: ['True', 'False'], correct: 0 },
  { body: 'أي من هذه المدن هي عاصمة مصر؟', options: ['القاهرة', 'الإسكندرية', 'أسوان', 'الأقصر'], correct: 0 },
  { body: 'Which vitamin does the skin make in sunlight?', options: ['Vitamin A', 'Vitamin B12', 'Vitamin C', 'Vitamin D'], correct: 3 },
  { body: 'What is the resting heart rate of a healthy adult?', options: ['40 to 50 beats a minute', '60 to 100 beats a minute', '110 to 130 beats a minute'], correct: 1 },
  { body: 'Which organ makes bile?', options: ['The pancreas', 'The liver', 'The gallbladder', 'The spleen', 'The stomach'], correct: 1 },
  { body: 'The exchange conditions of a faculty are published at https://example.org/exchange/conditions/egypt/ain-shams-university/2026-27/professional-exchange. Which part of that address names the country?', options: ['exchange', 'conditions', 'egypt', 'professional-exchange'], correct: 2 },
  { body: 'Which blood group can give red cells to anyone?', options: ['A positive', 'B negative', 'AB positive', 'O negative'], correct: 3 },
  { body: 'Which of these is measured in millimetres of mercury?', options: ['Blood pressure', 'Body temperature', 'Heart rate', 'Blood glucose'], correct: 0 },
]
// Rows of exam_questions with the key embedded, as the Questions tab selects them.
const questionsOf = (examId, list) =>
  list.map((q, i) => ({ id: `${examId}-q${i + 1}`, exam_id: examId, sort: i, body: q.body, options: q.options, keep_option_order: Boolean(q.keep), updated_at: iso(2), exam_key: { correct_option: q.correct } }))
const sampleQuestions = [...questionsOf('ex-1', examQuestions), ...questionsOf('ex-2', examQuestions.slice(1, 4)), ...questionsOf('ex-0', examQuestions)]
// How many IDs are on ex-1's list, how many of them an account holds, and how
// many of those have started. The lists below are made to these numbers.
const HALL = { ids: 412, held: 395, papers: 387 }
const examCounts = (questions, ids, papers) => ({ exam_questions: [{ count: questions }], exam_registrations: [{ count: ids }], exam_attempts: [{ count: papers }] })
const sampleExams = [
  { id: 'ex-2', term_id: 't1', title: 'Research exchange exam, a second sitting for the students who missed the first', address_word: '5f0c2a9b71de', status: 'draft', opens_at: null, closes_at: null, minutes: 120, start_code: '', created_by: uid, created_at: iso(1), updated_at: iso(0.5), term: { label: '2026-27', is_current: true }, ...examCounts(3, 0, 0) },
  { id: 'ex-1', term_id: 't1', title: 'Exchange exam 2026-27', address_word: 'autumn-exchange-2026', status: 'ready', opens_at: minutesAgo(180), closes_at: minutesAgo(-60), minutes: 120, start_code: 'K7QM4X', created_by: other, created_at: iso(20), updated_at: iso(0.2), term: { label: '2026-27', is_current: true }, ...examCounts(examQuestions.length, HALL.ids, HALL.papers) },
  { id: 'ex-0', term_id: 't0', title: 'Exchange exam 2025-26', address_word: 'exchange-exam-2025', status: 'ready', opens_at: at(-330, 18), closes_at: at(-330, 19), minutes: 120, start_code: 'R4TB9N', created_by: other, created_at: iso(350), updated_at: iso(330), term: { label: '2025-26', is_current: false }, ...examCounts(examQuestions.length, 0, 0) },
]
const tables = {
  profiles: [
    { id: uid, full_name: 'Sample Webmaster', email: 'webmaster@example.com', membership_status: 'active', avatar_url: null, photo_path: null, email_digest: true, directory_opt_in: true, phone: '', created_at: iso(30), updated_at: iso(1) },
  ],
  assignments: [
    { id: 'a1', status: 'active', position: { id: 'p1', key: 'society.webmaster', title: 'Webmaster', short_title: 'Webmaster', level: 'webmaster', can_assign_tasks: true, committee: null }, term: { id: 't1', label: '2026-27', is_current: true } },
  ],
  tasks: [
    { id: 't-1', title: 'Collect the incomings welcome booklet photos from every contact person', body: 'One folder per student. Names on the files, please.', status: 'todo', priority: 'high', due_on: day(2), completed_at: null, committee_id: 'c-scope', created_by: uid, created_at: iso(3), updated_at: iso(1), committee: scope, assignees: [{ profile_id: uid }, { profile_id: other }] },
    { id: 't-2', title: 'Book the hall for the first general assembly', body: '', status: 'doing', priority: 'normal', due_on: day(-1), completed_at: null, committee_id: null, created_by: other, created_at: iso(6), updated_at: iso(2), committee: null, assignees: [{ profile_id: uid }] },
    { id: 't-3', title: 'Send the orientation recap', body: '', status: 'done', priority: 'normal', due_on: day(-6), completed_at: iso(5), committee_id: 'c-scope', created_by: uid, created_at: iso(12), updated_at: iso(5), committee: scope, assignees: [{ profile_id: other }] },
  ],
  posts: [
    { id: 'po-1', committee_id: 'c-scope', kind: 'update', title: 'Exchange season opens on the first of November', body: 'Applications go through the portal this year. Read the conditions before you apply: https://ausss-ainshams.org/exchange', levels: ['member', 'assistant', 'officer'], pinned: true, publish_at: iso(2), expires_at: null, author_id: uid, created_at: iso(2), committee: scope, reads: [] },
  ],
  notifications: [
    { id: 'n-1', kind: 'task_assigned', payload: { task_id: 't-1', title: 'Collect the incomings welcome booklet photos', actor_id: other }, read_at: null, created_at: iso(0.1) },
    { id: 'n-2', kind: 'task_comment', payload: { task_id: 't-2', title: 'Book the hall for the first general assembly', actor_id: other }, read_at: iso(1), created_at: iso(2) },
  ],
  roster_entries: [
    { id: 'r-1', full_name: 'Sample Member With A Rather Long Four Part Name', email: 'member1@example.com', status: 'Full Member', joined_year: 2023, years_spent: 3, lgas: 4, ngas: 1, current_position: 'Exchange Incomings Assistant', origin: 'sheet', portal_edited_at: null, profile_id: null, import_batch: 'b1', updated_at: iso(1), committee_id: 'c-scope', is_contact_person: true, position_id: null },
    { id: 'r-2', full_name: 'Second Sample', email: 'member2@example.com', status: 'Candidate Member', joined_year: 2025, years_spent: 1, lgas: 1, ngas: 0, current_position: '', origin: 'sheet', portal_edited_at: null, profile_id: null, import_batch: 'b1', updated_at: iso(1), committee_id: null, is_contact_person: false, position_id: null },
    { id: 'r-3', full_name: 'Third Sample', email: 'member3@example.com', status: 'Associate Member', joined_year: 2024, years_spent: 2, lgas: 2, ngas: 0, current_position: 'Local Member', origin: 'portal', portal_edited_at: iso(2), profile_id: null, import_batch: null, updated_at: iso(2), committee_id: 'c-scope', is_contact_person: false, position_id: null },
  ],
  albums: [
    { id: 'al-1', slug: 'national-general-assembly-aswan-2026', title: 'National General Assembly, Aswan 2026', blurb: 'Three days in Aswan.', cover_photo_id: null, sort_order: 0, published: true, created_at: iso(20), updated_at: iso(2), archived_term_id: null, archived_term: null },
    { id: 'al-2', slug: 'orientation-day', title: 'Orientation day', blurb: '', cover_photo_id: null, sort_order: 1, published: true, created_at: iso(15), updated_at: iso(3), archived_term_id: null, archived_term: null },
    { id: 'al-3', slug: 'world-diabetes-day-campaign', title: 'World Diabetes Day campaign', blurb: '', cover_photo_id: null, sort_order: 2, published: false, created_at: iso(5), updated_at: iso(1), archived_term_id: null, archived_term: null },
    // archived at last term's rollover
    { id: 'al-4', slug: 'winter-camp-2026', title: 'Winter camp 2026, with a title long enough to wrap on a phone', blurb: '', cover_photo_id: null, sort_order: 0, published: true, created_at: iso(300), updated_at: iso(40), archived_term_id: 't0', archived_term: { label: '2025-26' } },
    { id: 'al-5', slug: 'orientation-25-26', title: 'Orientation 25-26', blurb: '', cover_photo_id: null, sort_order: 1, published: true, created_at: iso(380), updated_at: iso(40), archived_term_id: 't0', archived_term: { label: '2025-26' } },
  ],
  terms: [{ id: 't1', label: '2026-27' }],
  content_blocks: [
    { key: 'join.faq', editors: [], has_draft: iso(0.2), draft: { items: [{ q: 'Who can join AUSSS?', a: 'Any student at the **Faculty of Medicine**, Ain Shams University. See the [committees](/#committees) to find where you fit.' }, { q: 'A question long enough to wrap onto a second line on a small phone, to see how the row copes?', a: 'It copes.\n\n- one\n- two' }] }, published: null, draft_saved_at: iso(0.2), draft_saved_by: other, published_at: null, published_by: null, updated_at: iso(0.2) },
    // nothing saved yet: the editor opens on the copy that ships in the code
    { key: 'exchange.incomings', editors: ['scope', 'score'], has_draft: null, draft: null, published: null, draft_saved_at: null, draft_saved_by: null, published_at: null, published_by: null, updated_at: iso(3) },
    { key: 'site.contact', editors: [], has_draft: null, draft: null, published: null, draft_saved_at: null, draft_saved_by: null, published_at: null, published_by: null, updated_at: iso(3) },
    { key: 'home.page', editors: [], has_draft: null, draft: null, published: null, draft_saved_at: null, draft_saved_by: null, published_at: null, published_by: null, updated_at: iso(3) },
    { key: 'ifmsa.page', editors: [], has_draft: null, draft: null, published: null, draft_saved_at: null, draft_saved_by: null, published_at: null, published_by: null, updated_at: iso(3) },
  ],
  orders: [
    { id: 'o-1', ref: 'AUSSS-7F3K2Q', status: 'new', name: 'Sample Buyer', email: 'buyer1@example.com', phone: '01000000001', is_member: true, lc: '', year: '3rd year', payment_method: 'instapay', items: [{ product_id: 'tshirt-55', name: 'AUSSS T-Shirt, 55th Limited Edition', size: 'L', design: '', qty: 2, unit_price: 300, line_total: 600 }, { product_id: 'notebook', name: 'AUSSS Notebook', size: '', design: 'Support Divisions', qty: 1, unit_price: 40, line_total: 40 }], subtotal: 640, client_subtotal: 640, price_flag: '', notes: '', officer_notes: '', receipt_path: 'o-1.jpg', created_at: iso(0.2), updated_at: iso(0.2) },
    { id: 'o-2', ref: 'AUSSS-9QX81B', status: 'contacted', name: 'Another Buyer With A Long Name', email: 'a-rather-long-address-for-a-phone@example.com', phone: '+44 7700 900123', is_member: false, lc: 'Cairo', year: 'Other / External', payment_method: 'telda', items: [{ product_id: 'jacket', name: '"The" AUSSS Jacket', size: '2XL', design: '', qty: 1, unit_price: 650, line_total: 650 }], subtotal: 650, client_subtotal: 600, price_flag: 'price mismatch (client said 600, server 650)', notes: '', officer_notes: '', receipt_path: null, created_at: iso(2), updated_at: iso(1) },
    { id: 'o-3', ref: 'AUSSS-2M4N6P', status: 'delivered', name: 'Third Buyer', email: 'buyer3@example.com', phone: '01000000003', is_member: true, lc: '', year: '5th year', payment_method: 'vodafone', items: [{ product_id: 'bucket-hat', name: 'Dash Bucket Hat', size: 'One size', design: '', qty: 1, unit_price: 150, line_total: 150 }], subtotal: 150, client_subtotal: 150, price_flag: '', notes: '', officer_notes: '', receipt_path: 'o-3.jpg', created_at: iso(9), updated_at: iso(3) },
  ],
  merch_products: [
    { id: 'tshirt-55', name: 'AUSSS T-Shirt, 55th Limited Edition', tagline: 'Think Global. Act Local.', description: 'Forest-green ringer tee with white trim.', image: '/assets/merch/page-04.jpg', price: 300, sizes: ['S', 'M', 'L', 'XL', 'XXL'], size_chart: '/assets/merch/size-chart-tshirt.jpg', designs: [], wide_designs: [], available: true, sort_order: 0, updated_at: iso(3) },
    { id: 'notebook', name: 'AUSSS Notebook', tagline: 'Like it? Note it down.', description: 'Spiral-bound notebook with a committee-themed cover.', image: '/assets/merch/page-13.jpg', price: 40, sizes: [], size_chart: '', designs: ['SCOPH', 'SCORA', 'Exchange', 'Support Divisions'], wide_designs: ['Exchange', 'Support Divisions'], available: true, sort_order: 1, updated_at: iso(3) },
    { id: 'a-new-product-with-a-long-id-for-phones', name: 'A new product with a rather long name that wraps', tagline: '', description: '', image: '', price: 120, sizes: [], size_chart: '', designs: [], wide_designs: [], available: false, sort_order: 2, updated_at: iso(0.1) },
  ],
  events: sampleEvents,
  exams: sampleExams,
  exam_questions: sampleQuestions,
  audit_log: [
    // The exam's two slim entries: an ID released from its account, and a paper deleted.
    { id: 5, at: iso(0.02), actor: uid, table_name: 'exam_registrations', row_id: '5d0c2f0e-8c1b-4b7e-9d0a-2f6f1f3b7a10', action: 'RELEASE', before: { exam_id: 'ex-1', profile_id: other }, after: null },
    { id: 4, at: iso(0.05), actor: other, table_name: 'exam_attempts', row_id: 'at-005', action: 'DELETE', before: { exam_id: 'ex-1', profile_id: other, started_at: iso(0.2), submitted_at: null }, after: null },
    { id: 3, at: iso(0.1), actor: uid, table_name: 'content_blocks', row_id: 'join.faq', action: 'UPDATE', before: { key: 'join.faq', draft: null, updated_at: iso(1) }, after: { key: 'join.faq', draft: { items: [{ q: 'Who can join AUSSS?', a: 'Any student at the Faculty of Medicine.' }] }, updated_at: iso(0.1) } },
    { id: 2, at: iso(1), actor: other, table_name: 'tasks', row_id: '7a1f0c1e-5b1d-4c58-9a57-3f2f3a6f0c11', action: 'INSERT', before: null, after: { id: '7a1f0c1e-5b1d-4c58-9a57-3f2f3a6f0c11', title: 'Collect the incomings welcome booklet photos from every contact person', status: 'todo', priority: 'high' } },
    { id: 1, at: iso(2), actor: null, table_name: 'roster_entries', row_id: 'a-row-id-long-enough-to-need-breaking-on-a-phone-0123456789', action: 'DELETE', before: { full_name: 'Sample Member With A Rather Long Four Part Name', email: 'member1@example.com', status: 'Full Member' }, after: null },
  ],
}
// The public gallery: two albums in it, three archived over two terms.
const galleryPhotos = (album, n) =>
  Array.from({ length: n }, (_, i) => ({ id: `${album}-p${i}`, path: `${album}/p${i}`, w: 1600, h: 1067, featured: i === 0, label: i === 0 ? 'Day one' : '' }))
const galleryAlbum = (id, slug, title, blurb, term, n) => ({ id, slug, title, blurb, count: n, cover: `${id}/p0`, aliases: [], term, photos: galleryPhotos(id, n) })

// ---- the hall of exam ex-1 ----------------------------------------------------
// The people who hold an ID on its list. A few are written out, by their place
// (the top of the ranking, a long name with a long address, a name and an ID in
// Arabic, each state of a paper, one who has not started); the rest are made
// from the lists below. chance(n) is the same number for the same n, so two
// runs show the same hall.
const chance = (n) => {
  const x = Math.sin(n * 12.9898) * 43758.5453
  return x - Math.floor(x)
}
const pick = (list, n) => list[Math.floor(chance(n) * list.length)]
const GIVEN = ['Amal', 'Basil', 'Dalia', 'Emad', 'Farah', 'Gamal', 'Hana', 'Idris', 'Jana', 'Kamal', 'Laila', 'Mona', 'Nabil', 'Omar', 'Rana', 'Sami', 'Tala', 'Wael', 'Yara', 'Zein']
const FAMILY = ['Sample', 'Example', 'Specimen', 'Placeholder', 'Template', 'Stand-In', 'Mockup']
const YEARS = ['Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5', '1st year intern', '2nd year intern']
// `paper` is { score, answered, state, started (minutes ago), took (minutes) }.
const written = {
  0: { full_name: 'Yara Sample', paper: { score: 12, answered: 12, state: 'handed_in', started: 172, took: 96 } },
  1: { full_name: 'Sample Student With A Rather Long Six Part Name', email: 'an.address.as.long.as.a.mailbox.allows.2026@example.com', student_id: '2019 0017', paper: { score: 11, answered: 12, state: 'handed_in', started: 168, took: 118 } },
  2: { full_name: 'طالب تجريبي للاختبار', student_id: '٢٠١٩٠٠٤٢', paper: { score: 11, answered: 11, state: 'timed_out', started: 150, took: 120 } },
  3: { full_name: 'Omar Example', paper: { score: 11, answered: 11, state: 'sitting', started: 74 } },
  4: { full_name: 'Amal Placeholder', phone: '+20 100 000 0005', paper: { score: 10, answered: 11, state: 'timed_out', started: 165, took: 120 } },
  [HALL.papers]: { full_name: 'Farah Specimen', student_id: '2019-0020' },
}
const people = Array.from({ length: HALL.held }, (_, i) => ({
  profile_id: `st-${i}`,
  full_name: `${pick(GIVEN, i)} ${pick(GIVEN, i + 500)} ${pick(FAMILY, i + 900)}`,
  email: `student${String(i).padStart(3, '0')}@example.com`,
  phone: `010${10000000 + Math.floor(chance(i + 1300) * 89999999)}`,
  faculty_year: pick(YEARS, i + 1700),
  student_id: `${2020 + (i % 5)}${1000 + i * 3}`,
  ...written[i],
}))
// A made-up paper. How long ago it was started decides whether it can be over:
// one started more than two hours ago was handed in or ran out of time.
const madePaper = (i) => {
  const all = examQuestions.length
  const started = 6 + Math.floor(chance(i + 2100) * 170)
  const grade = Math.min(all - 1, Math.max(1, Math.round(7 + (chance(i + 3300) + chance(i + 3700) + chance(i + 4100) - 1.5) * 3.6)))
  if (started >= 120) {
    const timedOut = chance(i + 2500) < 0.06
    const answered = timedOut ? 9 + Math.floor(chance(i + 4500) * 3) : chance(i + 4500) < 0.8 ? all : all - 1
    return { score: grade, answered: Math.max(grade, answered), state: timedOut ? 'timed_out' : 'handed_in', started, took: timedOut ? 120 : 55 + Math.floor(chance(i + 2900) * 64) }
  }
  if (started > 60 && chance(i + 2500) < 0.35) {
    return { score: grade, answered: all, state: 'handed_in', started, took: 45 + Math.floor(chance(i + 2900) * (started - 45)) }
  }
  const answered = Math.min(all, Math.round(started / 9))
  return { score: Math.round((answered * grade) / all), answered, state: 'sitting', started }
}
// The papers as rpc/exam_results orders and ranks them: the highest grade
// first, equal grades by name and sharing a rank.
const examPapers = people
  .slice(0, HALL.papers)
  .map(({ paper, ...who }, i) => {
    const p = paper || madePaper(i)
    const finished = p.state === 'sitting' ? null : minutesAgo(p.started - p.took)
    return {
      attempt_id: `at-${String(i + 1).padStart(3, '0')}`,
      ...who,
      started_at: minutesAgo(p.started),
      submitted_at: p.state === 'handed_in' ? finished : null,
      finished_at: finished,
      state: p.state,
      answered: p.answered,
      score: p.score,
      seconds: finished ? p.took * 60 + (p.state === 'handed_in' ? Math.floor(chance(i + 4900) * 60) : 0) : null,
    }
  })
  .sort((a, b) => b.score - a.score || a.full_name.toLowerCase().localeCompare(b.full_name.toLowerCase()) || a.attempt_id.localeCompare(b.attempt_id))
  .map((row, _i, all) => ({ ...row, rank: all.findIndex((o) => o.score === row.score) + 1 }))
// The list as rpc/exam_registration_list returns it, in the order of the IDs as
// the database tidies them (digits of either script, no spaces or hyphens):
// the 395 held ones, and 17 that no account holds yet.
const idKey = (id) => id.replace(/[٠-٩]/g, (d) => d.charCodeAt(0) - 0x660).replace(/[\s._/\\-]/g, '').toUpperCase()
const freeIds = ['2019-0003', '2019-000123-MEDICINE-EXCHANGE-OUTGOING', ...Array.from({ length: HALL.ids - HALL.held - 2 }, (_, i) => `2025${3001 + i * 11}`)]
const examList = [
  ...people.map((p, i) => ({ id: `reg-${i}`, student_id: p.student_id, created_at: iso(6), claimed_at: iso(1 + chance(i + 5300) * 4), holder: { profile_id: p.profile_id, full_name: p.full_name, email: p.email }, started: i < HALL.papers })),
  ...freeIds.map((student_id, i) => ({ id: `reg-free-${i}`, student_id, created_at: iso(6), claimed_at: null, holder: null, started: false })),
].sort((a, b) => (idKey(a.student_id) < idKey(b.student_id) ? -1 : 1))
// How an exam's questions were answered over `papers` papers, as
// rpc/exam_question_stats counts it. The share that got each right is written
// out; the wrong answers are spread over the other options, the first the most.
const RIGHT_SHARE = [0.91, 0.47, 0.22, 0.63, 0.84, 0.97, 0.71, 0.58, 0.35, 0.12, 0.66, 0.79]
const statsOf = (examId, papers) => ({
  attempts: papers,
  questions: sampleQuestions
    .filter((q) => q.exam_id === examId)
    .map((q, i) => {
      const correct = q.exam_key.correct_option
      const answered = papers - Math.round(papers * (0.02 + 0.08 * chance(i + 5700)))
      const right = Math.min(answered, Math.round(papers * RIGHT_SHARE[i % RIGHT_SHARE.length]))
      const weights = q.options.map((_, o) => (o === correct ? 0 : q.options.length - o))
      const sum = weights.reduce((a, b) => a + b, 0)
      const counts = weights.map((w) => Math.floor(((answered - right) * w) / sum))
      counts[weights.findIndex((w) => w > 0)] += answered - right - counts.reduce((a, b) => a + b, 0)
      counts[correct] = right
      return { question_id: q.id, n: i + 1, body: q.body, options: q.options, correct, answered, right, counts }
    }),
})
// One paper as rpc/exam_sheet returns it, every question in the officers'
// order. Where a paper's right answers begin is its own, so no two look alike.
const sheetOf = (attemptId) => {
  const found = examPapers.find((row) => row.attempt_id === attemptId)
  if (!found) return null
  const { rank, ...attempt } = found
  const questions = sampleQuestions.filter((q) => q.exam_id === 'ex-1')
  const turn = Number(attemptId.slice(3))
  return {
    attempt,
    rows: questions.map((q, i) => {
      const place = (i + turn) % questions.length
      const correct = q.exam_key.correct_option
      const chosen = place < attempt.score ? correct : place < attempt.answered ? (correct + 1) % q.options.length : null
      const answeredAt = chosen === null ? null : new Date(Date.parse(attempt.started_at) + (place + 1) * 4 * 6e4).toISOString()
      return { n: i + 1, question_id: q.id, body: q.body, options: q.options, correct, chosen, flagged: place % 5 === 3 || place === questions.length - 1, answered_at: answeredAt }
    }),
  }
}

// ---- the exam as a student meets it -------------------------------------------
// /exam/<word>. The word chooses the screen: `doors` is what rpc/exam_door
// answers for each, and a word that is not there has no exam. Three more words
// are made elsewhere: at sample-sign-in nobody is signed in and at
// sample-elsewhere another tab holds the exam (both in the page's first
// script, below), and at sample-unreached the database does not answer.
const DROPPED = Symbol('no answer: the request fails, as with no connection')
const takersTitle = 'Exchange exam 2026-27, professional and research exchanges'
const student = { full_name: 'Sample Student With A Rather Long Four Part Name', faculty_year: 'Year 4', phone: '01000000017', student_id: '2023-0417', email: 'a-rather-long-address-for-a-phone@example.com' }
// When a student can start, by where the exam stands.
const startWindow = { before: [at(3, 18), at(3, 20)], open: [minutesAgo(40), minutesAgo(-80)], closed: [minutesAgo(300), minutesAgo(60)] }
const door = (phase, more = {}) => ({
  exam: { title: takersTitle, opens_at: startWindow[phase][0], closes_at: startWindow[phase][1], minutes: 120, questions: 100, phase },
  me: student,
  registration: 'held',
  attempt: null,
  now: new Date().toISOString(),
  ...more,
})
// A paper started twenty minutes before the walk began, with its two hours.
const paperStarted = minutesAgo(20)
const paperDeadline = minutesAgo(-100)
const attemptOf = (word, more = {}) => ({ id: `paper-${word}`, started_at: paperStarted, deadline_at: paperDeadline, submitted_at: null, over: false, ...more })
const doors = {
  // signed in for the first time: Google gave a name, the rest is to fill in
  'sample-details': () => door('open', { me: { ...student, full_name: 'Sample Student', faculty_year: '', phone: '', student_id: '' }, registration: 'none' }),
  // on the list: before the exam opens, while a student can start, after closing
  'sample-waiting': () => door('before'),
  'sample-open': () => door('open'),
  'sample-closed': () => door('closed'),
  // a paper that is running: the paper itself, a hand-in that got no answer,
  // the exam open in another tab, and the moment the clock runs out
  'sample-sitting': () => door('open', { attempt: attemptOf('sample-sitting') }),
  'sample-hand-in': () => door('open', { attempt: attemptOf('sample-hand-in') }),
  'sample-elsewhere': () => door('open', { attempt: attemptOf('sample-elsewhere') }),
  'sample-time-up': () => door('closed', { attempt: attemptOf('sample-time-up') }),
  // a paper that is over: handed in, or out of time
  'sample-received': () => door('closed', { attempt: attemptOf('sample-received', { submitted_at: minutesAgo(4), over: true }) }),
  'sample-timed-out': () => door('closed', { attempt: attemptOf('sample-timed-out', { started_at: minutesAgo(125), deadline_at: minutesAgo(5), over: true }) }),
}
// rpc/exam_paper. A hundred questions in "this student's order" (the dozen
// above, round and round), 34 of them reached: most answered, a few skipped, a
// few flagged. At sample-time-up the clock has just run out.
const paperOf = (word) => {
  if (word === 'sample-received') return { state: 'over', submitted: true }
  if (word === 'sample-timed-out') return { state: 'over', submitted: false }
  const questions = Array.from({ length: 100 }, (_, i) => {
    const q = examQuestions[i % examQuestions.length]
    return { id: `pq-${i + 1}`, body: q.body, options: q.options }
  })
  const now = new Date().toISOString()
  return {
    state: 'sitting',
    exam: { title: takersTitle, minutes: 120 },
    attempt: { id: `paper-${word}`, started_at: paperStarted, deadline_at: word === 'sample-time-up' ? now : paperDeadline },
    now,
    questions,
    answers: questions
      .slice(0, 34)
      .map((q, i) => ({ q: q.id, c: i % 9 === 4 ? null : i % q.options.length, f: i % 7 === 2 || i === 4 }))
      .filter((a) => a.c !== null || a.f),
  }
}
const rpcs = {
  gallery_public: {
    albums: [
      galleryAlbum('al-1', 'national-general-assembly-aswan-2026', 'National General Assembly, Aswan 2026', 'Three days in Aswan.', null, 6),
      galleryAlbum('al-2', 'orientation-day', 'Orientation day', '', null, 3),
      galleryAlbum('al-4', 'winter-camp-2026', 'Winter camp 2026, with a title long enough to wrap on a phone', 'Snow, almost.', '2025-26', 5),
      galleryAlbum('al-5', 'orientation-25-26', 'Orientation 25-26', '', '2025-26', 2),
      galleryAlbum('al-6', 'first-nga-2024', 'First NGA 2024', '', '2024-25', 4),
    ],
    generated_at: new Date().toISOString(),
  },
  rollover_preview: {
    current: { id: 't1', label: '2026-27', starts_on: '2026-09-01', ends_on: '2027-08-31' },
    next: { id: null, label: '2027-28', starts_on: '2027-09-01', ends_on: '2028-08-31' },
    work_accounts: [
      { position_id: 'p1', title: 'Webmaster', level: 'webmaster', committee: null, email: 'webmaster@example.com', has_account: true, holds_now: true },
      { position_id: 'p2', title: 'President', level: 'eb', committee: null, email: 'president@example.com', has_account: true, holds_now: true },
      { position_id: 'p3', title: 'Vice President for External Affairs', level: 'eb', committee: null, email: 'a-rather-long-work-address-for-a-phone@example.com', has_account: false, holds_now: false },
      { position_id: 'p4', title: 'Local Exchange Officer for Incomings', level: 'officer', committee: 'SCOPE', email: 'leoin@example.com', has_account: true, holds_now: true },
      { position_id: 'p5', title: 'Local Officer on SRHR & HIV/AIDS', level: 'officer', committee: 'SCORA', email: null, has_account: false, holds_now: false },
    ],
    roster_positions: 42,
    ending: [{ title: 'Assistant', committee: 'SCOPE', name: 'Sample Member With A Rather Long Four Part Name' }],
    open_tasks: 2,
    albums: [
      { id: 'al-1', title: 'National General Assembly, Aswan 2026', slug: 'national-general-assembly-aswan-2026', published: true, photos: 6 },
      { id: 'al-2', title: 'Orientation day', slug: 'orientation-day', published: true, photos: 3 },
      { id: 'al-3', title: 'World Diabetes Day campaign', slug: 'world-diabetes-day-campaign', published: false, photos: 0 },
    ],
    storage_bytes: 58931200,
    // this term's exams, with what the rollover deletes of each
    exams: sampleExams.filter((e) => e.term_id === 't1').map((e) => ({ id: e.id, title: e.title, registrations: e.exam_registrations[0].count, attempts: e.exam_attempts[0].count })),
  },
  events_public: {
    events: sampleEvents
      .filter((e) => e.published)
      .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
      .map(({ committee, committee_id, published, created_at, ...e }) => ({
        ...e,
        committee: committee?.slug ?? null,
        over_at: overOf(e),
        term: termOf(e.starts_at),
        aliases: e.id === 'ev-1' ? ['world-health-day-2026'] : [],
      })),
    generated_at: new Date().toISOString(),
  },
  directory: [
    { id: uid, full_name: 'Sample Webmaster', avatar_url: null, membership_status: 'active', positions: [{ title: 'Webmaster', committee: null, level: 'webmaster' }] },
    { id: other, full_name: 'Sample Officer With A Long Name', avatar_url: null, membership_status: 'active', positions: [{ title: 'Local Exchange Officer for Incomings', committee: 'SCOPE', level: 'officer' }] },
    { id: 'x3', full_name: 'Third Person', avatar_url: null, membership_status: 'candidate', positions: [] },
  ],
  profile_names: [
    { id: uid, full_name: 'Sample Webmaster', avatar_url: null },
    { id: other, full_name: 'Sample Officer', avatar_url: null },
  ],
  // The exam for its officers. Only ex-1 has a list and papers.
  exam_registration_list: ({ p_exam }) => (p_exam === 'ex-1' ? examList : []),
  exam_results: ({ p_exam }) => ({
    questions: sampleQuestions.filter((q) => q.exam_id === p_exam).length,
    now: new Date().toISOString(),
    attempts: p_exam === 'ex-1' ? examPapers : [],
  }),
  exam_question_stats: ({ p_exam }) => statsOf(p_exam, p_exam === 'ex-1' ? HALL.papers : 0),
  exam_sheet: ({ p_attempt }) => sheetOf(p_attempt),
  // The exam for a student, by the word in the address.
  exam_door: ({ p_word }) => (p_word === 'sample-unreached' ? DROPPED : doors[p_word]?.() ?? { exam: null }),
  exam_paper: ({ p_word }) => paperOf(p_word),
  // Every save lands, except where the walk shows what a lost one looks like.
  exam_save: ({ p_word, p_answers }) =>
    p_word === 'sample-hand-in' || p_word === 'sample-time-up'
      ? DROPPED
      : { state: 'sitting', submitted: false, saved: Array.isArray(p_answers) ? p_answers.length : 0, deadline_at: paperDeadline, now: new Date().toISOString() },
  // The ID typed is never on the list, and the code typed is never the code.
  exam_save_details: (sent) => ({ registration: 'not_listed', me: { full_name: sent.p_full_name, faculty_year: sent.p_faculty_year, phone: sent.p_phone, student_id: sent.p_student_id, email: student.email } }),
  exam_start: () => ({ ok: false, reason: 'code', tries_left: 7 }),
}

const ROUTES = [
  '/portal', '/portal/profile', '/portal/verify', '/portal/tasks', '/portal/tasks/t-1', '/portal/updates',
  '/portal/notifications', '/portal/directory', '/portal/committees', '/portal/committees/scope',
  '/portal/gallery', '/portal/magazine', '/portal/submissions?tab=orders', '/portal/submissions?tab=stories',
  '/portal/submissions?tab=signups', '/portal/admin/settings', '/portal/admin/roster', '/portal/admin/verification', '/portal/admin/rollover',
  '/portal/merch', '/portal/merch/notebook', '/portal/merch/a-new-product-with-a-long-id-for-phones',
  '/portal/events', '/portal/events/ev-1', '/portal/events/ev-3', '/portal/events/ev-6',
  // the public pages that show events, from the same sample
  '/events', '/events/archive', '/events/world-health-day-stand-2026', '/events/spring-school-on-research-methods-2026',
  '/events/national-general-assembly-aswan-2025', '/', '/committees/scoph',
  // the gallery and its archive
  '/gallery', '/gallery/archive', '/gallery/winter-camp-2026',
  '/portal/content', '/portal/content/join.faq', '/portal/content/exchange.incomings', '/portal/content/site.contact', '/portal/content/home.page', '/portal/content/ifmsa.page', '/portal/admin/audit',
  // the audit log with its first entry open: an exam ID released from its account
  '/portal/admin/audit#released',
  // the exchange exam on the portal: the list, the exam being sat in its five
  // parts, a question's right answer being corrected, and one student's paper
  '/portal/exam', '/portal/exam/ex-1?tab=setup', '/portal/exam/ex-1?tab=questions', '/portal/exam/ex-1?tab=questions#correct',
  '/portal/exam/ex-1?tab=list', '/portal/exam/ex-1?tab=results', '/portal/exam/ex-1?tab=results&paper=at-005', '/portal/exam/ex-1?tab=overview',
  // the draft, where every form is open, and last term's, with nothing left to read
  '/portal/exam/ex-2?tab=setup', '/portal/exam/ex-2?tab=questions', '/portal/exam/ex-2?tab=questions#edit', '/portal/exam/ex-2?tab=list',
  '/portal/exam/ex-0?tab=results', '/portal/exam/ex-0?tab=overview',
  // the exam as a student meets it, in the order of a sitting
  '/exam/sample-sign-in', '/exam/callback?error=access_denied', '/exam/sample-none', '/exam/sample-unreached',
  '/exam/sample-details', '/exam/sample-details#not-listed', '/exam/sample-waiting', '/exam/sample-open', '/exam/sample-open#wrong-code', '/exam/sample-closed',
  '/exam/sample-sitting', '/exam/sample-sitting#review', '/exam/sample-hand-in#review', '/exam/sample-elsewhere',
  '/exam/sample-time-up', '/exam/sample-received', '/exam/sample-timed-out',
].filter((r) => !only || r.startsWith(only))

// What the walk does on a route before it measures, for the screens that only
// show after a tap.
const acts = {
  '/portal/admin/audit#released': (page) => page.locator('details > summary').first().click(),
  '/portal/exam/ex-1?tab=questions#correct': (page) => page.getByRole('button', { name: 'Correct the answer to question 3', exact: true }).click(),
  '/portal/exam/ex-2?tab=questions#edit': (page) => page.getByRole('button', { name: 'Edit question 2', exact: true }).click(),
  '/exam/sample-details#not-listed': async (page) => {
    await page.selectOption('#exam-year', 'Year 4')
    await page.fill('#exam-phone', '01000000017')
    await page.fill('#exam-student-id', '2023-0471')
    await page.getByRole('button', { name: 'Save and check my ID' }).click()
  },
  '/exam/sample-open#wrong-code': async (page) => {
    await page.fill('#exam-start-code', 'k7qm4y')
    await page.getByRole('button', { name: 'Start the exam' }).click()
  },
  // "Hand in" asks twice, and two taps too close together count as one slip.
  // Back at the top afterwards, where the bar that stays in view belongs in
  // a picture of the whole page.
  '/exam/sample-hand-in#review': async (page) => {
    await page.getByRole('button', { name: 'Hand in', exact: true }).click()
    await page.waitForTimeout(600)
    await page.getByRole('button', { name: 'Hand in for good', exact: true }).click()
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  },
}

function measureOverflow() {
  const doc = document.documentElement
  const vw = doc.clientWidth
  const by = Math.max(doc.scrollWidth, document.body.scrollWidth) - vw
  if (by <= 1) return null
  const clipped = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      if (getComputedStyle(p).overflowX === 'visible') continue
      if (p.getBoundingClientRect().right <= vw + 1) return true
    }
    return false
  }
  const hits = []
  for (const el of document.body.querySelectorAll('*')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0 || r.right <= vw + 1) continue
    if (getComputedStyle(el).position === 'fixed' || clipped(el)) continue
    hits.push(el)
  }
  const inner = hits.filter((el) => !hits.some((o) => o !== el && el.contains(o)))
  return { by: Math.round(by), who: inner.slice(0, 4).map((el) => `${el.tagName.toLowerCase()}.${String(el.className?.baseVal ?? el.className).slice(0, 70)} "${(el.textContent || '').trim().slice(0, 30)}"`) }
}

const require = createRequire(import.meta.url)
const axe = await fs.readFile(require.resolve('axe-core/axe.min.js'), 'utf8')
const browser = await chromium.launch()
const findings = { overflow: [], cutoff: [], contrast: new Map(), errors: new Map() }
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

for (const theme of themes) {
  for (const width of widths) {
    const context = await browser.newContext({ viewport: { width, height: width < 700 ? 800 : 900 }, colorScheme: theme, reducedMotion: 'reduce' })
    await context.addInitScript(
      ([t, key, s, lock]) => {
        localStorage.setItem('theme', t)
        // Signed in everywhere but on the exam's sign-in card.
        if (location.pathname === '/exam/sample-sign-in') localStorage.removeItem(key)
        else localStorage.setItem(key, s)
        // "Another tab" has the exam open: the page takes the sitting's lock
        // (LOCK_NAME in src/exam/useSitting.js) before the exam asks for it.
        if (location.pathname === '/exam/sample-elsewhere') navigator.locks?.request(lock, () => new Promise(() => {}))
      },
      [theme, `sb-${REF}-auth-token`, JSON.stringify(session), `ausss-exam-tab:sample-elsewhere:${uid}`],
    )
    await context.route(/^https:\/\/[a-z0-9]+\.supabase\.co\//, async (route) => {
      const req = route.request()
      const url = new URL(req.url())
      const json = (body, headers = {}) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', ...headers }, body: JSON.stringify(body) })
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } })
      if (url.pathname.startsWith('/auth/v1/')) return json(url.pathname.endsWith('/user') ? user : session)
      // Gallery photos: a picture from the repo stands in for each file.
      if (url.pathname.startsWith('/storage/v1/object/public/gallery/')) {
        return route.fulfill({ status: 200, contentType: 'image/jpeg', path: 'public/assets/exchange/incomings/campus.jpg' })
      }
      if (url.pathname.startsWith('/storage/v1/')) return json([])
      const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z0-9_]+)$/)?.[1]
      if (rpc) {
        let sent = {}
        try {
          sent = req.postDataJSON() || {}
        } catch {
          // No body, or not JSON: the function is asked with nothing.
        }
        const answer = typeof rpcs[rpc] === 'function' ? rpcs[rpc](sent) : rpcs[rpc]
        return answer === DROPPED ? route.abort('connectionfailed') : json(answer ?? [])
      }
      const table = url.pathname.match(/^\/rest\/v1\/([a-z0-9_]+)$/)?.[1]
      if (req.method() !== 'GET' && req.method() !== 'HEAD') return json(null)
      // Public tables are read for real, as an anonymous visitor.
      if (table === 'committees' || table === 'site_settings') {
        const headers = { ...req.headers(), authorization: `Bearer ${req.headers().apikey}` }
        return route.continue({ headers })
      }
      let rows = tables[table] || []
      const idEq = url.searchParams.get('id')?.match(/^eq\.(.+)$/)?.[1]
      if (idEq) rows = rows.filter((r) => r.id === idEq)
      const keyEq = url.searchParams.get('key')?.match(/^eq\.(.+)$/)?.[1]
      if (keyEq) rows = rows.filter((r) => r.key === keyEq)
      const examEq = url.searchParams.get('exam_id')?.match(/^eq\.(.+)$/)?.[1]
      if (examEq) rows = rows.filter((r) => r.exam_id === examEq)
      if (req.method() === 'HEAD') return route.fulfill({ status: 200, headers: { 'content-range': `*/${table === 'notifications' ? 1 : rows.length}`, 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' } })
      if ((req.headers().accept || '').includes('vnd.pgrst.object')) return json(rows[0] ?? {})
      return json(rows, { 'content-range': `0-${Math.max(0, rows.length - 1)}/${rows.length}` })
    })

    const dir = path.join('.page-walk', `portal-sample-${stamp}`, `${theme}-${width}`)
    await fs.mkdir(dir, { recursive: true })
    for (const r of ROUTES) {
      const page = await context.newPage()
      const errs = []
      page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]))
      try {
        await page.goto(base + r, { waitUntil: 'networkidle', timeout: 30000 })
        await page.waitForTimeout(500)
        const landed = new URL(page.url()).pathname
        if (!landed.startsWith(r.split(/[?#]/)[0])) errs.push(`landed on ${landed}`)
        if (acts[r]) {
          await acts[r](page)
          await page.waitForTimeout(700)
        }
        const over = await page.evaluate(measureOverflow)
        if (over) findings.overflow.push({ theme, width, route: r, ...over })
        const cut = await page.evaluate(measureCutOff)
        if (cut) findings.cutoff.push({ theme, width, route: r, cut })
        await page.evaluate(`${axe}; null`)
        const low = await page.evaluate(async () => {
          const res = await window.axe.run(document, { runOnly: ['color-contrast'], resultTypes: ['violations'] })
          return res.violations.flatMap((v) => v.nodes.map((n) => ({ ...(n.any[0]?.data || {}), text: n.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) })))
        })
        for (const c of low) {
          const key = `${theme} ${c.fgColor} on ${c.bgColor} = ${c.contrastRatio}`
          const hit = findings.contrast.get(key) || { routes: new Set(), text: c.text }
          hit.routes.add(r)
          findings.contrast.set(key, hit)
        }
        await page.screenshot({ path: path.join(dir, `${r.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}.png`), fullPage: true })
      } catch (e) {
        errs.push(`walk: ${e.message.split('\n')[0]}`)
      }
      for (const e of errs) {
        const hit = findings.errors.get(e) || new Set()
        hit.add(r)
        findings.errors.set(e, hit)
      }
      await page.close()
    }
    await context.close()
    console.log(`portal sample walk: ${theme} ${width}px done`)
  }
}
await browser.close()

console.log(`\nsideways scrolling: ${findings.overflow.length}`)
for (const o of findings.overflow) console.log(`  ${o.theme} ${o.width}px ${o.route}: ${o.by}px, ${o.who.join(' | ')}`)
console.log(`\ncut off at the screen's edge (fixed bars): ${findings.cutoff.length}`)
for (const o of findings.cutoff) console.log(`  ${o.theme} ${o.width}px ${o.route}: ${o.cut.map((c) => `${c.el.slice(0, 60)} "${c.text}" (${c.left} to ${c.right})`).join(' | ').slice(0, 240)}`)
console.log(`\nlow-contrast pairs: ${findings.contrast.size}`)
for (const [k, v] of findings.contrast) console.log(`  ${k}  (${[...v.routes].slice(0, 3).join(', ')})  "${v.text}"`)
console.log(`\npage errors: ${findings.errors.size}`)
for (const [k, v] of findings.errors) console.log(`  ${k}  (${[...v].slice(0, 4).join(', ')})`)
console.log(`\nscreenshots in .page-walk/portal-sample-${stamp}`)
