import { useMemo } from 'react'
import { useCommittees } from './officerQueries.js'

// What the roster offers as "a committee".
//
// SCOPE and SCORE are two committees everywhere else (two public pages, two
// sets of officers), but they run exchange as one team: the assistants and
// members work for both, and the membership sheet files them under "Exchange".
// So on the roster they are one choice, "SCOPE/SCORE".
//
// A unit has the shape of a committee row ({ id, slug, abbr, ... }) so the
// roster's pickers take either, plus `ids`: every committee it stands for. For
// a merged unit `id` and `slug` are the home committee's, the first slug
// below. That is where a new member of the unit is filed and where its shared
// positions (everything below officer) live; an officer position keeps its own
// committee, so choosing LORE files the member under SCORE by itself.
//
// The database knows the same grouping as committees.roster_group (migration
// 20261005150001): the officers of the committees in a unit see one members
// list, hand out its positions below officer, share their notes and can give
// their tasks to the same people.

const MERGED = [{ label: 'SCOPE/SCORE', slugs: ['scope', 'score'] }]

export function rosterUnits(committees) {
  const units = []
  const done = new Set()
  for (const c of committees) {
    if (done.has(c.id)) continue
    const merged = MERGED.find((m) => m.slugs.includes(c.slug))
    const members = merged
      ? merged.slugs.map((slug) => committees.find((x) => x.slug === slug)).filter(Boolean)
      : [c]
    for (const m of members) done.add(m.id)
    units.push(
      members.length > 1
        ? { ...members[0], abbr: merged.label, ids: members.map((m) => m.id) }
        : { ...c, ids: [c.id] },
    )
  }
  return units
}

export const unitOf = (units, committeeId) =>
  (committeeId && units.find((u) => u.ids.includes(committeeId))) || null

// The label for a committee slug as stored in the bulk-update history.
export const unitLabelForSlug = (slug) =>
  MERGED.find((m) => m.slugs.includes(slug))?.label || String(slug || '').toUpperCase()

// A committee as its own Members and Invites tabs show it: the committee that
// was opened (its `id` is what the database is asked about; either committee
// of a unit gets the same answer), under the unit's name, with the unit's
// committees in `ids` and the home committee in `homeId`.
export function useRosterUnit(committee) {
  const all = useCommittees().data
  return useMemo(() => {
    if (!committee) return null
    const unit = unitOf(rosterUnits(all || []), committee.id)
    return unit
      ? { ...committee, abbr: unit.abbr, ids: unit.ids, homeId: unit.id }
      : { ...committee, ids: [committee.id], homeId: committee.id }
  }, [all, committee])
}

// The positions a unit hands out: every officer position of its committees,
// and the home committee's positions below officer (the other committee holds
// the same titles again). `current` keeps whatever the member holds today in
// the list even when it is one of those copies.
export function unitPositions(positions, unit, current) {
  if (!unit) return []
  return positions.filter(
    (p) =>
      unit.ids.includes(p.committee_id) &&
      (p.level === 'officer' || p.committee_id === unit.id || p.id === current),
  )
}
