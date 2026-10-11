// The society's age, counted by term. AUSSS was founded in 1971 and a term
// takes the anniversary that falls in it: 2025-26 was the 55th, 2026-27 is the
// 56th. So the number is the year the current term ends in, less 1971, and it
// moves on when the EB starts a new term (the portal's New term page), with
// nobody editing any text.
//
// Copy edited in the portal names the number with two placeholders, filled in
// when a page is drawn:
//
//   {years}        56
//   {anniversary}  56th
//
// Pure: no React, no network, so the pre-render and the tests use it as is.

export const FOUNDED = 1971

// Terms run from 1 September to 31 August.
const TERM_STARTS_IN_MONTH = 8 // September, counted from 0

// The year the term ends in: read from the term when we have it, else from
// the date, so a page drawn with the database unreachable is still right.
function endYear(term, now) {
  const fromTerm = Number(String(term?.ends_on ?? '').slice(0, 4))
  if (Number.isInteger(fromTerm) && fromTerm > FOUNDED) return fromTerm
  return now.getMonth() >= TERM_STARTS_IN_MONTH ? now.getFullYear() + 1 : now.getFullYear()
}

export function yearsOf(term, now = new Date()) {
  return endYear(term, now) - FOUNDED
}

// 56 → "56th", 61 → "61st", 112 → "112th".
export function ordinal(n) {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'}`
}

// What the placeholders stand for in the given term.
export function termVars(term, now = new Date()) {
  const years = yearsOf(term, now)
  return { years: String(years), anniversary: ordinal(years) }
}

// The text with its placeholders filled in. Anything else in braces is left
// as typed.
export function fillText(text, vars) {
  if (typeof text !== 'string' || !vars || !text.includes('{')) return text
  return text.replace(/\{(years|anniversary)\}/g, (whole, name) => vars[name] ?? whole)
}
