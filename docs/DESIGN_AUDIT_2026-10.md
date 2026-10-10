# Design audit, October 2026

Run on 2026-10-08 with the apple-design skill (Emil Kowalski, installed at `.claude/skills/apple-design`).
Eight read-only code reviews: three on the public site (motion, materials and type, design foundations) and
five on the portal (shell and shared UI, admin, committees/tasks/updates, content/events/submissions,
gallery/magazine/merch). Nothing was changed. Line numbers are as of main `86b5004`.

Checked again by hand: the confirm double-click (C1), the magazine page replace (H1), the edition form
reset (H2), the missing 404 (H9) and the smooth-scroll override (C3).

## 1. Fix once, helps everywhere

- **C1. High. Confirm buttons fire on a double-click.** `src/portal/portalUi.jsx:237-244` arms on the first
  click and confirms on the second with no gap, so a habitual double-click runs permanent deletes and New
  term. Fix: ignore a confirming click under about 500 ms after arming. For New term
  (`RolloverPage.jsx:295`), also require typing the term name and say "This cannot be undone." Found by
  three reviews.
- **C2. Medium. No pressed state on any button, and public button colour changes snap.**
  `src/components/ui/Button.jsx:42` has `transition-colors transition-transform`, and the second overrides
  the first. Same lack of `active:` in `portalUi.jsx:95-99` and `workUi.jsx:202`. Fix:
  `transition-[color,background-color,border-color,transform] duration-150 ease-out active:scale-[0.97] motion-reduce:transform-none`.
- **C3. Medium-high. Reduced motion still gets smooth scrolling.** `index.html:2` has `class="scroll-smooth"`,
  which beats the `html { scroll-behavior: auto }` override in `src/index.css:375-377`. Hard-coded
  `behavior: 'smooth'` also in `BackToTop.jsx:14`, `IncomingsBooklet.jsx:23`, `ScrollManager.jsx:35`,
  `CheckoutPage.jsx:134`, `MembersPage.jsx:189`, `SortingPage.jsx:61` and portal `TaskEditor.jsx:45`. Fix:
  drop the class (`index.css:86` already sets smooth) and add a helper that returns `'auto'` under reduced
  motion.
- **C4. High. Fixed px font sizes ignore the reader's text size.** 59 `text-[Npx]` on the public site (9 to
  15px, for example `GalleryPage.jsx:284`, `MagazinePage.jsx:79`, `Navbar.jsx:141`) and 38 in the portal
  (`Avatar.jsx:9`, `workUi.jsx:43`, `AlbumEditorPage.jsx:320`, `RosterPage.jsx:74`, `AuditLogPage.jsx:83`).
  Fix: `fontSize` tokens `'2xs': ['0.6875rem', { lineHeight: '1rem' }]` and
  `'3xs': ['0.625rem', { lineHeight: '0.875rem' }]`; 11px to `2xs`, 9 to 10.5px to `3xs`, 15px to
  `text-[0.9375rem]`.
- **C5. High. No `prefers-contrast` or `prefers-reduced-transparency` support anywhere.** Fix: in
  `index.css`, raise `--line-k` and the soft-text floor under `prefers-contrast: more`; add a
  `reduce-transparency` variant and solid fallbacks on the blurred panels (`GalleryPage.jsx:90` and `:378`,
  `Hero.jsx:52`, `IfmsaSections.jsx:16`, `BackButton.jsx:23`).
- **C6. Medium. Hover effects stick after a tap on phones.** Fix: `future: { hoverOnlyWhenSupported: true }`
  in `tailwind.config.js`.
