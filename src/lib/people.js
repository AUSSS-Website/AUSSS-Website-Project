// Who holds each officer and board position this term: one snapshot, live from
// the database.
//
// The names and photos on the public pages used to come from
// src/data/society.js alone. Now the profile of whoever holds the position is
// the source (they edit their name and photo in the portal), and the file is
// the fallback for a position nobody has claimed with an account yet. The
// site reads rpc/people_public(): position key, name, chosen photo, nothing
// else. Same loading order as the gallery (src/lib/gallery.js): the snapshot
// the build baked in, else the last one this browser saw, then the live
// document replaces both.
//
// A position is matched by its key in the database (`positions.key`):
//   the board      eb.president, eb.vp-internal, eb.vp-external, eb.secretary-general
//   an officer     <committee slug>.<alias>, e.g. scope.leo-out, score.lore
import { useEffect, useMemo, useState } from 'react'
import { restRpc, supabaseRestEnabled } from './supabaseRest.js'
import { readJson } from './localCache.js'
import { executiveBoard, slugFor } from '../data/society.js'
import { normalize } from './text.js'
import { driveImg } from './img.js'

const CACHE_KEY = 'ausss-people-snapshot'
const GLOBAL_KEY = '__AUSSS_PEOPLE__'
const AVATARS_BASE = `${(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')}/storage/v1/object/public/avatars/`

const BOARD_KEYS = {
  president: 'eb.president',
  vpi: 'eb.vp-internal',
  vpe: 'eb.vp-external',
  secgen: 'eb.secretary-general',
}

// [{ key, name, photo }] with the photo as a full address ('' when none).
export function peopleFromSnapshot(doc) {
  const list = doc && Array.isArray(doc.people) ? doc.people : []
  return list
    .filter((p) => p && p.key && p.name)
    .map((p) => ({
      key: String(p.key),
      name: String(p.name),
      photo: p.photo ? AVATARS_BASE + String(p.photo) : '',
    }))
}

export async function fetchPeople() {
  if (!supabaseRestEnabled) return []
  return peopleFromSnapshot(await restRpc('people_public', {}))
}

// Used by entry-server.jsx: the prerender fetched the holders once.
export function setBakedPeople(people) {
  globalThis[GLOBAL_KEY] = people
}

function initialPeople() {
  const baked = typeof globalThis !== 'undefined' ? globalThis[GLOBAL_KEY] : null
  if (Array.isArray(baked)) return baked
  return readJson(CACHE_KEY, [])
}

// The holders, refreshed live. An empty list simply means every page shows
// the entries of society.js.
export function usePeople() {
  const [people, setPeople] = useState(initialPeople)

  useEffect(() => {
    if (!supabaseRestEnabled) return
    let alive = true
    fetchPeople()
      .then((live) => {
        if (!alive) return
        setPeople(live)
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify(live))
        } catch {
          /* cache write is best-effort */
        }
      })
      .catch(() => {
        /* keep whatever we had: baked or cached */
      })
    return () => {
      alive = false
    }
  }, [])

  return people
}

// The same person under two spellings ("Hassan Haitham" in the file, "Hassan
// Haitham Abdelkader" on the profile): the first name agrees and so does the
// second, where both have one.
function samePerson(a, b) {
  const x = normalize(a).split(' ').filter(Boolean)
  const y = normalize(b).split(' ').filter(Boolean)
  if (!x.length || !y.length || x[0] !== y[0]) return false
  return x.length < 2 || y.length < 2 || x[1] === y[1]
}

// One static entry with its holder laid over it. The holder's name always
// wins. The photo is the one they chose; without one, the file's photo stays
// only while it is still the same person (a new holder must never appear under
// their predecessor's face). `personal` lists the fields of the static entry
// that belong to the person, not the role, and go when the person changes.
function withHolder(entry, holder, personal = []) {
  if (!holder) return entry
  const same = samePerson(entry.name, holder.name)
  const next = { ...entry, name: holder.name }
  if (holder.photo) next.photo = holder.photo
  else if (!same) next.photo = ''
  if (!same) for (const field of personal) delete next[field]
  return next
}

const firstHolder = (people, key) => people.find((p) => p.key === key)

// The Executive Board of society.js with this term's holders laid over it.
export function resolveBoard(people) {
  if (!people.length) return executiveBoard
  return executiveBoard.map((m) =>
    withHolder(m, firstHolder(people, BOARD_KEYS[m.alias]), ['candidature']),
  )
}

// A committee's officers as the pages render them: [{ name, abbr, photo,
// email, alias, role }]. Multi-officer committees list them in `officers`;
// single ones are described by `officer` / `officerAbbr` / `holder`.
//
// `overridePhoto` is the officer photo set on the committee page editor. It
// applies to the lead officer and sits between the two sources: a photo the
// holder chose on their profile beats it, the file's photo does not.
export function committeeOfficers(c, people = [], overridePhoto = '') {
  const slug = slugFor(c)
  const base =
    Array.isArray(c.officers) && c.officers.length > 0
      ? c.officers
      : [{ name: c.holder, abbr: c.officerAbbr, photo: c.photo, email: c.email, alias: c.alias, role: c.officer }]
  return base.map((o, i) => {
    const holder = o.alias ? firstHolder(people, `${slug}.${o.alias}`) : null
    const resolved = withHolder(o, holder)
    if (i === 0 && overridePhoto && !(holder && holder.photo)) {
      return { ...resolved, photo: driveImg(overridePhoto) }
    }
    return resolved
  })
}

export function useBoard() {
  const people = usePeople()
  return useMemo(() => resolveBoard(people), [people])
}
