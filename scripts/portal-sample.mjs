// The made-up portal: a session nobody has to sign in for, sample rows for
// every page, and the answers to every Supabase call a page makes. Two scripts
// open the site with it: the portal sample walk (scripts/portal-sample-walk.mjs),
// which measures every screen, and the website guide's screenshots
// (scripts/guide/shots.mjs), which must show no real person.
//
// Nothing a page does with it reaches production: every Supabase call is
// answered here, except anonymous reads of the public committees and settings
// tables.
//
// The sample rows below follow the columns the portal selects. When a page
// gains a query, give it a row here or the page shows its empty state. An
// entry of `rpcs` is the function's answer, or a function of what the page
// sent when the answer depends on it (which exam, which paper, which word).
// A read that narrows its rows (status=eq.new, album_id=eq.al-1) gets the rows
// that fit, so a row has to carry the column it is asked by. The committees
// are the real ones, and each reaches the page under the id c-<its slug>:
// that is the id a sample row names its committee by.
//
// The exchange exam is in it from both sides: the portal's Exam pages
// (/portal/exam), and the pages students sit it on (/exam/<word>), which are no
// part of the portal. There the word in the address chooses what the student
// meets, from the sign-in card to "Your exam was received." (see `doors`).
//
// A few screens only show after a tap (a question's form, a wrong start code,
// a hand-in that got no answer, a panel of the roster): `acts` holds what to
// do on those routes once the page has loaded. The part after # in a route
// names such a screen and means nothing to the page, except on the paper,
// where #review is its last step.
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
const scoph = { id: 'c-scoph', slug: 'scoph', abbr: 'SCOPH', name: 'Public Health', color: '#1b9e4b' }
const scora = { id: 'c-scora', slug: 'scora', abbr: 'SCORA', name: 'Sexual & Reproductive Health and Rights incl. HIV & AIDS', color: '#d1477a' }
// Made-up first names and family names, for the lists that are too long to
// write out (the roster, the exam's hall).
const GIVEN = ['Amal', 'Basil', 'Dalia', 'Emad', 'Farah', 'Gamal', 'Hana', 'Idris', 'Jana', 'Kamal', 'Laila', 'Mona', 'Nabil', 'Omar', 'Rana', 'Sami', 'Tala', 'Wael', 'Yara', 'Zein']
const FAMILY = ['Sample', 'Example', 'Specimen', 'Placeholder', 'Template', 'Stand-In', 'Mockup']
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

// ---- positions and the roster ---------------------------------------------------
// The positions SCOPE and SCORE hand out (the two share one members list, and
// SCOPE is its home), SCOPH's two, and the society's own: the board's and the
// webmaster's. In the order the pages list them. One is retired, one has a
// title long enough to wrap, and p1 to p4 are the ones the assignment and the
// rollover's work accounts name.
const position = (id, key, committee_id, level, title, short_title, more = {}) => ({ id, key, committee_id, title, short_title, level, sort: 10, active: true, can_assign_tasks: level !== 'member', ...more })
const samplePositions = [
  position('p4', 'scope.officer-incomings', 'c-scope', 'officer', 'Local Exchange Officer for Incomings', 'LEO-In'),
  position('p-leo-out', 'scope.officer-outgoings', 'c-scope', 'officer', 'Local Exchange Officer for Outgoings', 'LEO-Out'),
  position('p-lore', 'score.officer', 'c-score', 'officer', 'Local Officer on Research Exchange', 'LORE'),
  position('p-scope-assistant', 'scope.assistant', 'c-scope', 'assistant', 'Exchange Incomings Assistant', 'Assistant'),
  position('p-scope-social', 'scope.social', 'c-scope', 'assistant', 'Social Programme and Airport Pick-up Coordinator', ''),
  position('p-scope-member', 'scope.member', 'c-scope', 'member', 'Contact Person', 'CP'),
  position('p-scope-core', 'scope.core', 'c-scope', 'member', 'Core Team Member', 'Core'),
  position('p-scope-old', 'scope.buddy', 'c-scope', 'member', 'A retired position with a rather long title, kept to show how one wraps', '', { active: false }),
  position('p-scoph-officer', 'scoph.officer', 'c-scoph', 'officer', 'Local Public Health Officer', 'LPO'),
  position('p-scoph-member', 'scoph.member', 'c-scoph', 'member', 'Local Member', 'Member'),
  position('p2', 'eb.president', null, 'eb', 'President', 'President'),
  position('p3', 'society.vpe', null, 'eb', 'Vice President for External Affairs', 'VPE'),
  position('p-president-assistant', 'society.president-assistant', null, 'assistant', 'Assistant to the President', ''),
  position('p1', 'society.webmaster', null, 'webmaster', 'Webmaster', 'Webmaster'),
]
const positionOf = (id) => {
  const { key, title, level } = samplePositions.find((p) => p.id === id)
  return { id, key, title, level }
}
// The roster: six members written out (a long name, one with no committee,
// one the portal owns, one whose name, address and position are all long,
// one on the board, one the President dismissed), and enough made ones for a
// second page, since the list shows fifty at a time. Every third made member
// has signed in and every ninth has no email on file.
const member = (id, full_name, email, status, more = {}) => ({ id, full_name, email, status, joined_year: 2024, years_spent: 2, lgas: 2, ngas: 0, current_position: '', origin: 'sheet', portal_edited_at: null, profile_id: null, import_batch: 'b1', updated_at: iso(1), committee_id: null, is_contact_person: false, position_id: null, dismissed_at: null, dismissal_reason: null, status_before_dismissal: null, ...more })
const sampleRoster = [
  member('r-1', 'Sample Member With A Rather Long Four Part Name', 'member1@example.com', 'Full Member', { joined_year: 2023, years_spent: 3, lgas: 4, ngas: 1, current_position: 'Exchange Incomings Assistant', profile_id: 'pr-1', committee_id: 'c-scope', is_contact_person: true, position_id: 'p-scope-assistant' }),
  member('r-2', 'Second Sample', 'member2@example.com', 'Candidate Member', { joined_year: 2025, years_spent: 1, lgas: 1 }),
  member('r-3', 'Third Sample', 'member3@example.com', 'Associate Member', { current_position: 'Local Member', origin: 'portal', portal_edited_at: iso(2), import_batch: null, updated_at: iso(2), committee_id: 'c-scope', position_id: 'p-scope-member' }),
  member('r-4', 'Fourth Sample Whose Name Runs On For A Good Many Words', 'a-rather-long-address-for-a-phone@example.com', 'Associate Member', { lgas: 3, ngas: 1, committee_id: 'c-scope', position_id: 'p-scope-social' }),
  member('r-5', 'Fifth Sample', 'member5@example.com', 'Full Member', { joined_year: 2022, years_spent: 4, lgas: 6, ngas: 2, profile_id: 'pr-5', position_id: 'p3' }),
  // A dismissed member: the record stays, with no committee and no position,
  // and a reason long enough to wrap and to hold an address that cannot. The
  // page lists the roster in name order, and this name is on its first page.
  member('r-0', 'Eighth Sample Whose Membership The President Ended', 'member0@example.com', 'Dismissed', { joined_year: 2023, years_spent: 3, lgas: 2, ngas: 1, profile_id: 'pr-0', portal_edited_at: iso(3), updated_at: iso(3), dismissed_at: iso(3), dismissal_reason: 'A made-up reason, written at some length so that it wraps on a phone, with the minutes of the meeting that decided it: https://example.org/minutes/executive-board/2026-27/an-address-with-no-space-to-wrap-at', status_before_dismissal: 'Associate Member' }),
  ...Array.from({ length: 56 }, (_, i) => {
    const committee_id = [null, 'c-scope', 'c-scoph', 'c-scope'][i % 4]
    return member(`r-${i + 6}`, `${GIVEN[i % GIVEN.length]} ${GIVEN[(i * 7 + 3) % GIVEN.length]} ${FAMILY[i % FAMILY.length]}`, i % 9 === 4 ? null : `member${i + 6}@example.com`, ['Candidate Member', 'Associate Member', 'Full Member'][i % 3], {
      joined_year: 2022 + (i % 4),
      years_spent: 4 - (i % 4),
      lgas: i % 5,
      ngas: i % 3,
      profile_id: i % 3 === 0 ? `pr-${i + 6}` : null,
      committee_id,
      is_contact_person: i % 11 === 1,
      position_id: committee_id === 'c-scoph' ? 'p-scoph-member' : committee_id ? (i % 8 === 3 ? 'p-scope-core' : 'p-scope-member') : null,
    })
  }),
]
// rpc/roster_upgrade_candidates: the first few members whose GA counts reach
// the next status, which only the board grants.
const upgradeCandidates = sampleRoster
  .filter((r) => r.status !== 'Full Member' && !r.dismissed_at)
  .slice(0, 5)
  .map(({ id, full_name, email, status, lgas, ngas }) => ({ id, full_name, email, status, next: status === 'Candidate Member' ? 'Associate Member' : 'Full Member', lgas, ngas }))