- **C7. Medium. Errors show raw server text.** Public: `CheckoutPage.jsx:402-406` and
  `ShareStoryPage.jsx:209-212` append ". Please try again" (a doubled full stop, and "try again" on refusals
  a retry can't fix), show "Failed to fetch", and have no `role="alert"`. Portal: `ProfilePage.jsx:233`,
  `NotificationsPage.jsx:61`, `NotificationBell.jsx:167`, `DirectoryPage.jsx:51`, `VerifyPage.jsx:133`,
  `DashboardPage.jsx:184`, `ExportButtons.jsx:31`. Fix: one `errorText(err, fallback)` helper. Refusals
  (`error.rejected`, `supabaseRest.js:52`) as written; network failures as "We couldn't reach the server.
  Check your connection and try again."; permission errors in plain words.
- **C8. Medium. "Saved." or "Published" stays after new edits and hides unsaved changes.**
  `ProfilePage.jsx:131,143,232`, `PageEditor.jsx:82,159,414`, `ContentEditorPage.jsx:85-91,172`, and
  `PaymentMethodsPanel.jsx` has no unsaved marker. Fix: show the message only while the form is clean,
  otherwise "Unsaved changes".
- **C9. Medium. The same switch commits two ways.** `Toggle` saves at once on Site settings, gallery
  Published and magazine status, but waits for Save on Profile (`ProfilePage.jsx:219`), `PostEditor.jsx:194`
  and payment methods (`PaymentMethodsPanel.jsx:81`). Fix: `Toggle` only for instant settings, in their own
  panel; checkboxes inside forms that need saving.
- **C10. Medium. Switches and selects wait for the server before moving, and dim every sibling.**
  `SiteSettingsPage.jsx:144-152`, `EventEditorPage.jsx:363-368`, `SubmissionsPage.jsx:166,357,475`,
  `AlbumEditorPage.jsx:389,464`. Fix: optimistic `setQueryData` in `onMutate`, roll back in `onError`, busy
  only on the row being saved (`isPending && variables?.id === row.id`).
- **C11. Medium. The portal loading spinner is `min-h-screen` inside the layout** (`portalUi.jsx:9-15`,
  about 20 pages), so it sits half a screen down. Fix: a `PageLoading` with `py-16` for in-layout use.
- **C12. Medium. Weak focus on portal fields.** `inputCls` (`portalUi.jsx:85`) and `smallInputCls`
  (`workUi.jsx:200`). Fix: `focus-visible:ring-2 focus-visible:ring-medical/60`.
- **C13. Low-medium. ConfirmButton changes width when armed and the armed state isn't announced**
  (`portalUi.jsx:230-253`). Fix: both labels in one grid cell, plus an `aria-live="polite"` screen-reader
  span. Replace the hand-made copies in `MembersPanel.jsx:207-230` and `PositionTypesPanel.jsx:58-70`.
- **C14. Low-medium. Drag-to-order drop jumps** (`SortableList.jsx:163-175`). Fix: a FLIP settle over
  200 ms `cubic-bezier(.2,0,0,1)`, skipped under reduced motion; Escape cancels a pointer drag.

## 2. High: lost work and hard-to-undo actions

- **H1. Magazine "Replace pages from a PDF" writes over the live edition in place**
  (`magazineQueries.js:126-135,168-185`, `IssueEditorPage.jsx:140-150`). Same file names with a one-year
  cache; a failure at page k leaves old and new pages mixed, and `page_count` is only patched on success.
  Fix: upload to a new folder (`${id}/pages-${Date.now()}`), patch `pages_base` and `page_count` at the
  end, then delete the old folder. Until then: a ConfirmButton "Click again to replace all N pages".
- **H2. Magazine edition details are wiped by any refetch** (`IssueEditorPage.jsx:52-54`): a status pill,
  cover click or page upload resets typed text. Fix: follow the row only when the form is clean, as
  `ProductEditorPage.jsx:63-72` does, plus "Undo changes".
- **H3. Content editor: an image upload reverts edits made while it ran** (`RecordEditor.jsx:90,173,316`,
  a stale `onChange` closure). Fix: functional updates, `setDoc((d) => setPath(d, path, value))`.
- **H4. Submissions: changing a status on the "New" filter unmounts the card and loses unsaved notes**
  (`SubmissionsPage.jsx:141,168,510`). Fix: keep touched rows visible until the filter changes, with
  "Moved to Contacted. Undo".
- **H5. Open calls: a half-written call is lost on a tab switch, Back or Cancel**
  (`CommitteeEditorPage.jsx:229`, `CallsPanel.jsx:274-293,364,621`). Fix: keep the panel mounted but hidden,
  like the Committee page tab, and confirm "Discard changes" when dirty. Same Cancel check in
  `TaskEditor.jsx:277` and `PostEditor.jsx:202`.
- **H6. Officer notes on a member delete in one click and fail silently** (`MembersPanel.jsx:83-90,108`).
  Fix: ConfirmButton, and show `remove.error`.
- **H7. Roster sheet sync: "Turn off" is one click and its error is never shown; "Issue a new token"
  silently switches off the old one** (`RosterPage.jsx:546-552`). Fix: ConfirmButton on both while a token
  is active; send revoke errors through `setError`.
- **H8. Task page: one error slot under the comment box for status, file and delete errors**
  (`TaskPage.jsx:110,164-171,278`). Fix: an error per region.
- **H9. No 404 page.** `App.jsx:116` sends `*` to Home and `CommitteePage.jsx:27` does the same for unknown
  slugs; `vercel.json` serves 200, so search engines see soft 404s. Fix: a NotFound page with links and
  `noindex`.
- **H10. Leaving the page kills gallery and magazine uploads without a warning**
  (`AlbumEditorPage.jsx:123-184`, `IssueEditorPage.jsx:132-163`). Fix: `beforeunload` while busy, as
  `ContentEditorPage.jsx:69` does, and disable the back link.

## 3. Public site, medium and low

Motion

- `.reveal` (0.9 s) overrides card hover transitions, so hover lifts are slow and borders snap:
  `About.jsx:94`, `ExecutiveBoard.jsx:30`, `ProductCard.jsx:32`, `TeamOfficials.jsx:72`, `MerchPage.jsx:17`.
  Put `.reveal` on a wrapper.
- The gallery lightbox swipe doesn't follow the finger, has no direction lock and ignores flicks
  (`GalleryPage.jsx:486-494`). Pointer events, `touch-action: pan-y`, lock after 10px, commit at 20% of the
  width or 0.5 px/ms.
- The lightbox and ApplyModal appear and vanish instantly (`GalleryPage.jsx:497`, `ApplyModal.jsx:124-125`).
  Entry with `@starting-style`: scrim 200 ms, panel from `translateY(8px) scale(.98)` over 240 ms; opacity
  only under reduced motion.
- The mobile menu animates `max-height` with no reduced-motion fallback (`Navbar.jsx:363`). Opacity and
  translate over 220 ms, `motion-reduce:transition-none`.
- The cart drawer still slides under reduced motion, and isn't `inert` when closed, so Tab reaches it
  (`CartDrawer.jsx:51`).
- ImageTrail's frame loop never stops after the first mouse move (`ImageTrail.jsx:100-112`).
- Width and `transition-all` animations: `MembersPage.jsx:55` (bar width), `Navbar.jsx:132,234`.

Materials and type

- Stat-grid dividers are invisible in the light theme (`Hero.jsx:48,52`, `IfmsaSections.jsx:12,16`): stacked
  translucent fills only 2/255 apart. Wrapper `bg-line/10`, cells `bg-page/80`.
- The nav bar has a border and a shadow stacked (`Navbar.jsx:236`). Keep one edge; a translucent bar with a
  solid fallback is optional; keep the menus opaque.
- `font-light` leads on cream read thin (`Hero.jsx:31,68`, `CommitteePreview.jsx:68`,
  `GalleryPage.jsx:99,208,348`, `EventsPage.jsx:71`, `MerchPage.jsx:203,313`, `CheckoutPage.jsx:196`,
  `IFMSAHistoryPage.jsx:205`, `ShareStoryPage.jsx:80`). Use `font-normal dark:font-light`.
- `text-accent/80` falls below AA (`GalleryPage.jsx:104`, `SortingPage.jsx:218`). Use `text-accent`.
- `.heading-serif` applies -0.025em at every size (`index.css:135`), including 35 small headings. Set
  tracking per size in the `fontSize` scale.
- Inter is loaded without its optical-size axis (`index.html:55-58`). Use `Inter:opsz,wght@14..32,300..700`.
- `BackButton.jsx:23` blurs behind an opaque fill; `Navbar.jsx:193` uses a px threshold of 96 for a rem
  header.

Foundations

- Form errors appear only on submit and don't clear on edit (`ShareStoryPage.jsx:42-57`,
  `CheckoutPage.jsx:96-124`).
