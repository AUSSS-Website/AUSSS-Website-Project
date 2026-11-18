import { BLOCKS } from './sitting.js'

// A student's contract preferences, worked out without React or the network:
// what the screen offers, what a tap does to the list, and the sentence for a
// list the database would refuse. The rules are the database's
// (supabase/migrations/20261118120001_exam_contracts.sql) and it checks them
// again on every save; they are repeated here so a student is told at the tap
// and not after it. preferences.test.js proves each line.
//
// A contract is { id, programme: 'scope' | 'score', class: 'A' | 'B' | 'C',
// country, places, note }; `places` is how many contracts there are of it. A
// student's picks are one list of contract ids in their
// order; a contract's rank is its place among the picks of its own programme
// and class.

export const CLASSES = ['A', 'B', 'C']

// How many contracts of a class a student may choose in one programme.
export const CLASS_LIMIT = { A: 2, B: 2, C: Infinity }

const num = (value) => Number(value) || 0
const list = (value) => (Array.isArray(value) ? value : [])

// Whether the exam asks for preferences at all: it does when it has contracts.
export function hasContracts(exam) {
  return num(exam?.contracts?.scope) + num(exam?.contracts?.score) > 0
}

// rpc/exam_preferences' contracts, with anything that is not one left out.
export function tidyContracts(value) {
  return list(value)
    .filter(
      (c) =>
        c &&
        typeof c.id === 'string' &&
        c.id &&
        BLOCKS.includes(c.programme) &&
        CLASSES.includes(c.class) &&
        typeof c.country === 'string' &&
        c.country.trim() !== '',
    )
    .map((c) => ({
      id: c.id,
      programme: c.programme,
      class: c.class,
      country: c.country,
      places: Number.isInteger(c.places) && c.places > 0 ? c.places : 1,
      note: typeof c.note === 'string' ? c.note : '',
    }))
}

// The programmes a student chooses contracts from, in the page's order: the
// sections they ticked in an exam with the choice, both in any other; only
// those that have a contract.
export function offeredProgrammes(contracts, sits, choice) {
  return BLOCKS.filter((block) => (!choice || sits?.[block] === true) && list(contracts).some((c) => c.programme === block))
}

// One programme's contracts by class, in the officers' order; a class with no
// contract is left out: [{ class, contracts }].
export function classGroups(contracts, programme) {
  return CLASSES.map((cls) => ({
    class: cls,
    contracts: list(contracts).filter((c) => c.programme === programme && c.class === cls),
  })).filter((group) => group.contracts.length > 0)
}

const sameGroup = (a, b) => Boolean(a && b) && a.programme === b.programme && a.class === b.class

// The picks that share a contract's programme and class, in the student's order.
function groupPicks(contracts, picks, contract) {
  const byId = new Map(list(contracts).map((c) => [c.id, c]))
  return list(picks).filter((id) => sameGroup(byId.get(id), contract))
}

// A contract's rank among the student's picks of its programme and class, from
// 1; 0 when it is not chosen.
export function rankOf(contracts, picks, id) {
  const contract = list(contracts).find((c) => c.id === id)
  if (!contract) return 0
  return groupPicks(contracts, picks, contract).indexOf(id) + 1
}

// How many picks a programme's class holds.
export function chosenIn(contracts, picks, programme, cls) {
  return groupPicks(contracts, picks, { programme, class: cls }).length
}

// Whether one more contract of this one's class can be chosen.
export function canChoose(contracts, picks, id) {
  const contract = list(contracts).find((c) => c.id === id)
  if (!contract || list(picks).includes(id)) return false
  return groupPicks(contracts, picks, contract).length < CLASS_LIMIT[contract.class]
}

// A tap on a contract: chosen ones are taken out, others are added last in
// their class. A tap on one that cannot be added changes nothing.
export function togglePick(contracts, picks, id) {
  const now = list(picks)
  if (now.includes(id)) return now.filter((other) => other !== id)
  return canChoose(contracts, now, id) ? [...now, id] : now
}

