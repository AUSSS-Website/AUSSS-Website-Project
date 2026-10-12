# The website guide

One PDF that explains every page of the site and every part of the portal, with a picture
of each. It is built from this folder, so that it can follow the site: when a page
changes, the pictures are taken again and the book is printed again.

```sh
npm run dev            # in another terminal: the pictures are taken from localhost:5173
npm run guide          # take every picture, then print the book
npm run guide:shots    # the pictures alone
npm run guide:build    # the book alone, from the pictures already taken
```

The book is `docs/guide/out/AUSSS-website-guide.pdf`. Everything under `docs/guide/out/`
is made by these commands and is not in the repository.

## What is where

| Path | What it is |
| --- | --- |
| `guide.json` | The title, the parts in order with a line about each, and the names of the roles |
| `chapters/NN-name.md` | One chapter each, in the order of their file names |
| `shots.manifest.mjs` | Every picture: its address, how it is taken, its caption |
| `theme/print.css` | How the book looks on paper |
| `out/shots/` | The pictures, and `out/shots.json`, which says when each was taken |
| `out/guide.html` | The book as one web page, to read in a browser while writing |
| `scripts/guide/shots.mjs` | Takes the pictures |
| `scripts/guide/build.mjs` | Checks the chapters and prints the book |

## The pictures

`npm run guide:shots` opens the site once for each entry of `shots.manifest.mjs` and saves
`out/shots/<id>.jpg`. The top of that file explains every setting an entry can have.

- **Two worlds.** A public page is opened as a visitor and shows the real site. Whatever
  it tries to write to the database is held back (`scripts/walk-guard.mjs`), and the
  command lists what it held back when it ends. A portal page or an exam page is opened
  with the made-up session of `scripts/portal-sample.mjs`: nobody is signed in, every row
  is a sample and every name is invented. That is what makes the book safe to hand to any
  officer. A public page that needs made-up rows to have something to show (the events,
  an archived album, the shop's cart) is taken with `world: 'sample'`.
- **A new portal screen** is first given sample rows in `scripts/portal-sample.mjs`, as
  for the portal sample walk (RUNBOOK section 21), and then an entry in the manifest.
- **A screen that shows only after a tap** has a `do` in its entry. A route of the sample
  that ends in `#name` already has its taps in `acts` there, and they are done first.
- **Real data moves.** The public pictures show the site as it was on the day: a new
  album or a new board member changes them. Take them again before a printing that
  matters.
- **Some of them at a time:** `npm run guide:shots -- --only roster,exam` takes the shots
  whose id starts with either word, and `--list` prints the ids. In Git Bash an argument
  that starts with a slash is rewritten into a path; none of these do.

## The chapters

A chapter is a Markdown file with a few lines of front matter:

```md
---
title: The home page
part: 2
roles: visitor
routes: /
---

## The first screen

A paragraph or two.

![](shot:home-hero)
```

- `part` is an `id` from `guide.json`. `roles` are keys of its `roles` and become the
  labels under the chapter's title; `routes` are printed beside them.
- `##` opens a section and `###` a smaller one. The chapter's title is in the front
  matter, so there is no `#` line.
- A line that is only `![](shot:<id>)` places that picture, with the caption the manifest
  gives it and a number. Words between the square brackets replace the caption there.
- A line that starts `TODO:` is a section nobody has written yet. It is printed as such,
  the cover counts them and calls the book a draft while there are any.
- A quotation that starts `Note:` or `Careful:` becomes a box.
- The words follow the site's own style: sentence case, British spelling, no em-dashes.

`npm run guide:build` refuses to print when a chapter names a picture the manifest does
not have, has an em-dash, or opens a section with `#`. It only remarks on a picture that
has not been taken yet (the page shows a dashed box in its place), on a picture no chapter
uses, and on an -ize spelling.

## Checking a printing

`npm run guide:build -- --sheets` also draws every page small, twelve to a sheet, in
`out/preview/`: enough to see a figure in the wrong place or a page left half empty.
`-- --pages 1,2,14` draws those pages large enough to read. `-- --html` stops at
`out/guide.html`.

The contents page needs page numbers that only the printed PDF knows, so the book is
printed twice: the first printing's bookmarks give each chapter's page, and the second
carries them. The command stops if the two printings disagree.

The headings are set in Cormorant Garamond and the text in Inter, both fetched from Google
Fonts as the site does. Without a connection the book still prints, in the fonts the
computer has, and the command says so.

## What it must never do

- The PDF is for officers and the board. It does not go under `public/`, which is served
  to everybody.
- The pictures of the portal come from the sample, never from a signed-in session. A
  picture of the real roster, of real orders or of a real exam hall has no place in a
  file that is passed around.