// ---- a committee's own pages ----------------------------------------------------
// What SCOPE's officers see on /portal/committees/scope. rpc/committee_roster
// is the roster's rows for the committee, each with the position it gives
// (`position`), every position the member holds there (`positions`) and how
// many notes the officers keep on them.
const committeeMembers = sampleRoster
  .filter((r) => r.committee_id === 'c-scope')
  .slice(0, 10)
  .map(({ origin, portal_edited_at, import_batch, updated_at, position_id, ...r }, i) => {
    const held = position_id ? positionOf(position_id) : null
    return { ...r, status: i === 3 ? 'active' : r.status, position: held, positions: held && r.profile_id ? [held] : [], invited: [], notes: r.id === 'r-1' ? 2 : 0 }
  })
// rpc/committee_positions, for a committee and for the society (the board and
// the webmaster): who holds a position now, and the offers that wait for a
// first sign-in. `from_roster` marks what the members list gave.
const holder = (assignment_id, profile_id, full_name, email, position_id, more = {}) => ({ assignment_id, profile_id, full_name, email, avatar_url: null, position: positionOf(position_id), from_roster: false, can_remove: true, ...more })
const invite = (id, email, position_id, daysAgo, more = {}) => ({ id, email, invited_by: 'Sample Webmaster', created_at: iso(daysAgo), position: positionOf(position_id), from_roster: false, can_withdraw: true, ...more })
const heldIn = {
  committee: {
    holders: [
      holder('as-1', other, 'Sample Officer With A Long Name', 'leoin@example.com', 'p4'),
      holder('as-2', 'pr-1', 'Sample Member With A Rather Long Four Part Name', 'member1@example.com', 'p-scope-assistant', { from_roster: true, can_remove: false }),
      holder('as-3', 'pr-1', 'Sample Member With A Rather Long Four Part Name', 'member1@example.com', 'p-scope-social'),
      holder('as-4', 'pr-9', null, 'no-name-yet@example.com', 'p-scope-core'),
    ],
    invites: [
      invite('in-1', 'someone.new.with.a.rather.long.address@students.example.edu.eg', 'p-scope-social', 2),
      invite('in-2', 'lore@example.com', 'p-lore', 6, { invited_by: null }),
      invite('in-3', 'member3@example.com', 'p-scope-member', 9, { from_roster: true, can_withdraw: false }),
      invite('in-4', 'a-rather-long-address-for-a-phone@example.com', 'p-scope-social', 9, { from_roster: true, can_withdraw: false }),
    ],
  },
  society: {
    holders: [
      holder('as-5', uid, 'Sample Webmaster', 'webmaster@example.com', 'p1'),
      // the President's position stays with its work email: the database offers no Remove on it
      holder('as-6', 'pr-2', 'Sample President', 'president@example.com', 'p2', { can_remove: false }),
      holder('as-7', 'pr-5', 'Fifth Sample', 'member5@example.com', 'p3', { from_roster: true, can_remove: false }),
    ],
    invites: [invite('in-5', 'a-rather-long-work-address-for-a-phone@example.com', 'p3', 4)],
  },
}
// Open Calls: one open with applications, one whose last day has passed, a
// draft, and one its officers closed.
const call = (id, status, title, more = {}) => ({ id, committee_id: 'c-scope', status, title, kind: 'Small Working Group', summary: '', description: '', commitment: '', deadline: null, notify_email: null, positions: [], questions: [], created_by: uid, created_at: iso(3), updated_at: iso(1), applications: [{ count: 0 }], ...more })
const sampleCalls = [
  call('call-1', 'open', 'Contact persons for the August incomings, with a title long enough to wrap on a phone', {
    summary: 'Meet an incoming student at the airport, then show them the hospital and the city.',
    description: 'Every incoming student is given a contact person for the month.\n\nYou meet them on the day they land, take them to the dormitory and are the first person they ask.',
    commitment: 'About four hours a week through August',
    deadline: day(9),
    notify_email: 'leoin@example.com',
    positions: [
      { id: 'p0', title: 'Coordinator', blurb: 'Keeps the rota and the group chat', slots: '1 place' },
      { id: 'p1', title: 'Contact person', blurb: '', slots: '12 places' },
    ],
    questions: [
      { id: 'q0', label: 'Which weeks of August are you in Cairo?', type: 'select', options: ['All of them', 'The first two', 'The last two'], required: true },
      { id: 'q1', label: 'Which languages do you speak well enough to explain a ward round in?', type: 'short', options: [], required: false },
    ],
    applications: [{ count: 3 }],
  }),
  call('call-2', 'open', 'Welcome booklet team', { kind: 'Campaign', deadline: day(-4), created_at: iso(30), updated_at: iso(20) }),
  call('call-3', 'draft', 'Pre-departure training for the outgoings', { kind: 'Training', summary: 'Two evenings before the summer.', created_at: iso(1) }),
  call('call-4', 'closed', 'Social programme volunteers', { deadline: day(20), created_at: iso(40), updated_at: iso(12), applications: [{ count: 14 }] }),
]
const application = (id, status, name, email, more = {}) => ({ id, ref: `AP-${id.slice(3).padStart(4, '0')}`, call_id: 'call-1', committee_id: 'c-scope', call_title: sampleCalls[0].title, name, email, phone: '', year: '', positions: [], motivation: '', answers: [], status, notes: '', created_at: iso(1), ...more })
const sampleApplications = [
  application('ap-1', 'new', 'First Applicant With A Rather Long Four Part Name', 'a.very.long.address.for.a.phone@students.example.edu.eg', {
    phone: '01000000021',
    year: 'Year 3',
    positions: ['Coordinator', 'Contact person'],
    motivation: 'I was a contact person last August and would like to run the rota this year.\n\nMy notes from then are here: https://example.org/exchange/incomings/contact-persons/handover-notes-august-2025-final-version',
    answers: [
      { id: 'q0', label: 'Which weeks of August are you in Cairo?', value: 'All of them' },
      { id: 'q1', label: 'Which languages do you speak well enough to explain a ward round in?', value: 'English and French' },
    ],
  }),
  application('ap-2', 'shortlisted', 'Second Applicant', 'applicant2@example.com', { positions: ['Contact person'], motivation: 'I would like to help.', notes: 'Met at orientation. Speaks German.', created_at: iso(2) }),
  application('ap-3', 'declined', 'Third Applicant', 'applicant3@example.com', { year: 'Year 1', created_at: iso(2.5) }),
  // What two removed calls left behind: an application keeps its committee
  // and the title its call had, and no call. One title is long enough to wrap.
  application('ap-4', 'accepted', 'Fourth Applicant', 'applicant4@example.com', { call_id: null, call_title: 'Welcome week buddies', year: 'Year 2', motivation: 'I would like to show the new students round.', notes: 'Starts on the first Sunday.', created_at: iso(40) }),
  application('ap-5', 'new', 'Fifth Applicant With A Rather Long Four Part Name', 'a.very.long.address.for.a.phone@students.example.edu.eg', { call_id: null, call_title: 'Welcome week buddies', positions: ['Buddy'], motivation: 'I was shown round by a buddy last year and want to do the same.', created_at: iso(42) }),
  application('ap-6', 'shortlisted', 'Sixth Applicant', 'applicant6@example.com', { call_id: null, call_title: 'Translators for the exchange conditions booklet, Arabic to English and back, summer 2026', motivation: 'I translate for the faculty magazine.', created_at: iso(90) }),
]