- "Check my status" with empty fields does nothing (`MembersPage.jsx:207`); its labels lack `htmlFor`
  (`:299-322`); results aren't in a live region and can show "(Request failed (500))" (`:343,422-485`).
- The green "Members" header button opens the lookup, while portal sign-in is only in the footer
  (`Navbar.jsx:320-329,433-438`, `Footer.jsx:56,62`). Rename it "Check membership" and add a "Members
  portal" link on `/members`.
- In the apply modal, a backdrop click or Escape throws away the typed application
  (`ApplyModal.jsx:121-124`, `useFocusTrap.js:35-37`). Keep the draft, or don't close on the backdrop when
  dirty. Matters once open calls go live.
- The Magazine and Members pills use `Link`, not `NavLink`, so they show no active state
  (`Navbar.jsx:302,320`).

## 4. Portal, medium and low

Shell and shared UI

- Weak "you are here" in the nav, and the underline animates `width` (`PortalLayout.jsx:23-31`).
- Field labels are styled like panel titles (`portalUi.jsx:54,106`). Use `text-sm font-medium text-ink` for
  fields.
- The bell panel says `role="dialog"` but keeps focus on the bell (`NotificationBell.jsx:107`), and appears
  instantly (`:104`).

Admin

- Verification: Decline is one click next to Approve, the row vanishes with no message, and the busy label
  shows only on Approve (`VerificationQueuePage.jsx:44-58,86-100`).
