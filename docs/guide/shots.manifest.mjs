// Every picture in the website guide: where it is taken, how, and the caption
// under it. scripts/guide/shots.mjs takes them; a chapter places one with
// `![](shot:<id>)` (docs/guide/README.md).
//
//   id        lower case words joined by hyphens; the picture is out/shots/<id>.jpg
//   route     the address, from the first slash
//   caption   one sentence: what the reader is looking at and what it is for
//   world     'live' (a visitor, real data, no writes) or 'sample' (the made-up
//             portal of scripts/portal-sample.mjs). Left out, /portal and /exam
//             are 'sample' and everything else is 'live'.
//   viewport  'desktop' (1280 by 800, the default) or 'mobile' (390 by 780)
//   theme     'light' (the default) or 'dark'
//   capture   'content' (the default): the page from its top to where the
//               footer begins, up to maxHeight pixels (1400 unless given)
//             'viewport': one screen, after scrollTo if there is one
//             { el, pad }: one place on the page and a little around it
//             { from, height, pad }: a band across the page, from a place or
//               a number of pixels down
//   A place is a selector, or 'section:<a heading's words>' for the section or
//   card that heading is in, or 'heading:<words>' for the heading itself.
//   do        what to tap or type once the page has loaded: (page) => ...
//   storage   what the browser already remembers: { key: value }
//   rpc       answers to database functions, by name, written here
//   hide      selectors to blank before the picture
//   skip      a reason not to take it for now
//
// On a sample route whose name ends in #something, what the sample taps on
// that screen (`acts` in scripts/portal-sample.mjs) is done first.

const shot = (id, route, caption, more = {}) => ({ id, route, caption, ...more })
const band = (from, height, pad) => ({ from, height, ...(pad === undefined ? {} : { pad }) })

// A cart with two things in it, as the browser keeps it.
const cart = { 'ausss-cart-v1': { items: [{ productId: 'tshirt-55', size: 'M', design: '', qty: 1 }, { productId: 'notebook', size: '', design: 'Exchange', qty: 2 }] } }
const openCart = (page) => page.getByRole('button', { name: /^Open cart/ }).filter({ visible: true }).first().click()

// The membership check answers with whatever the shot needs: nobody real is looked up.
const lookUp = (name) => async (page) => {
  await page.getByLabel('Full name').fill(name)
  await page.getByRole('button', { name: 'Check my status' }).click()
  await page.getByRole('button', { name: 'Check my status' }).waitFor()
}
const SCOPE = '/portal/committees/scope'