// ---- the gallery and the magazine -----------------------------------------------
// The photos of three albums as the editor reads them: in the first one a
// banner photo with a label, one hidden from visitors and two in the bin
// (emptied by itself after thirty days, so neither is old enough to go).
const photo = (album, i, more = {}) => ({ id: `${album}-ph${i}`, album_id: album, path: `${album}/ph${i}`, width: 1600, height: 1067, sort_order: i, label: '', featured: false, hidden: false, deleted_at: null, created_at: iso(10 - i * 0.01), ...more })
const samplePhotos = [
  photo('al-1', 0, { featured: true, label: 'Day one, on the corniche before the opening plenary' }),
  photo('al-1', 1),
  photo('al-1', 2, { hidden: true }),
  photo('al-1', 3, { label: 'The delegation' }),
  photo('al-1', 4),
  photo('al-1', 5),
  photo('al-1', 6, { deleted_at: iso(3) }),
  photo('al-1', 7, { deleted_at: iso(1) }),
  photo('al-2', 0),
  photo('al-2', 1),
  photo('al-2', 2),
  photo('al-4', 0),
]
// The magazine's shelf: an edition whose pages were uploaded from the portal
// (they are in the `magazine` bucket, in the folder of that upload), one built
// into the site, one whose copy is missing and a draft with a Canva link.
const BUCKETS = `https://${REF}.supabase.co/storage/v1/object/public`
const pagesFolder = (daysAgo) => `pages-${Date.now() - daysAgo * 864e5}`
const edition = (id, slug, status, title, more = {}) => ({ id, slug, title, switcher_label: '', date_label: '', blurb: '', status, sort_order: 0, pages_base: '', page_count: 0, hero_page: 1, download_url: '', canva_url: '', created_at: iso(30), updated_at: iso(10), ...more })
// What the bucket holds under an edition: the folder its pages are read from,
// and the one an upload replaced nine days ago. A folder goes a week after the
// later of the two began, so both are kept.
const magazineFolders = { 'mg-1': [pagesFolder(2), pagesFolder(9)] }
const sampleIssues = [
  edition('mg-1', 'vol-9', 'published', 'Autumn', { switcher_label: 'Autumn, Vol. 9', date_label: 'Volume 9 · A CBSD production', blurb: 'The ninth volume: exchange stories, a guide to the first clinical year and the term in pictures.', pages_base: `${BUCKETS}/magazine/mg-1/${magazineFolders['mg-1'][0]}`, page_count: 12, download_url: 'https://drive.google.com/file/d/sample/view' }),
  edition('mg-2', 'vol-8', 'published', 'The Story of Origin, a title long enough to wrap on a phone, Vol. 8', { sort_order: 1, pages_base: '/assets/magazine/vol-7/pages', page_count: 23, hero_page: 2, created_at: iso(200), updated_at: iso(100) }),
  edition('mg-3', 'vol-4', 'missing', 'Volume 4', { sort_order: 2, created_at: iso(300), updated_at: iso(300) }),
  edition('mg-4', 'winter-draft', 'draft', 'Winter', { sort_order: 3, canva_url: 'https://www.canva.com/design/sample/view', created_at: iso(3), updated_at: iso(1) }),
]
// rpc/magazine_insights: the readers of an edition, fewer on every page.
const insightsOf = (slug) => {
  const pages = sampleIssues.find((m) => m.slug === slug)?.page_count || 0
  const reach = Array.from({ length: pages }, (_, i) => ({ page: i + 1, readers: Math.round(80 * 0.9 ** i) }))
  return { views: 412, likes: 38, downloads: 21, sessions: 90, tracked: pages ? 80 : 0, finished: reach.at(-1)?.readers ?? 0, median_page: Math.ceil(pages / 3), reach }
}