- Site settings: one "Saved." line at the page bottom, never cleared, no role (`SiteSettingsPage.jsx:201-202`).
  Put the status under the switch and clear it after about 4 s.
- `domainEmailsLive` turns on in one click though mail bounces if forwarding isn't set up
  (`SiteSettingsPage.jsx:51-56`). Ask for a second click when turning it on only.
- New term: a disabled Start gives no reason (`RolloverPage.jsx:295-307`).
- Upgrades "Not now" hides members until September with no undo (`RosterUpgradesPanel.jsx:57,122-127`).
- A successful bulk undo is shown in warning amber (`RosterBulkPanel.jsx:110-115,137`). Roster save and
  remove give no completion message, and a new member isn't shown (`RosterPage.jsx:119-127,371`).
- Position types: a hand-made confirm, what removing does is only in a tooltip, and a 24px target
  (`PositionTypesPanel.jsx:58-70,118-133`).

Committees, tasks, updates

- The photo upload in the page editor isn't keyboard reachable (`PageEditor.jsx:455-472`). Copy
  `FileChooser` from `TaskFiles.jsx:55-75`.
- Validation runs on submit, away from the field (`CallsPanel.jsx:318`, `TaskEditor.jsx:72`,
  `PostEditor.jsx:52-63`), and nothing checks that a scheduled time is in the future.
- Calls labels aren't tied to their inputs; position and question inputs have only placeholders
  (`CallsPanel.jsx:372-548`).
- Up to five files upload behind one "Saving…" (`TaskEditor.jsx:275`, `workQueries.js:259-264`). Show
  "Uploading 2 of 5: file.pdf".
- `[color-scheme:dark]` on the calls date input gives a dark picker in the light theme (`CallsPanel.jsx:438`).
- Tabs and sub-views aren't in the URL (`CommitteeEditorPage.jsx:120`, `CallsPanel.jsx:104`,
  `TasksPage.jsx:97`, `UpdatesPage.jsx:148`, `TaskPage.jsx:107`). Use `?tab=`.
