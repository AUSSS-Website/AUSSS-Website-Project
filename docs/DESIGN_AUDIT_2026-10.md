# Design audit, October 2026

## Status, 2026-10-11

The audit below is left as it was written on 2026-10-08, with its line numbers from main
`86b5004`. It was worked through in two stages on the branch `apple-design-pass`: stage 1
(commit `ea5dab3`) did the shared pieces of section 1, and stage 2 did the pages, each area
worked by one agent and then read again by a second. This section says where every numbered
finding stands. The rules a new page follows are in `docs/RUNBOOK.md` section 24.

How it was checked: headless Chromium scripts against made-up sessions and data, in both
themes from 320 to 1920 px, with the keyboard, reduced motion and axe for contrast, and the
unit tests. Not done when this was written: `npm run walk` and `npm run walk:portal-sample`
over the result, anything signed in against the real database, a real phone, and Safari or
Firefox.

| Finding | Status | What was done, and what is left |
| --- | --- | --- |
| C1 | Fixed | `ConfirmButton` ignores a second click within 500 ms of the first, and a held Enter counts once. New term keeps Start off until the new term's name is typed and says "This cannot be undone." beside it. |
| C2 | Fixed | `pressCls` (`src/lib/motion.js`: colours ease over 150 ms, the button sinks to 0.97 while pressed) is in `<Button>`, the portal's pill and chip classes and the hand-typed buttons. Left: with reduced motion on a touch screen a press shows nothing unless the button has an `active:` colour of its own, as the exam's buttons and the photo viewers' have, and a disabled portal pill still sinks. |
| C3 | Fixed | `scroll-smooth` is gone from `index.html` and every scroll asks `scrollBehavior()`. No `behavior: 'smooth'` is left in `src`. |
| C4 | Partly fixed | `text-2xs` and `text-3xs`, in rem, replaced the px sizes. Left: six px sizes in `SpecialResult.jsx`, the two bespoke lookup cards. |
| C5 | Fixed | Under `prefers-contrast: more`, `index.css` strengthens lines and muted text. The variant `reduce-transparency:` exists and every blurred panel and scrim has a solid fallback. The stat grids and the Back button lost their blur instead, since nothing passed behind them. |
| C6 | Fixed | `future: { hoverOnlyWhenSupported: true }` in `tailwind.config.js`. |
| C7 | Fixed | `errorText(err, fallback)` (`src/lib/errorText.js`). The checkout and the story form get their sentence from `src/lib/orders.js` and `stories.js`, which return it; the seven portal files named call it, and so do the portal pages of stage 2. Left: `src/lib/membership.js` hands back the raw message, which `MembersPage.jsx` rewords, and `exportFile.js` throws its two font sentences unmarked, which `ExportButtons.jsx` recognises itself. |
| C8 | Fixed | `SaveStatus` says "Unsaved changes" while a form differs from what is stored and the saved wording only while it is clean, on the four forms named and on the other portal forms that wait for Save. |
| C9 | Fixed | A choice that waits for Save is a `CheckField` tick box: the daily digest, Pin to the top, On the checkout, and the yes or no fields of the content editor. `Toggle` is left only on settings that save at once. |
| C10 | Fixed | Site settings, an event's Published switch, a submission's status and an album's switches and photo actions show the change at the click, go back with a sentence if the save fails, and dim nothing beside them. The same was done for merch, the magazine's status and cover, and the exam's Open to students. Left: `useUpsertSiteSetting` does not cancel a settings read already on its way, so the checker noted a rare race in which a switch shows its old position though the new one is saved. |
| C11 | Fixed | `PageLoading` is the in-layout loading state. `Centered` is left for a whole screen that is one message. |
| C12 | Fixed | `inputCls` and `smallInputCls` carry `focus-visible:ring-2 focus-visible:ring-medical/60`. |
| C13 | Fixed | A default pill keeps the width of its longest wording (`keepWidth` for a pill with its own classes), and the armed wording is read out. The hand-made copies in `MembersPanel.jsx` and `PositionTypesPanel.jsx` are `ConfirmButton` now. Left: the armed red pill of the `text` variant is about 20px tall with no larger reach, so pages wrap it, and it cannot take a separate accessible wording. The content editor's "Discard draft" still asks with its own two buttons. |
| C14 | Fixed | A dropped, cancelled or key-moved row settles by FLIP over 200 ms on `cubic-bezier(0.2, 0, 0, 1)`, skipped under reduced motion, and Escape cancels a pointer drag (`SortableList.jsx`, with tests for `settleOffsets`). |
| H1 | Fixed | Every upload goes to a folder of its own, `<issue id>/pages-<time>`, and the edition is pointed at it only after the last page; a failure or Stop removes the new folder and changes nothing. The folder an edition has left is kept seven days and removed when an editor next opens the edition. No interim confirm was added. Left: tried against a stand-in for the bucket only. |
| H2 | Fixed | The edition form follows its row only while it is clean, and after a save takes the stored row only if nothing was typed meanwhile. "Undo changes" is there, with "Put them back". |
| H3 | Fixed | Every change is a functional update from the field up to `setDoc`, and list rows keep an identity, so a picture lands in the row it was chosen for. |
| H4 | Fixed | A row whose status changed stays in the list, with "Moved to Contacted. Undo", until a filter chip is chosen again. Left: typing in Search or choosing another filter still drops unsaved notes on cards that leave the list. |
| H5 | Partly fixed | Each tab of the committee editor stays mounted once opened, Cancel and "Back to calls" ask "Discard changes" when something was typed, the task and update forms do the same, and closing the tab asks. Left: a link inside the portal, or the browser's Back, still leaves a half-written form without asking, because `BrowserRouter` has no navigation blocker. |
| H6 | Fixed | Deleting an officer's note is a `ConfirmButton`, and `remove.error` is shown under the list. |
| H7 | Fixed | While a token is in use, "Turn off" and "Issue a new token" ask for a second click, and their errors show under them. "Disconnect" asks twice as well, which went beyond the finding. |
| H8 | Fixed | The task page has an error per region: under the status chips, under the file list, under the comment box and under Delete. |
| H9 | Partly fixed | `NotFoundPage.jsx`, with links and `noindex`, answers the catch-all route and an unknown committee. Left: the server still answers 200, since `vercel.json` hands the shell to every address, and the `noindex` tag is there only once JavaScript has run. A true 404 needs `vercel.json` and `scripts/prerender.mjs` (RUNBOOK section 15). Unknown album and event addresses are still answered by their own pages. |
| H10 | Fixed | `useLeaveWarning` asks before the tab is closed or reloaded while photos or pages upload, and the back link and Delete are switched off meanwhile. Left: the portal's own menu can still be used to leave. The uploads then carry on in the background, and only the progress list and any failures go out of sight. |

