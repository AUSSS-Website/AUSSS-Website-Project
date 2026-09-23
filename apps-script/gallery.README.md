# Gallery photo takedown, a Google Apps Script web app

This lets the admin page (`/gallery/admin`) hide and restore gallery photos
**live for every visitor, without a redeploy**. The list of hidden photos is
stored by a small Apps Script web app; the public gallery reads it on load and
filters those photos out of every album, cover and count.

It is its own script, separate from the merch-orders one. About five minutes,
once.

## 1. Create the script

Go to <https://script.google.com>, **New project**. Delete the default
`myFunction`, then paste the entire contents of [`gallery.gs`](./gallery.gs).

No spreadsheet is needed: the hidden-photo list lives in the script's own
storage.

## 2. Set your admin key

At the top of the script, change:

```js
var ADMIN_KEY = 'change-me-to-a-long-random-string';
```

to a private password of your choosing (long and random is best). This is what
the admin page asks for before it lets anyone hide a photo. It is never part of
the website; only people you give it to can make changes.

Save (`Ctrl + S` / `⌘ + S`).

## 3. Deploy as a web app

**Deploy, New deployment, ⚙, Web app**

- **Description:** `AUSSS gallery takedown v1`
- **Execute as:** `Me`
- **Who has access:** `Anyone` (so the site can read the list without anyone
  logging in)
- **Deploy**

## 4. Authorise

The first deploy shows the OAuth prompt: pick your account, then on "Google
hasn't verified this app" choose **Advanced, Go to project, Allow**. It only
asks for permission to store its own script data, nothing about your Drive,
mail or sheets.

## 5. Copy the web app URL

It looks like `https://script.google.com/macros/s/AKfy…/exec`. Open it in a
browser tab: you should see `{"ok":true,"removed":[]}`. That is the live list,
empty to start.

## 6. Wire it into the site

In `src/data/galleryConfig.js`:

```js
export const GALLERY_WEBAPP_URL = 'https://script.google.com/macros/s/AKfy…/exec'
```

Commit and push; Vercel deploys it. This is the only redeploy you need. After
it, hiding and restoring photos is instant and never needs another build.

## 7. Use it

Visit `/gallery/admin`, enter your admin key, and click photos to hide them.
They vanish from the public gallery for everyone within seconds (visitors get
the fresh list on their next page load). Click again to restore.

## Notes

- **How writes work.** The admin key travels in a POST body, never in a URL,
  so it does not land in browser history or request logs. Because the browser
  cannot read an Apps Script POST reply, the script stores its answer under a
  one-time nonce and the page reads it back with a follow-up GET
  (`?action=claim&nonce=…`). Reads of the list are plain GETs.
- **Security.** The key gates writes; reads are public (the hidden list is not
  sensitive). The key lives only in the admin's browser session. Anyone with
  both the URL and the key can change the list, so treat the key like a
  password.
- **Editing later.** Edit `gallery.gs`, then **Deploy, Manage deployments, ✎,
  New version, Deploy.** The URL stays the same; nothing on the site changes.
- **Re-running the gallery pipeline** renumbers the photo files, so the hidden
  list stops matching. Review the new albums in `/gallery/admin` after every
  run and re-hide anything that must stay down.
- **Quotas.** Free, and well within Apps Script limits for this volume.