export const shots = [
  // ---- part 1: getting around ---------------------------------------------
  shot('nav-header', '/join', 'The header on a laptop: the logo, the pages, the Committees menu, the magazine, Check membership, the theme switch and the cart.', { capture: band(0, 130) }),
  shot('nav-committees-menu', '/join', 'The Committees menu lists the exchange pages, the six standing committees and the four support divisions.', {
    capture: band(0, 560),
    do: (page) => page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Committees' }).click(),
  }),
  shot('nav-dark', '/', 'The dark theme, one press of the moon in the header away. The site remembers the choice on that device.', { theme: 'dark', capture: 'viewport' }),
  shot('nav-footer', '/join', 'The footer is the same on every public page: the motto, the address with its map, the pages and the social channels.', { capture: { el: 'footer >> nth=-1', pad: 0 }, maxHeight: 1000 }),
  shot('nav-mobile', '/', 'The home page on a phone.', { viewport: 'mobile', capture: 'viewport' }),
  shot('nav-mobile-menu', '/join', 'On a phone the pages are behind the menu button, and Back sits in the header.', {
    viewport: 'mobile',
    capture: 'viewport',
    do: (page) => page.getByRole('button', { name: 'Toggle menu' }).click(),
  }),
  shot('nav-not-found', '/no-such-page', 'An address that leads nowhere gets this page, with the ways back.', {}),

  // ---- part 2: the public pages -------------------------------------------
  shot('home-hero', '/', 'The first screen of the home page.', { capture: 'viewport' }),
  shot('home-about', '/', 'About the society: the three things it does, each a card that leads on.', { capture: { el: '#about', pad: 0 }, maxHeight: 1150 }),
  shot('home-events', '/', 'Our next events: the three that come up soonest, from the events page.', { world: 'sample', capture: { el: '#events', pad: 0 } }),
  shot('home-board', '/', 'The Executive Board, with each member’s name, position and photo.', { capture: { el: '#board', pad: 0 }, maxHeight: 1150 }),
  shot('home-committees', '/', 'Committees and support divisions: every card opens that committee’s page.', { capture: { el: '#officials', pad: 0 }, maxHeight: 1500 }),

  shot('committee-top', '/committees/scope', 'A committee’s page opens with its name, its mascot and what it does.', { capture: 'viewport' }),
  shot('committee-body', '/committees/scope', 'Further down: the committee’s team and what it runs.', { capture: band(800, 1250) }),
  shot('committee-division', '/committees/pnsd', 'A support division’s page has the same shape.', { maxHeight: 1320 }),

  shot('ifmsa-top', '/ifmsa', 'IFMSA at Ain Shams: where the society sits in the federation.', { maxHeight: 1250 }),
  shot('ifmsa-more', '/ifmsa', 'What membership brings, and the two documents the page leads to.', { capture: band(1250, 1300) }),
  shot('ifmsa-history', '/ifmsa/history', 'A history in six committees, one after the other in the order they were founded.', { maxHeight: 1350 }),

  shot('exchange-hub', '/exchange', 'The exchange hub and its three doors: going abroad, coming to Cairo, joining the team.', {}),
  shot('outgoings-top', '/exchange/outgoings', 'Outgoings: the page for students of the faculty who want to go abroad.', { maxHeight: 1320 }),
  shot('outgoings-apply', '/exchange/outgoings', 'How to apply, in five steps from the exchange exam to the certificate.', { capture: { el: '#how-to-apply', pad: 0 } }),
  shot('outgoings-write', '/exchange/outgoings', 'Write to us: the officers who answer questions about going abroad.', { capture: { el: '#write-to-us', pad: 0 } }),
  shot('incomings-top', '/exchange/incomings', 'Incomings: the page that speaks to students abroad who are choosing where to go.', { maxHeight: 1350 }),
  shot('incomings-why', '/exchange/incomings', 'Why choose us: the hospital, the campus, the people and the country.', { capture: { el: 'section:Why choose us', pad: 0 }, maxHeight: 1300 }),
  shot('incomings-booklets', '/exchange/incomings', 'The Incomings Booklet, and the two booklets of the national team under it.', { capture: band('#incomings-booklet', 1150) }),
  shot('exchange-team', '/exchange/join', 'Join the exchange team: the positions, from officers to contact persons.', { maxHeight: 1650 }),
  shot('share-story', '/exchange/share', 'Share your exchange story: the form a returning student fills in. Nothing shows on the site until an officer has read it.', {
    maxHeight: 1500,
    do: async (page) => {
      await page.fill('#name', 'Sample Student')
      await page.fill('#email', 'student@example.com')
      await page.fill('#phone', '01000000000')
      await page.fill('#destination', 'Lisbon, Portugal')
      await page.fill('#year', '2026')
      await page.fill('#story', 'Four weeks in the surgery department in Lisbon. The mornings were ward rounds and theatre; the afternoons were ours.')
    },
  }),

  shot('events-list', '/events', 'What’s on: every event that has not ended yet, the soonest first.', { world: 'sample' }),
  shot('events-event', '/events/world-health-day-stand-2026', 'An event’s own page: when and where, signing up, adding it to a calendar and sharing it.', { world: 'sample', maxHeight: 1650 }),
  shot('events-days', '/events/spring-school-on-research-methods-2026', 'An event over several days lists each day with its own hours.', { world: 'sample', maxHeight: 1050 }),
  shot('events-archive', '/events/archive', 'Past events, kept term by term.', { world: 'sample', maxHeight: 1550 }),

  shot('gallery-index', '/gallery', 'The gallery: one card for each album of this term.', { maxHeight: 1500 }),
  shot('gallery-album', '/gallery/aswan-nga', 'An album. A press on any photo opens it large.', { maxHeight: 1400 }),
  shot('gallery-viewer', '/gallery/aswan-nga', 'A photo opened: the arrows, a swipe or the arrow keys move to the next one.', {
    capture: 'viewport',
    do: async (page) => {
      await page.getByRole('button', { name: /^Open photo 2 of/ }).click()
      await page.getByRole('dialog').waitFor()
    },
    wait: 1200,
  }),
  shot('gallery-archive', '/gallery/archive', 'Earlier terms: the albums that were archived when a new term began.', { world: 'sample' }),

  shot('magazine-reader', '/magazine', 'The magazine: the latest edition opens as a book whose pages turn.', { maxHeight: 1500, wait: 1500 }),

  shot('merch-top', '/merch', 'The merch page opens with this year’s booklet.', { capture: 'viewport', wait: 1200 }),
  shot('merch-products', '/merch', 'Order what you love: each product with its sizes or designs and its price.', { world: 'sample', capture: { el: '#place-your-order', pad: 0 }, maxHeight: 1700 }),
  shot('merch-cart', '/merch', 'The cart, from the button in the header: change a quantity, remove a line or go to the checkout.', { world: 'sample', storage: cart, capture: 'viewport', do: openCart, wait: 900 }),
  shot('merch-checkout', '/merch/checkout', 'The checkout: contact details, a payment method and the screenshot of the transfer.', { world: 'sample', storage: cart, maxHeight: 1900 }),

  shot('join-top', '/join', 'Join AUSSS: what a member gets.', { maxHeight: 960 }),
  shot('join-committees', '/join', 'Find your committee: all ten in one place, with the quiz for the undecided.', { capture: { el: 'section:Find your committee', pad: 0 }, maxHeight: 1100 }),
  shot('join-faq', '/join', 'Frequently asked questions. A press on a question opens its answer.', {
    capture: { el: 'section:Frequently asked questions', pad: 0 },
    do: (page) => page.locator('details').first().evaluate((el) => (el.open = true)),
  }),
  shot('sorting-intro', '/sorting', 'The sorting quiz: twelve questions that end in a committee.', {}),
  shot('sorting-question', '/sorting', 'A question. Choosing an answer moves straight on to the next.', {
    do: (page) => page.getByRole('button', { name: /Begin the Sorting/ }).click(),
  }),
  shot('sorting-result', '/sorting', 'The result: a committee, a way to share it and a link to its page.', {
    do: async (page) => {
      await page.getByRole('button', { name: /Begin the Sorting/ }).click()
      for (let n = 1; n <= 12; n++) {
        await page.getByRole('progressbar', { name: `Question ${n} of 12` }).waitFor()
        await page.locator('article button').filter({ hasNotText: 'Back' }).filter({ visible: true }).first().click()
      }
      await page.getByText('Better be').waitFor()
    },
    wait: 900,
  }),

  shot('members-form', '/members', 'Check your membership: a name or an email is enough.', {}),
  shot('members-found', '/members', 'A member found: the status, the years and the assemblies attended, and what the status allows.', {
    maxHeight: 1750,
    rpc: { check_membership: { state: 'found', record: { status: 'Associate Member', yearJoined: '2024', yearsSpent: '2', lgas: '3', ngas: '1', currentPosition: 'Contact Person' } } },
    do: lookUp('Sample Member'),
  }),
  shot('members-suggest', '/members', 'A near miss: the page offers the names it has that are close to the one typed.', {
    rpc: { check_membership: { state: 'not-found', suggestions: { names: ['Sample Member One', 'Sample Member Two'] } } },
    do: lookUp('Sampel Member'),
  }),
  shot('members-ended', '/members', 'A membership the President has ended says only that.', { rpc: { check_membership: { state: 'ended' } }, do: lookUp('Sample Member') }),

  shot('contact-page', '/contact', 'Contact us: the society’s address and channels, then every board member, committee and division with its own email.', { maxHeight: 1500 }),
  shot('constitution-reader', '/constitution', 'The Constitution & Bylaws, read on the page in the site’s own document reader.', {
    maxHeight: 1450,
    do: (page) => page.locator('canvas').first().waitFor({ timeout: 30000 }),
    wait: 2500,
  }),
  shot('reader-search', '/constitution', 'Searching a document: the matches are marked on the pages, and List shows each with the words around it.', {
    capture: 'viewport',
    scrollTo: 'form[role="search"]',
    offset: 150,
    do: async (page) => {
      await page.locator('canvas').first().waitFor({ timeout: 30000 })
      const box = page.getByPlaceholder('Search this document').first()
      await box.fill('member')
      await box.press('Enter')
      await page.getByRole('button', { name: 'List', exact: true }).first().click({ timeout: 30000 })
    },
    wait: 1500,
  }),
  shot('constitution-national', '/constitution', 'The national rules: the IFMSA-Egypt Constitution & Bylaws, to read here, open in a tab or download.', { capture: { el: '#ifmsa-egypt', pad: 0 } }),
  shot('privacy-page', '/privacy', 'The privacy policy says what each form and the portal keep, and who can see it.', { maxHeight: 1200 }),

  // ---- part 3: the portal for every member ---------------------------------
  shot('signin', '/portal/sign-in', 'Signing in to the portal: with Google, or with a link sent by email.', { capture: 'viewport' }),
  shot('portal-header', '/portal', 'The portal’s header: notifications, the theme, who is signed in and Sign out, with the pages on the row below. A member sees fewer pages than this webmaster does.', { capture: band(0, 205) }),
  shot('portal-dashboard', '/portal', 'The dashboard gathers what is waiting: tasks, updates, the membership and, for those who have them, the editors.', {}),
  shot('portal-bell', '/portal#bell', 'The bell opens the latest notifications without leaving the page.', { capture: 'viewport' }),
  shot('portal-mobile', '/portal', 'The portal on a phone: the pages become a line that scrolls sideways.', { viewport: 'mobile', capture: 'viewport' }),
  shot('profile', '/portal/profile', 'Your profile: your details, your photo, and two choices about the directory and the daily email.', { maxHeight: 1360 }),
  shot('verify', '/portal/verify', 'Verify your membership. An account already verified is told so.', {}),
  shot('tasks-list', '/portal/tasks', 'Tasks as a list, with what is due and who has each.', {}),
  shot('tasks-board', '/portal/tasks?view=board', 'The same tasks as a board, a column for each state.', {}),
  shot('task-page', '/portal/tasks/t-1', 'A task: its details and files, and under them everything that has happened to it.', { maxHeight: 1460 }),
  shot('task-new', '/portal/tasks?tab=new', 'A new task: who it is for, when it is due, how urgent it is, and files to attach.', { maxHeight: 1440 }),
  shot('updates', '/portal/updates', 'Updates: what the officers have posted to the people it concerns, pinned ones first.', { maxHeight: 1500 }),
  shot('updates-audience', '/portal/updates#audience', 'Whoever posted an update can see who has read it.', { capture: band('heading:Exchange season opens on the first of November', 430, 50) }),
  shot('update-new', '/portal/updates?tab=new', 'A new update: who should see it, when it goes out and when it comes down.', { maxHeight: 1570 }),
  shot('notifications', '/portal/notifications', 'Notifications: everything the portal has told this account, newest first.', {}),
  shot('directory', '/portal/directory', 'The members directory: who is in the portal and what they hold.', {}),

  // ---- part 4: the portal for officers --------------------------------------
  shot('committees-list', '/portal/committees', 'Your committees: one card for each committee an officer can edit.', {}),
  shot('committee-editor', SCOPE, 'The committee page editor. What is saved here is what visitors read on the committee’s page.', { maxHeight: 1450 }),
  shot('committee-events-tab', `${SCOPE}?tab=events`, 'The Events tab: this committee’s events, and the form for a new one.', {}),
  shot('portal-events', '/portal/events', 'The Events page lists every event the account may edit, with whether each is published, a draft or over.', { maxHeight: 1660 }),
  shot('event-editor', '/portal/events/ev-1', 'An event’s editor: the Published switch, the event itself, and beside it the card as visitors will see it.', { maxHeight: 1500 }),
  shot('calls-list', `${SCOPE}?tab=calls`, 'Open calls: each call with its state and how many have applied.', { maxHeight: 1400 }),
  shot('call-edit', `${SCOPE}?tab=calls&call=call-1`, 'A call’s form: what it is, the last day, the positions on offer and any extra questions.', { capture: band('heading:Edit call', 1250, 70) }),
  shot('call-applications', `${SCOPE}?tab=calls&call=call-1&view=applications`, 'The applications to a call, each with its answers, a status and the officers’ notes.', { capture: band('heading:Applications', 1300, 70) }),
  shot('calls-removed', `${SCOPE}?tab=calls&removed=Welcome+week+buddies`, 'The applications of a call that was removed are kept and can still be read.', {}),
  shot('members-tab', `${SCOPE}?tab=members`, 'The Members tab: the committee’s members as the roster has them.', { maxHeight: 1500 }),
  shot('member-open', `${SCOPE}?tab=members#member`, 'A member opened: what the roster says, the positions held here and the officers’ notes.', { capture: band(440, 1500) }),
  shot('invites-tab', `${SCOPE}?tab=invites`, 'The Invites tab: who holds a position now, and the offers that wait for a first sign-in.', { maxHeight: 1600 }),
  shot('gallery-editor', '/portal/gallery', 'The gallery editor’s shelf. Albums are put in order by dragging; archived ones sit below by term.', {}),
  shot('album-editor', '/portal/gallery/national-general-assembly-aswan-2026', 'An album: its title and cover, then its photos, each of which can be labelled, hidden or binned.', { maxHeight: 1750 }),
  shot('magazine-editor', '/portal/magazine', 'The magazine’s shelf: every edition, in the order the public page offers them.', {}),
  shot('issue-editor', '/portal/magazine/vol-9', 'An edition: its words, its pages from a PDF, the page that fronts it, and how far readers got.', { maxHeight: 1750 }),
  shot('content-list', '/portal/content', 'Edit the public site: the pieces of the public pages that are edited here.', {}),
  shot('content-editor', '/portal/content/join.faq', 'A piece being edited: the form on the left, the page as it will read on the right, and Publish when it is ready.', { maxHeight: 1500 }),
  shot('content-incomings', '/portal/content/exchange.incomings', 'The incomings page in the editor. The preview follows the field being typed in.', { maxHeight: 1300 }),
  shot('exam-list', '/portal/exam', 'The exams of this term and the last.', {}),
  shot('exam-setup', '/portal/exam/ex-1?tab=setup', 'Set-up: the exam’s name, when students can start, how long a paper runs, the address and the start code.', { maxHeight: 1500 }),
  shot('exam-questions', '/portal/exam/ex-1?tab=questions', 'Questions: each with its options and the right answer marked.', { maxHeight: 1400 }),
  shot('exam-question-edit', '/portal/exam/ex-2?tab=questions#edit', 'A question’s form, open while the exam is still a draft.', { maxHeight: 1500 }),
  shot('exam-registered', '/portal/exam/ex-1?tab=list', 'The registered list: the student IDs allowed to sit, and which account holds each.', { maxHeight: 1300 }),
  shot('exam-results', '/portal/exam/ex-1?tab=results', 'Results, ranked, as the papers come in.', { maxHeight: 1400 }),
  shot('exam-paper', '/portal/exam/ex-1?tab=results&paper=at-005', 'One student’s paper: every question with the answer given and the right one.', { maxHeight: 1500 }),
  shot('exam-overview', '/portal/exam/ex-1?tab=overview', 'Overview: how each question was answered across the hall.', { maxHeight: 1500 }),
  shot('exam-student-signin', '/exam/sample-sign-in', 'What a student meets at the exam’s address: the sign-in card.', { capture: 'viewport' }),
  shot('exam-student-details', '/exam/sample-details', 'Your details: the name, the year, a phone number and the student ID that is checked against the list.', {}),
  shot('exam-student-not-listed', '/exam/sample-details#not-listed', 'An ID that is not on the list is told so, and can be corrected.', {}),
  shot('exam-student-open', '/exam/sample-open', 'On the list, with the exam open: the start code the hall is given goes in here.', {}),
  shot('exam-student-wrong-code', '/exam/sample-open#wrong-code', 'A wrong code says how many tries are left.', {}),
  shot('exam-student-paper', '/exam/sample-sitting', 'The paper: ten questions a page, the clock, a flag for a question to come back to, and the line that says the answers are saved.', { maxHeight: 1300 }),
  shot('exam-student-phone', '/exam/sample-sitting', 'The same paper on a phone.', { viewport: 'mobile', capture: 'viewport' }),
  shot('exam-student-review', '/exam/sample-sitting#review', 'Review and hand in: what is unanswered, what is flagged, and the button that is pressed twice.', {}),
  shot('exam-student-received', '/exam/sample-received', 'Handed in.', { capture: 'viewport' }),
  shot('exam-student-timed-out', '/exam/sample-timed-out', 'Out of time: the answers given were kept.', { capture: 'viewport' }),

  // ---- part 5: the portal for the Executive Board ---------------------------
  shot('roster', '/portal/admin/roster', 'The membership roster: the search, the filters, the panels behind the buttons and the list itself.', { maxHeight: 1400 }),
  shot('roster-member', '/portal/admin/roster#member', 'A member’s row opened: everything the roster holds about them, to change and save.', { capture: band('#roster-row-r-4', 900, 30) }),
  shot('roster-upgrades', '/portal/admin/roster#upgrades', 'Review: the members whose attendance has reached the next status, for the board to grant.', { maxHeight: 1250 }),
  shot('roster-ga', '/portal/admin/roster#register-a-ga', 'Register a GA: one assembly recorded for everybody who attended, with the updates made so far under it.', { maxHeight: 1500 }),
  shot('roster-position-types', '/portal/admin/roster#position-types', 'Position types: the positions a committee hands out, and what each one may do.', { maxHeight: 1400 }),
  shot('roster-board', '/portal/admin/roster#executive-board', 'Executive Board: each board position, its one work email, who holds it and the offers that wait.', { maxHeight: 1750 }),
  shot('roster-dismiss', '/portal/admin/roster#president-dismiss', 'For the President only: Dismiss member, with the reason it will be recorded under.', { capture: band('#roster-row-r-4', 1000, 30) }),
  shot('roster-dismissed', '/portal/admin/roster#president-dismissed', 'After a dismissal the line says what ended with it.', { capture: band('#roster-row-r-4', 360, 30) }),
  shot('roster-reinstate', '/portal/admin/roster#president-reinstate', 'A dismissed member’s record, with Reinstate for the President.', { capture: band('#roster-row-r-0', 720, 30) }),
  shot('verification-queue', '/portal/admin/verification', 'The verification queue: accounts asking to be confirmed as members.', {}),
  shot('verification-undo', '/portal/admin/verification#undo', 'A decision leaves a line with Undo, for the board member who made it.', {}),
  shot('submissions-orders', '/portal/submissions?tab=orders', 'Orders from the merch shop: what was bought, how it was paid, and where each order stands.', { maxHeight: 1700 }),
  shot('submissions-stories', '/portal/submissions?tab=stories', 'Stories sent in from the exchange pages, waiting to be read.', { maxHeight: 1500 }),
  shot('submissions-review', '/portal/submissions?tab=stories#review', 'Review and publish: the story as it will read on the exchange page, and the name it goes under.', { capture: band('text=On the exchange page', 900, 420) }),
  shot('submissions-waitlist', '/portal/submissions?tab=signups', 'The waitlist: everyone who asked to be told when recruitment opens.', {}),
  shot('submissions-write', '/portal/submissions?tab=signups#write', 'Writing to several people at once: tick them, write the subject and the message once, then open one email for each in Gmail. Every one opens with that person’s first name.', {
    capture: band('section[aria-label="Write to several people"]', 830, 130),
  }),
  shot('merch-editor', '/portal/merch', 'The shop: the switch that takes pre-orders, and the products in the order the shop shows them.', { maxHeight: 1500 }),
  shot('merch-editor-more', '/portal/merch', 'Further down the same page: the payment methods on the checkout, and the orders.', { capture: band(':text-is("Payment methods")', 1400, 50) }),
  shot('product-editor', '/portal/merch/notebook', 'A product: whether it is on sale, what its card says, and its pictures.', { maxHeight: 1500 }),
  shot('settings', '/portal/admin/settings', 'Site settings: the switches of the public site, the rebuild of its pages and, at the foot, New term.', { maxHeight: 1440 }),
  shot('rollover', '/portal/admin/rollover', 'New term, first half: the term’s name and days, and what happens to every position.', { maxHeight: 1400 }),
  shot('rollover-more', '/portal/admin/rollover', 'Second half: tasks, the gallery, the exam, and the Start button, which asks for the term’s name and a second press.', { capture: band(1400, 1200) }),
  shot('audit', '/portal/admin/audit#released', 'The audit log: who changed what and when, with an entry opened.', {}),
]