- Every update card says "Deleting…" during one delete (`UpdatesPage.jsx:243`).
- "Publish call" is shown for drafts (`CallsPanel.jsx:632`); a raw status code is shown
  (`MembersPanel.jsx:257`).

Content, events, submissions

- "N things need fixing above" doesn't take you there (`ContentEditorPage.jsx:76-78,166-169`).
- Removing a row is instant with no undo, and Undo throws away all edits (`RecordEditor.jsx:204-208`,
  `ContentEditorPage.jsx:142-146`, `ScheduleFields.jsx:184`).
- Event errors show as one sentence beside the button, and Add event is disabled with no reason
  (`EventsPanel.jsx:41,93,96`, `EventEditorPage.jsx:209-214`).
- The event card preview only updates after Save (`EventEditorPage.jsx:383-385`).
- Switching the event kind and back loses days 3 and on, and each day's hours (`eventSchedule.js:52,56,109`).
- Choosing Published in a select publishes a story at once, before its tidy-up fields appear
  (`SubmissionsPage.jsx:166,437`); "Live" and "Published" are both used (`:420`).
- Removing an event picture deletes the file at once (`EventEditorPage.jsx:249-255,297`); its busy label is
  "Working…" (`:294`).
- The preview auto-scroll misses some manual scrolls (overlay scrollbars, find-in-page) and runs twice as
  fast at 120 Hz (`usePreviewFollow.js:84,164-174`). Add a scroll listener that stops when
  `|scrollTop - lastWritten| > 2`, and use `k = 1 - 0.66 ** (dt / 16.7)`.

Gallery, magazine, merch

- One photo action locks the whole grid, and errors show at the top of the panel
  (`AlbumEditorPage.jsx:389,436,464`).
- A failed merch reorder still shows the new order (`merchQueries.js:84`). Copy the gallery's optimistic
  reorder with rollback (`galleryQueries.js:128-146`).
- The magazine shelf reorders with arrow buttons and N sequential writes (`MagazinePage.jsx:129-146`,
  `magazineQueries.js:82-87`). Use `SortableList`.
- "Create and add photos" doesn't open the album (`GalleryPage.jsx:85,187-190`).
- Archive and "contacted" make rows vanish with no undo line (`GalleryPage.jsx:155`, `OrdersPanel.jsx:125`).
- Confirms the wrong way round: removing an unsaved payment-method row asks twice
  (`PaymentMethodsPanel.jsx:140-145`), while the size chart Remove deletes the stored file at once
  (`ProductEditorPage.jsx:245-249`). Errors on a new payment row show before you type (`:99,125`).
- Failed uploads can't be retried (`AlbumEditorPage.jsx:149-153,181`); closing the share sheet says "Copy
  failed" (`galleryUi.jsx:32`).
- Delivered orders fade the whole row, controls included (`OrdersPanel.jsx:60`).

## 5. Rules that don't apply here

Springs, velocity handoff, momentum projection and rubber-banding: the site has no draggable sheets or
carousels of its own, and the flipbook's page curl belongs to its library. No spring library is needed;
every fix above is CSS or a small handler. "Use the system font" doesn't apply: Cormorant and Inter are the
brand. Nor does glass everywhere: the solid hairline cards suit the brand.

## 6. Already good

- `SortableList`: drag handle, pointer capture, grab offset kept, 1:1 tracking, edge scrolling, keyboard
  ordering with announcements.
- ConfirmButton instead of browser dialogs, disarming after 5 s, on blur and on Escape. The gallery bin is a
  soft delete with Restore.
- Bulk roster updates: review before apply, named batches, an undo history. New term is one all-or-nothing
  call with a summary.
- Aurora pauses off-screen; the ECG hero, flipbook and GSAP result honour reduced motion; the preview
  follow yields on the first manual scroll.
- Theme tokens keep soft text at AA in both themes; fluid rem root; 16px input floor; tabular figures.
- Checkout focuses the first invalid field and guards against double orders; sign-in errors use
  `aria-invalid` and `aria-describedby`.