// Moves a chosen contract one place up (step -1) or down (step 1) among the
// picks of its programme and class. At either end it stays.
export function movePick(contracts, picks, id, step) {
  const now = list(picks)
  const contract = list(contracts).find((c) => c.id === id)
  if (!contract || !now.includes(id)) return now
  const group = groupPicks(contracts, now, contract)
  const other = group[group.indexOf(id) + (step < 0 ? -1 : 1)]
  if (!other) return now
  const a = now.indexOf(id)
  const b = now.indexOf(other)
  const next = [...now]
  next[a] = other
  next[b] = id
  return next
}

// The picks that can still stand: each once, of a contract that is on the
// list, in a programme the student is offered, and within its class's limit.
// What the phone holds is read through this after the list of contracts
// changes, or the sections do.
export function keptPicks(contracts, picks, programmes) {
  const byId = new Map(list(contracts).map((c) => [c.id, c]))
  const kept = []
  for (const id of list(picks)) {
    const contract = byId.get(id)
    if (!contract || kept.includes(id) || !list(programmes).includes(contract.programme)) continue
    if (groupPicks(contracts, kept, contract).length >= CLASS_LIMIT[contract.class]) continue
    kept.push(id)
  }
  return kept
}

// What is wrong with the preferences as they stand, in the database's own
// sentence, or '' when they can be saved. A student can sit without
// preferences, so no contract is ever asked for: only, in an exam with two
// optional sections, a section, since the paper sits the ones ticked here.
//   choice  the exam has two optional sections
//   sits    the sections ticked, { scope, score }
export function preferencesProblem({ sits, choice }) {
  return choice && !(sits?.scope || sits?.score) ? 'Choose at least one section.' : ''
}

// ---- the words ----------------------------------------------------------------

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth']

// 'first', 'second' ... 'tenth', then '11th' and so on.
export function ordinal(n) {
  const k = Math.floor(num(n))
  if (k >= 1 && k <= ORDINALS.length) return ORDINALS[k - 1]
  const tens = k % 100
  const end = tens >= 11 && tens <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[k % 10] || 'th'
  return `${k}${end}`
}

// What a class asks of the student, under its heading.
export function classRule(cls) {
  return CLASS_LIMIT[cls] === Infinity
    ? 'Choose as many as you like. The order you choose them in is your order of preference.'
    : 'Choose up to two. The one you choose first is your first choice.'
}

// How many contracts there are of one, under its country: '1 contract',
// '3 contracts'.
export function placesWords(contract) {
  const n = num(contract?.places) || 1
  return `${n} ${n === 1 ? 'contract' : 'contracts'}`
}

// How full a class is, beside its heading: '1 of 2 chosen', '3 chosen'.
export function classCount(cls, chosen) {
  return CLASS_LIMIT[cls] === Infinity ? `${chosen} chosen` : `${chosen} of ${CLASS_LIMIT[cls]} chosen`
}

// What a screen reader is told after a tap or a move.
export function pickNote(contracts, picks, id) {
  const contract = list(contracts).find((c) => c.id === id)
  if (!contract) return ''
  const rank = rankOf(contracts, picks, id)
  if (rank === 0) return `${contract.country} is no longer chosen.`
  return `${contract.country} is your ${ordinal(rank)} choice in Class ${contract.class}.`
}

// The line on the start card for a student whose preferences are saved.
//   preferences  the door's { saved, complete, scope, score, picks }
export function preferencesLine(preferences) {
  const n = num(preferences?.picks)
  if (n === 0) return 'You have chosen no contract. You can choose some until you start the exam.'
  return `You have chosen ${n} ${n === 1 ? 'contract' : 'contracts'}. You can change ${n === 1 ? 'it' : 'them'} until you start the exam.`
}

// The sections a paper will sit in an exam that has contracts and the choice:
// the ones the student ticked with their preferences.
export function chosenSections(preferences) {
  return { scope: preferences?.scope === true, score: preferences?.score === true }
}