// The walk is the webmaster, who may not dismiss or reinstate a member. On a
// route whose name after # starts with "president" the session also holds the
// President's position (under its real key, which is what the Roster page
// asks about), so that the President's controls are walked too.
let presiding = false
const presidentAssignment = { id: 'a2', status: 'active', position: { id: 'p2', key: 'eb.president', title: 'President', short_title: 'President', level: 'eb', can_assign_tasks: true, committee: null }, term: { id: 't1', label: '2026-27', is_current: true } }

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
    { id: 't-4', title: 'Print the World Health Day leaflets', body: '', status: 'blocked', priority: 'urgent', due_on: day(4), completed_at: null, committee_id: 'c-scoph', created_by: uid, created_at: iso(2), updated_at: iso(1), committee: scoph, assignees: [] },
  ],
  // The first task's timeline, one row of every kind, and the files that came
  // with two of them.
  task_updates: [
    { id: 'tu-1', task_id: 't-1', author_id: uid, kind: 'created', body: '', meta: {}, created_at: iso(3) },
    { id: 'tu-2', task_id: 't-1', author_id: uid, kind: 'assigned', body: '', meta: { profile_id: other }, created_at: iso(3) },
    { id: 'tu-3', task_id: 't-1', author_id: other, kind: 'comment', body: 'Half of them are in. The rest by Thursday, in the shared folder: https://example.org/exchange/incomings/welcome-booklet/photos/2026-27/contact-persons', meta: {}, created_at: iso(2) },
    { id: 'tu-4', task_id: 't-1', author_id: other, kind: 'files', body: '', meta: { files: 2 }, created_at: iso(1.5) },
    { id: 'tu-5', task_id: 't-1', author_id: uid, kind: 'edited', body: '', meta: { fields: ['title', 'due_on'] }, created_at: iso(1.2) },
    { id: 'tu-6', task_id: 't-1', author_id: other, kind: 'status', body: '', meta: { from: 'doing', to: 'todo' }, created_at: iso(1) },
    { id: 'tu-7', task_id: 't-1', author_id: uid, kind: 'comment', body: 'The list of who is still missing.', meta: {}, created_at: iso(0.5) },
  ],
  task_files: [
    { id: 'tf-1', task_id: 't-1', update_id: 'tu-4', path: 't-1/a.pdf', name: 'contact-persons-with-a-rather-long-file-name-2026-27.pdf', size_bytes: 482113, mime: 'application/pdf', uploaded_by: other, created_at: iso(1.5) },
    { id: 'tf-2', task_id: 't-1', update_id: 'tu-4', path: 't-1/b.jpg', name: 'hall.jpg', size_bytes: 1482113, mime: 'image/jpeg', uploaded_by: other, created_at: iso(1.5) },
    { id: 'tf-3', task_id: 't-1', update_id: 'tu-7', path: 't-1/c.xlsx', name: 'missing.xlsx', size_bytes: 20480, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', uploaded_by: uid, created_at: iso(0.5) },
  ],
  // A pinned update, one for everybody that runs past the fold, a draft, one
  // that goes out next week and one that has come down.
  posts: [
    { id: 'po-1', committee_id: 'c-scope', kind: 'announcement', title: 'Exchange season opens on the first of November', body: 'Applications go through the portal this year. Read the conditions before you apply: https://ausss-ainshams.org/exchange', levels: ['member', 'assistant', 'officer'], pinned: true, publish_at: iso(2), expires_at: null, author_id: uid, created_at: iso(2), committee: scope, reads: [{ profile_id: other }] },
    { id: 'po-2', committee_id: null, kind: 'news', title: 'The minutes of the first general assembly, and what was decided about the winter camp', body: 'The minutes are attached to the task, and the decisions are listed below. '.repeat(12).trim(), levels: [], pinned: false, publish_at: iso(1), expires_at: null, author_id: other, created_at: iso(1), committee: null, reads: [{ profile_id: uid }, { profile_id: other }] },
    { id: 'po-3', committee_id: 'c-scoph', kind: 'resource', title: 'Leaflet templates', body: 'In the shared drive.', levels: ['officer'], pinned: false, publish_at: null, expires_at: null, author_id: uid, created_at: iso(0.5), committee: scoph, reads: [] },
    { id: 'po-4', committee_id: 'c-scope', kind: 'news', title: 'Contact persons meet on Thursday', body: 'Bring the list of your students.', levels: ['member'], pinned: false, publish_at: iso(-7), expires_at: null, author_id: uid, created_at: iso(0.2), committee: scope, reads: [] },
    { id: 'po-5', committee_id: 'c-scope', kind: 'news', title: 'Last term’s incomings report', body: 'Read it before the first meeting.', levels: [], pinned: false, publish_at: iso(40), expires_at: iso(10), author_id: uid, created_at: iso(40), committee: scope, reads: [] },
  ],
  notifications: [
    { id: 'n-1', kind: 'task_assigned', payload: { task_id: 't-1', title: 'Collect the incomings welcome booklet photos', actor_id: other }, read_at: null, created_at: iso(0.1) },
    { id: 'n-3', kind: 'order_new', payload: { name: 'Fourth Buyer With A Long Name That Wraps On A Phone', ref: 'AUSSS-4D8R1T', subtotal: 120, flagged: true }, read_at: null, created_at: iso(0.5) },
    { id: 'n-4', kind: 'story_new', payload: { name: 'Second Outgoing With A Rather Long Four Part Name', destination: 'Brno, Czech Republic', ref: 'STORY-BBB222' }, read_at: null, created_at: iso(1) },
    { id: 'n-5', kind: 'task_files', payload: { task_id: 't-1', title: 'Collect the incomings welcome booklet photos from every contact person', actor_id: other, count: 2, name: 'contact-persons-with-a-rather-long-file-name-2026-27.pdf' }, read_at: iso(1), created_at: iso(1.5) },
    { id: 'n-2', kind: 'task_comment', payload: { task_id: 't-2', title: 'Book the hall for the first general assembly', actor_id: other, excerpt: 'The dean’s office wants the request on paper, signed, before Sunday.' }, read_at: iso(1), created_at: iso(2) },
  ],
  roster_entries: sampleRoster,
  // The last two imports of the membership sheet (one pulled from the sheet,
  // one uploaded as a file), and three bulk updates of the board's: two that
  // can still be undone and one that was.
  roster_sync_runs: [
    { id: 2, at: iso(0.1), source: 'sheet', batch: '11/10/2026', result: { inserted: 0, updated: 3, unchanged: 58, kept_portal_edits: 2, skipped_duplicates: 0, skipped_invalid: 0, missing_from_sheet: 2, missing_names: ['Sample Member Who Left', 'Another Sample Member'] } },
    { id: 1, at: iso(8), source: 'upload', batch: 'roster-october.xlsx', result: { inserted: 12, updated: 40, unchanged: 0, kept_portal_edits: 0, skipped_duplicates: 1, skipped_invalid: 2, missing_from_sheet: 0 } },
  ],
  roster_bulk_updates: [
    { id: 3, at: iso(0.3), action: 'lga', value: null, label: 'Local General Assembly, October 2026', changes: sampleRoster.slice(0, 41).map((r) => ({ id: r.id })), undone_at: null },
    { id: 2, at: iso(2), action: 'committee', value: 'scope', label: 'Contact persons for the August incomings', changes: sampleRoster.slice(5, 12).map((r) => ({ id: r.id })), undone_at: null },
    { id: 1, at: iso(5), action: 'status', value: 'Associate Member', label: 'Upgrades approved before the assembly', changes: [{ id: 'r-3' }], undone_at: iso(4) },
  ],
  positions: samplePositions,
  // The one address each officer's and board position belongs to. The
  // outgoings officer's has none yet, so that position cannot be given.
  position_work_emails: [
    { position_id: 'p1', email: 'webmaster@example.com' },
    { position_id: 'p2', email: 'president@example.com' },
    { position_id: 'p3', email: 'a-rather-long-work-address-for-a-phone@example.com' },
    { position_id: 'p4', email: 'leoin@example.com' },
    { position_id: 'p-lore', email: 'lore@example.com' },
  ],
  // Four people waiting for the board to check their membership: one with a
  // long name and address, one who wrote nothing, one whose account has
  // neither a name nor an address yet.
  verification_requests: [
    { id: 'vr-1', status: 'pending', message: 'I joined SCOPH last year and my name is missing from the sheet. My student number and the committee I joined are in my profile.', created_at: iso(3), profile_id: 'pr-31', profile: { full_name: 'Sample Applicant With A Rather Long Four Part Name', email: 'a-rather-long-address-for-a-phone@example.com', membership_status: 'unverified' } },
    { id: 'vr-2', status: 'pending', message: null, created_at: iso(2), profile_id: 'pr-32', profile: { full_name: 'Second Applicant', email: 'applicant2@example.com', membership_status: 'candidate' } },
    { id: 'vr-3', status: 'pending', message: 'Please check.', created_at: iso(1), profile_id: 'pr-33', profile: { full_name: 'Third', email: 'applicant3@example.com', membership_status: 'unverified' } },
    { id: 'vr-4', status: 'pending', message: null, created_at: iso(0.5), profile_id: 'pr-34', profile: { full_name: null, email: null, membership_status: 'unverified' } },
  ],
  calls: sampleCalls,
  applications: sampleApplications,
  // The officers' notes on the first member of SCOPE's list.
  member_notes: [
    { id: 'mn-2', roster_entry_id: 'r-1', committee_id: 'c-scope', author_id: other, body: 'Ran the airport rota in August without a single missed pick-up. The rota itself: https://example.org/exchange/incomings/airport-rota/august-2026/final-version-with-everyone-in-it', created_at: iso(2), updated_at: iso(2) },
    { id: 'mn-1', roster_entry_id: 'r-1', committee_id: 'c-scope', author_id: uid, body: 'Reliable. Led the welcome stand last year.', created_at: iso(5), updated_at: iso(5) },
  ],
  albums: [
    { id: 'al-1', slug: 'national-general-assembly-aswan-2026', title: 'National General Assembly, Aswan 2026', blurb: 'Three days in Aswan.', cover_photo_id: null, sort_order: 0, published: true, created_at: iso(20), updated_at: iso(2), archived_term_id: null, archived_term: null },
    { id: 'al-2', slug: 'orientation-day', title: 'Orientation day', blurb: '', cover_photo_id: null, sort_order: 1, published: true, created_at: iso(15), updated_at: iso(3), archived_term_id: null, archived_term: null },
    { id: 'al-3', slug: 'world-diabetes-day-campaign', title: 'World Diabetes Day campaign', blurb: '', cover_photo_id: null, sort_order: 2, published: false, created_at: iso(5), updated_at: iso(1), archived_term_id: null, archived_term: null },
    // archived at last term's rollover
    { id: 'al-4', slug: 'winter-camp-2026', title: 'Winter camp 2026, with a title long enough to wrap on a phone', blurb: '', cover_photo_id: null, sort_order: 0, published: true, created_at: iso(300), updated_at: iso(40), archived_term_id: 't0', archived_term: { label: '2025-26' } },
    { id: 'al-5', slug: 'orientation-25-26', title: 'Orientation 25-26', blurb: '', cover_photo_id: null, sort_order: 1, published: true, created_at: iso(380), updated_at: iso(40), archived_term_id: 't0', archived_term: { label: '2025-26' } },
  ],
  gallery_photos: samplePhotos,
  magazine_issues: sampleIssues,
  terms: [{ id: 't1', label: '2026-27', starts_on: '2026-09-01', ends_on: '2027-08-31' }],
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
    // still new, with a name and an address that have to wrap, and a note each way
    { id: 'o-4', ref: 'AUSSS-4D8R1T', status: 'new', name: 'Fourth Buyer With A Long Name That Wraps On A Phone', email: 'a-rather-long-address-for-a-phone-that-goes-on-and-on@students.example.edu.eg', phone: '+20 100 000 0004', is_member: false, lc: 'Alexandria', year: 'Other / External', payment_method: 'telda', items: [{ product_id: 'notebook', name: 'AUSSS Notebook', size: '', design: 'Exchange', qty: 3, unit_price: 40, line_total: 120 }], subtotal: 120, client_subtotal: 120, price_flag: '', notes: 'Please keep them for me until Thursday, I am away until then.', officer_notes: 'Called once, no answer.', receipt_path: 'o-4.jpg', created_at: iso(0.5), updated_at: iso(0.5) },
    { id: 'o-2', ref: 'AUSSS-9QX81B', status: 'contacted', name: 'Another Buyer With A Long Name', email: 'a-rather-long-address-for-a-phone@example.com', phone: '+44 7700 900123', is_member: false, lc: 'Cairo', year: 'Other / External', payment_method: 'telda', items: [{ product_id: 'jacket', name: '"The" AUSSS Jacket', size: '2XL', design: '', qty: 1, unit_price: 650, line_total: 650 }], subtotal: 650, client_subtotal: 600, price_flag: 'price mismatch (client said 600, server 650)', notes: '', officer_notes: '', receipt_path: null, created_at: iso(2), updated_at: iso(1) },
    { id: 'o-3', ref: 'AUSSS-2M4N6P', status: 'delivered', name: 'Third Buyer', email: 'buyer3@example.com', phone: '01000000003', is_member: true, lc: '', year: '5th year', payment_method: 'vodafone', items: [{ product_id: 'bucket-hat', name: 'Dash Bucket Hat', size: 'One size', design: '', qty: 1, unit_price: 150, line_total: 150 }], subtotal: 150, client_subtotal: 150, price_flag: '', notes: '', officer_notes: '', receipt_path: 'o-3.jpg', created_at: iso(9), updated_at: iso(3) },
  ],
  // Exchange stories: two new (one with a link that has nowhere to wrap), two
  // on the exchange page (one featured) and one declined.
  stories: [
    { id: 's-1', ref: 'STORY-AAA111', status: 'new', name: 'Sample Outgoing', email: 'outgoing1@example.com', phone: '01000000011', destination: 'Lisbon, Portugal', programme: 'SCOPE', year: '5th year', story: 'I spent four weeks in the surgery department in Lisbon.\n\nIt was the best month of my studies.', notes: '', featured: false, public_name: '', public_story: '', published_at: null, created_at: iso(0.3), updated_at: iso(0.3) },
    { id: 's-2', ref: 'STORY-BBB222', status: 'new', name: 'Second Outgoing With A Rather Long Four Part Name', email: 'a-rather-long-address-for-a-phone-that-goes-on-and-on@students.example.edu.eg', phone: '', destination: 'Brno, Czech Republic', programme: 'SCORE', year: '4th year', story: 'A story with a link that has nowhere to wrap: https://example.org/exchange/conditions/egypt/ain-shams-university/2026-27/professional-exchange and then some more words after it. '.repeat(6).trim(), notes: 'Asked for a photo.', featured: false, public_name: '', public_story: '', published_at: null, created_at: iso(1), updated_at: iso(1) },
    { id: 's-3', ref: 'STORY-CCC333', status: 'published', name: 'Third Outgoing', email: 'outgoing3@example.com', phone: '', destination: 'Graz, Austria', programme: 'SCOPE', year: '6th year', story: 'Graz in winter. Cold hands, warm ward.', notes: '', featured: false, public_name: 'Third O.', public_story: 'Graz in winter. Cold hands, warm ward.', published_at: iso(5), created_at: iso(8), updated_at: iso(5) },
    { id: 's-4', ref: 'STORY-DDD444', status: 'published', name: 'Fourth Outgoing', email: 'outgoing4@example.com', phone: '', destination: 'Tunis, Tunisia', programme: 'SCORE', year: '3rd year', story: 'A lab, a bench, a month.', notes: '', featured: true, public_name: 'Fourth Outgoing', public_story: 'A lab, a bench, a month.', published_at: iso(6), created_at: iso(9), updated_at: iso(6) },
    { id: 's-5', ref: 'STORY-EEE555', status: 'declined', name: 'Fifth Outgoing', email: 'outgoing5@example.com', phone: '', destination: '', programme: '', year: '', story: 'Too short.', notes: '', featured: false, public_name: '', public_story: '', published_at: null, created_at: iso(12), updated_at: iso(10) },
  ],
  // The recruitment waitlist: one of them left no name.
  signups: [
    { id: 'g-1', kind: 'waitlist', status: 'new', name: 'Waiting One', email: 'waiting1@example.com', phone: '', notes: '', created_at: iso(0.1), updated_at: iso(0.1) },
    { id: 'g-2', kind: 'waitlist', status: 'new', name: '', email: 'a-rather-long-address-for-a-phone-that-goes-on-and-on@students.example.edu.eg', phone: '+20 100 000 0012', notes: '', created_at: iso(0.4), updated_at: iso(0.4) },
    { id: 'g-3', kind: 'waitlist', status: 'contacted', name: 'Waiting Three With A Rather Long Name', email: 'waiting3@example.com', phone: '', notes: 'Wrote back on Monday.', created_at: iso(3), updated_at: iso(2) },
    { id: 'g-4', kind: 'waitlist', status: 'archived', name: 'Waiting Four', email: 'waiting4@example.com', phone: '', notes: '', created_at: iso(40), updated_at: iso(30) },
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
// from the lists of names above and the years below. chance(n) is the same
// number for the same n, so two runs show the same hall.
const chance = (n) => {
  const x = Math.sin(n * 12.9898) * 43758.5453
  return x - Math.floor(x)
}
const pick = (list, n) => list[Math.floor(chance(n) * list.length)]
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
// The people a task or an update of SCOPE's reaches.
const reached = [
  { id: uid, full_name: 'Sample Webmaster', position_title: 'Webmaster' },
  { id: other, full_name: 'Sample Officer With A Long Name', position_title: 'Local Exchange Officer for Incomings' },
  { id: 'pr-1', full_name: 'Sample Member With A Rather Long Four Part Name', position_title: 'Exchange Incomings Assistant' },
  { id: 'pr-9', full_name: null, position_title: 'Core Team Member' },
]
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
  // The roster page: who has the attendance for a higher status, and whether
  // the sheet's link and the script's token are in use.
  roster_upgrade_candidates: upgradeCandidates,
  roster_sheet_info: { active: true, hint: '1AbC…xYz' },
  roster_sync_token_info: { active: true, created_at: iso(12) },
  // A committee's members, and the positions held in it. Asked about no
  // committee, the second answers for the board and the webmaster.
  committee_roster: ({ committee }) => (committee === 'c-scope' || committee === 'c-score' ? committeeMembers : []),
  committee_positions: ({ committee }) => (committee ? heldIn.committee : heldIn.society),
  // Who a task can be given to, and who an update has reached: the same four
  // people, one of whom has no name yet. An update's own `reads` say which of
  // them have read it.
  task_assignable_people: reached.map(({ id, full_name, position_title }) => ({ id, full_name, avatar_url: null, position_title })),
  post_audience: ({ post }) => {
    const reads = tables.posts.find((p) => p.id === post)?.reads || []
    return reached.map(({ id, full_name }) => ({ profile_id: id, full_name, read_at: reads.some((r) => r.profile_id === id) ? iso(1) : null }))
  },
  magazine_insights: ({ issue }) => insightsOf(issue),
  // Site settings: when the public pages were last rebuilt, with a change waiting.
  site_rebuild_status: { requested_at: iso(0.01), fired_at: iso(0.2), hook: true },
  // A verification request decided, and the decision taken back: both land,
  // and neither answers with anything.
  decide_verification: null,
  undo_verification_decision: null,
  // A member dismissed, and one reinstated: what the database answers, which
  // the row's line is written from.
  dismiss_roster_member: { accounts: 1, positions_ended: 2 },
  reinstate_roster_member: { status: 'Associate Member' },
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

// Every screen of the sample, in the order the walk opens them.
export const ROUTES = [
  // the dashboard, and the same with the bell's panel open
  '/portal', '/portal#bell', '/portal/profile', '/portal/verify',
  // tasks and updates: the lists, the forms that take a page's place, and who has read an update
  '/portal/tasks', '/portal/tasks?view=board', '/portal/tasks?tab=new', '/portal/tasks/t-1', '/portal/tasks/t-1?tab=edit',
  '/portal/updates', '/portal/updates#audience', '/portal/updates?tab=new', '/portal/updates?edit=po-1',
  '/portal/notifications', '/portal/directory', '/portal/committees',
  // a committee's editor tab by tab: a new call, a call being changed, its applications, a member opened
  '/portal/committees/scope', '/portal/committees/scope?tab=events', '/portal/committees/scope?tab=calls',
  '/portal/committees/scope?tab=calls&call=new', '/portal/committees/scope?tab=calls&call=call-1',
  '/portal/committees/scope?tab=calls&call=call-1&view=applications',
  // a call just removed, with the line that says where its applications went, and a removed call's applications
  '/portal/committees/scope?tab=calls#removed', '/portal/committees/scope?tab=calls&removed=Welcome+week+buddies',
  '/portal/committees/scope?tab=members', '/portal/committees/scope?tab=members#member', '/portal/committees/scope?tab=invites',
  // the gallery's shelf, an album with photos and an archived one; the magazine's shelf and two editions
  '/portal/gallery', '/portal/gallery/national-general-assembly-aswan-2026', '/portal/gallery/winter-camp-2026',
  '/portal/magazine', '/portal/magazine/vol-9', '/portal/magazine/vol-8',
  // what the public forms sent in; the stories twice, as the tab opens and then every one of them with a form for the exchange page open
  '/portal/submissions?tab=orders', '/portal/submissions?tab=stories', '/portal/submissions?tab=stories#review',
  '/portal/submissions?tab=signups',
  // everybody on the waitlist ticked, and the form that writes to each of them in Gmail
  '/portal/submissions?tab=signups#write', '/portal/admin/settings',
  // the roster, then each of the panels its buttons open, and a member's row opened
  '/portal/admin/roster', '/portal/admin/roster#upgrades', '/portal/admin/roster#register-a-ga', '/portal/admin/roster#position-types',
  '/portal/admin/roster#executive-board', '/portal/admin/roster#member',
  // a dismissed member's record as the board reads it; then as the President: a member's row with
  // "Dismiss member" and a reason typed, the line a dismissal leaves, and the record with "Reinstate"
  '/portal/admin/roster#dismissed', '/portal/admin/roster#president-dismiss', '/portal/admin/roster#president-dismissed',
  '/portal/admin/roster#president-reinstate',
  // the Executive Board panel again as the President, who alone changes the President's work email
  '/portal/admin/roster#president-executive-board',
  // the verification queue, then with one request approved (the line with its Undo) and one approved and taken back
  '/portal/admin/verification', '/portal/admin/verification#undo', '/portal/admin/rollover',
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
]

// What the walk does on a route before it measures, for the screens that only
// show after a tap.
export const acts = {
  '/portal#bell': (page) => page.getByRole('button', { name: /^Notifications/ }).click(),
  // "Read by 1 · show who", under the first update this person manages.
  '/portal/updates#audience': (page) => page.getByRole('button', { name: /show who$/ }).first().click(),
  // The first member of the committee's list: a row is a button that opens it.
  '/portal/committees/scope?tab=members#member': (page) => page.getByRole('button', { name: /^Sample Member With A Rather Long Four Part Name/ }).click(),
  // Every story whatever its status, then the form that puts the first new one on the exchange page.
  '/portal/submissions?tab=stories#review': async (page) => {
    await page.getByRole('button', { name: /^All\b/ }).click()
    await page.getByRole('button', { name: 'Review and publish' }).first().click()
  },
  // Everybody listed is ticked, and the form is open with a subject and a
  // message. Nothing is opened in Gmail: that would leave the page.
  '/portal/submissions?tab=signups#write': async (page) => {
    await page.getByRole('checkbox', { name: /^Select all/ }).check()
    await page.getByRole('button', { name: 'Write to them', exact: true }).click()
    await page.getByLabel('Subject').fill('Recruitment opens on Sunday')
    await page.getByLabel('Message').fill('Applications open this Sunday at noon and close a week later.\n\nThe form is on the Join page of the website.')
  },
  '/portal/admin/roster#upgrades': (page) => page.getByRole('button', { name: 'Review', exact: true }).click(),
  // The attendance form, with the bulk updates made so far under it.
  '/portal/admin/roster#register-a-ga': (page) => page.getByRole('button', { name: 'Register a GA', exact: true }).click(),
  // The panel lists nothing until a committee is chosen; the first is SCOPE and SCORE's.
  '/portal/admin/roster#position-types': async (page) => {
    await page.getByRole('button', { name: 'Position types', exact: true }).click()
    await page.selectOption('#pt-committee', { index: 1 })
  },
  '/portal/admin/roster#executive-board': (page) => page.getByRole('button', { name: 'Executive Board', exact: true }).click(),
  // The member with the long name and address, who is on the list's first page.
  '/portal/admin/roster#member': (page) => page.locator('#roster-row-r-4').click(),
  // The dismissed member's record. The webmaster reads it and has no button.
  '/portal/admin/roster#dismissed': (page) => page.locator('#roster-row-r-0').click(),
  // The same member's row for the President, with a reason long enough to wrap.
  '/portal/admin/roster#president-dismiss': async (page) => {
    await page.locator('#roster-row-r-4').click()
    await page.fill('#r-dismiss-reason-r-4', 'A made-up reason, written at some length so that the field has to wrap it on a phone.')
  },
  // "Dismiss member" asks twice, and two taps too close together count as one
  // slip. The sample list still shows the member as they were afterwards; the
  // line under their name is what this screen is for.
  '/portal/admin/roster#president-dismissed': async (page) => {
    await page.locator('#roster-row-r-4').click()
    await page.fill('#r-dismiss-reason-r-4', 'A made-up reason.')
    await page.getByRole('button', { name: 'Dismiss member', exact: true }).click()
    await page.waitForTimeout(600)
    await page.getByRole('button', { name: 'Click again to dismiss', exact: true }).click()
    await page.getByText(/^Dismissed\. Their portal account/).waitFor()
  },
  // The record again, for the President: "Reinstate" and what it gives back.
  '/portal/admin/roster#president-reinstate': (page) => page.locator('#roster-row-r-0').click(),
  // The webmaster reads the President's work email greyed out (the walk above);
  // here it is the President's to change.
  '/portal/admin/roster#president-executive-board': (page) => page.getByRole('button', { name: 'Executive Board', exact: true }).click(),
  '/portal/admin/audit#released': (page) => page.locator('details > summary').first().click(),
  // "Remove" asks twice, and two taps too close together count as one slip.
  // The sample list still holds the call afterwards; the line above it is
  // what this screen is for.
  '/portal/committees/scope?tab=calls#removed': async (page) => {
    await page.getByRole('button', { name: 'Remove', exact: true }).last().click()
    await page.waitForTimeout(600)
    await page.getByRole('button', { name: 'Click again to remove', exact: true }).click()
  },
  // The last request approved and taken back, which leaves "Decision undone";
  // then the first approved, which leaves the line with its Undo.
  '/portal/admin/verification#undo': async (page) => {
    await page.getByRole('button', { name: 'Approve', exact: true }).last().click()
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await page.getByText(/^Decision undone\./).waitFor()
    await page.getByRole('button', { name: 'Approve', exact: true }).first().click()
    await page.getByRole('button', { name: 'Undo', exact: true }).waitFor()
  },
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

// What a read asks for in its address, in PostgREST's words (status=eq.new,
// deleted_at=is.null, id=in.(a,b)), applied to the sample rows. Only the words
// the portal uses are known. An unknown word narrows nothing, and neither does
// a column the rows do not carry (select, order, a column of a joined table).
function narrowed(rows, asked) {
  let fit = rows
  for (const [column, test] of asked) {
    if (!rows.some((r) => column in r)) continue
    const [, word, value] = test.match(/^(eq|neq|lt|in)\.(.*)$/) || []
    if (word === 'eq') fit = fit.filter((r) => String(r[column]) === value)
    else if (word === 'neq') fit = fit.filter((r) => String(r[column]) !== value)
    else if (word === 'lt') fit = fit.filter((r) => r[column] != null && String(r[column]) < value)
    else if (word === 'in') {
      const listed = value.replace(/^\(|\)$/g, '').split(',').map((v) => v.replace(/^"|"$/g, ''))
      fit = fit.filter((r) => listed.includes(String(r[column])))
    } else if (test === 'is.null') fit = fit.filter((r) => r[column] == null)
    else if (test === 'not.is.null') fit = fit.filter((r) => r[column] != null)
  }
  return fit
}

// Call before opening a route. One page is open at a time, so it holds for
// every read that page makes.
export function presideOn(route) {
  presiding = route.split('#')[1]?.startsWith('president') ?? false
}

// Gives a browser context the made-up session and answers every Supabase call
// its pages make from the sample.
export async function installSample(context, theme) {
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
    // An edition's uploaded pages: the page with the same number of the
    // edition kept in the repo stands in for each.
    const magazinePage = url.pathname.match(/^\/storage\/v1\/object\/public\/magazine\/.+\/(\d{3})\.jpg$/)?.[1]
    if (magazinePage) return route.fulfill({ status: 200, contentType: 'image/jpeg', path: `public/assets/magazine/vol-7/pages/${magazinePage}.jpg` })
    // The folders of an edition in the `magazine` bucket, which its editor
    // reads to clear away what old uploads left. A folder has no id.
    if (url.pathname === '/storage/v1/object/list/magazine') {
      const folders = magazineFolders[req.postDataJSON()?.prefix] || []
      return json(folders.map((name) => ({ name, id: null, updated_at: null, created_at: null, last_accessed_at: null, metadata: null })))
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
      if (table === 'site_settings') return route.continue({ headers })
      // A committee's own id is one the sample rows cannot know, so each
      // committee reaches the page under c-<its slug>, the id they name it
      // by. Whatever the page then asks by that id is answered here. A read
      // cut short (no connection, or the page closed under it) is dropped.
      try {
        const read = await route.fetch({ headers })
        const found = read.ok() ? await read.json().catch(() => null) : null
        if (!found) return await route.fulfill({ response: read })
        const named = (c) => (c?.id && c.slug ? { ...c, id: `c-${c.slug}` } : c)
        return await json(Array.isArray(found) ? found.map(named) : named(found))
      } catch {
        return route.abort('connectionfailed').catch(() => {})
      }
    }
    // On a "president" route the session holds the President's position too.
    const stored = table === 'assignments' && presiding ? [...tables.assignments, presidentAssignment] : tables[table] || []
    const rows = narrowed(stored, url.searchParams)
    if (req.method() === 'HEAD') return route.fulfill({ status: 200, headers: { 'content-range': `*/${rows.length}`, 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' } })
    if ((req.headers().accept || '').includes('vnd.pgrst.object')) return json(rows[0] ?? {})
    return json(rows, { 'content-range': `0-${Math.max(0, rows.length - 1)}/${rows.length}` })
  })
}