**Medium and low findings (sections 3 and 4).** All of them were taken up, and all but two
are fixed in the code. Not fixed, or fixed in another way than the audit proposed:

- **A translucent nav bar** (the audit called it optional): not done. The stacked border and
  shadow became one hairline and the bar stays solid, because section 5 says the solid
  hairline look suits the brand, and a see-through bar would need the contrast walk again.
- **The magazine shelf's N writes**: the shelf is a `SortableList` now, but no single call
  saves an order, so every row is still written. They are sent together, as the gallery's
  are, and a second drop waits for the first.
- **"Add event is disabled with no reason"**: fixed the other way round. The button is
  always pressable and points at the missing title, as the new task and new update forms
  do. The audit's wording was a dimmed button with a line saying why.
- **"Nothing checks that a scheduled time is in the future"**: done for an update's two
  times and for an open call's deadline. A due date in the past on a task is said and not
  refused, and an update that is already out may be given a take-down time that has passed,
  since that is the only way to retire it without deleting it.
- **The lightbox's `touch-action: pan-y`** is `pan-y pinch-zoom`, so a photo can still be
  pinched larger, as the old viewer allowed.
- **`font-light` leads**: the twelve the audit names are `font-normal dark:font-light`. The
  18px page leads were not on its list and now differ: some pages changed theirs, while the
  home sections, Contact, Privacy, IFMSA, the IFMSA history header and two of the portal's
  previews are still light. It wants one decision for the whole site.

**What the pass kept running into**, and left for a change in a shared file:

- A link inside the portal is never asked about (the remainder of H5 and H10). It needs a
  guard in `PortalLayout.jsx` or a router that can block.
- The shared classes are under 44px on a touch screen (`inputCls`, `primaryBtnCls`,
  `outlineBtnCls`, `Toggle`, the armed `text` variant of `ConfirmButton`, the pills of
  `ExportButtons.jsx`), so each page adds a `tapCls` or a wrapper of its own.
- A button that removes or disables itself drops the keyboard focus to the page body. It was
  repaired page by page, not in `ConfirmButton` or `UndoLine`.
- `useFocusTrap` runs again whenever a caller passes a new `onClose`, and hears keys only
  inside its container. The apply dialog works round both; the hook itself was left alone,
  because the other dialogs were being built against it.
- Much of the new pure logic has no unit test, because stage 2 could create no files:
  `callProblems`, `postTimeProblems`, `stalePagesFolders`, `issueErrorText`, the photo
  viewer's swipe maths and the form rules of the checkout and the story form. Each was
  checked from a scratch script instead.

---

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
