// The Sorting, a gentle personality quiz that places students into one of the
// six standing committees or four support divisions.
//
// How it works (and why it's honest):
//   Questions never ask about committees. Each option is a small, validated
//   self-description that loads onto one or more of eight TRAIT AXES, Holland's
//   six RIASEC vocational interests (R, I, A, S, E, C) plus two Big-Five facets,
//   Compassion (COM) and Openness (OPN). We accumulate the respondent's trait
//   profile, then match it by similarity to each committee's centroid (see
//   committeeProfiles.js). So no single answer "is" a committee, the overlap of
//   who you are does the sorting.
//
// Evidence base:
//   - Option wording is adapted from public-domain IPIP / RIASEC items (the
//     specific source item is named in a comment on each option group).
//   - Axis weights and the profile readout are anchored on real population norms
//     computed from openpsychometrics raw data (RIASEC ~145k, Big-Five ~1M); see
//     scripts/psychometrics/build_norms.py and src/data/psychometrics/norms.json.
//   - Committee centroids follow the validated interest×personality structure
//     (Hurtado Rúa, Stead & Poklar, 2019).
//
// Tone note: a gentle nod to a certain school's sorting ceremony, references
// stay subtle. Warm and human; for fun and self-reflection, not diagnosis.

import norms from './psychometrics/norms.json' with { type: 'json' }
import { committees } from './society.js'
import { AXES, AXIS_INFO, COMMITTEE_PROFILES } from './committeeProfiles.js'

export const STORAGE_KEY = 'ausss:sorting-result'

// Lines whispered while Dash deliberates, shown one at a time
// before the result. The final announcement ("Better be…") lives on the
// result screen itself.
export const REVEAL_LINES = [
  'Hold still… let me have a listen.',
  'Oh, there’s a lot going on in here…',
  'Plenty of heart. And a curious mind, too…',
  'Yes… I think I know where you’d feel at home.',
]

// Each option carries `loadings: { AXIS: weight }`. Positive = the choice is an
// indicator of that trait. The source comment names the IPIP/RIASEC item whose
// *content* the option is adapted from (see norms.json item-total correlations
// for why these items were chosen, they're the strongest indicators of their
// scale). Last question is weighted heavier on purpose.
export const QUESTIONS = [
  {
    question: 'What’s your favourite way to relax after a busy day?',
    options: [
      // I, investigative items ("conduct research"); OPN, "full of ideas"
      { text: 'Reading about or figuring out something I find interesting.', loadings: { I: 2, OPN: 1 } },
      // A, artistic items ("write a song / design artwork")
      { text: 'Making something creative, like a drawing, some writing, or a video.', loadings: { A: 2, OPN: 1 } },
      // S, "help people with problems"; COM, "sympathize with others' feelings"
      { text: 'A long, real conversation with someone I’m close to.', loadings: { S: 2, COM: 1 } },
      // C, "maintain records / keep things in order"
      { text: 'Tidying and organising things until they feel sorted.', loadings: { C: 2 } },
    ],
  },
  {
    question: 'Which of these tasks sounds most enjoyable to you?',
    options: [
      // R, realistic items ("fix a broken faucet / assemble parts")
      { text: 'Building or fixing something with my hands.', loadings: { R: 2 } },
      // I, "do research", "work in a lab"; C, the patience/rigour of it
      { text: 'Researching a question until I really understand it.', loadings: { I: 2, C: 1 } },
      // E, "manage operations"; S, "supervise / guide"
      { text: 'Getting a group of people organised and working together.', loadings: { E: 2, S: 1 } },
      // A, "design artwork / sets"
      { text: 'Designing how something looks and feels.', loadings: { A: 2, OPN: 1 } },
    ],
  },
  {
    question: 'Which of these would affect you the most emotionally?',
    options: [
      // COM, empathy items; S, helping
      { text: 'Seeing someone treated unfairly or ignored.', loadings: { COM: 2, S: 1 } },
      // S, "teach children to read"; I, the learning itself
      { text: 'Seeing someone finally understand something they struggled with.', loadings: { S: 2, I: 1 } },
      // C, order; E, a plan delivered
      { text: 'Seeing a plan you made work out exactly right.', loadings: { C: 2, E: 1 } },
      // A, expressive work
      { text: 'Hearing a song or seeing art that really moves you.', loadings: { A: 2, OPN: 1 } },
    ],
  },
  {
    question: 'You have a free afternoon with friends. What would you most enjoy?',
    options: [
      // OPN, "open to new experiences"; S, meeting people
      { text: 'Going somewhere new that none of you have been before.', loadings: { OPN: 2, S: 1 } },
      // I, investigate together; OPN, ideas
      { text: 'Having a deep discussion about a big question.', loadings: { I: 2, OPN: 1 } },
      // A, make; C, something that lasts/keeps
      { text: 'Making something together that you can keep.', loadings: { A: 2, C: 1 } },
      // S, "do volunteer work"; COM, care
      { text: 'Volunteering or helping out somewhere.', loadings: { S: 2, COM: 1 } },
    ],
  },
  {
    question: 'In a group project, which role do you naturally take?',
    options: [
      // C, "maintain records"; E, keep delivery moving
      { text: 'The organiser, who keeps track of the plan and deadlines.', loadings: { C: 2, E: 1 } },
      // I, the sceptical, evidence-seeking voice; C, wants it pinned down
      { text: 'The fact-checker, who asks whether it’s actually correct.', loadings: { I: 2, C: 1 } },
      // COM/S, notices who isn't heard
      { text: 'The one who makes sure everyone is included and heard.', loadings: { COM: 2, S: 1 } },
      // A, voice & look; E, make it land
      { text: 'The one who designs how it looks and presents it.', loadings: { A: 2, E: 1 } },
    ],
  },
  {
    question: 'Which of these statements do you agree with most?',
    options: [
      { text: 'Everyone deserves good care, no matter who they are.', loadings: { COM: 2, S: 1 } },
      { text: 'Important decisions should be based on solid evidence.', loadings: { I: 2, C: 1 } },
      { text: 'Good teaching shapes everything that comes after it.', loadings: { S: 2, I: 1 } },
      { text: 'How something is designed and presented really matters.', loadings: { A: 2, OPN: 1 } },
    ],
  },
  {
    question: 'Which kind of news story grabs your attention first?',
    options: [
      // I, "develop a new treatment", discovery; OPN
      { text: 'A new scientific discovery about the human body.', loadings: { I: 2, OPN: 1 } },
      // E, organising/mobilising; S, community
      { text: 'A community that came together to solve a problem.', loadings: { E: 2, S: 1 } },
      // COM, standing up for the vulnerable
      { text: 'People standing up for someone who was treated unfairly.', loadings: { COM: 2, S: 1 } },
      // A, design/campaign; E, reach
      { text: 'A clever, beautifully made campaign or design.', loadings: { A: 2, E: 1 } },
    ],
  },
  {
    question: 'Which of these would feel most satisfying to you?',
    options: [
      // C, "generate bills / keep records"; R, hands-on system
      { text: 'Taking something disorganised and making it run smoothly.', loadings: { C: 2, R: 1 } },
      // I, cracking the problem; C, methodical persistence
      { text: 'Solving a hard problem that no one else could.', loadings: { I: 2, C: 1 } },
      // S, "teach an exercise routine", mentoring; E, lifting them up
      { text: 'Helping someone improve and watching them succeed.', loadings: { S: 2, E: 1 } },
      // A, an audience reacting to your work
      { text: 'Creating something that gets a strong reaction.', loadings: { A: 2, OPN: 1 } },
    ],
  },
  {
    question: 'How do you usually approach new people and places?',
    options: [
      // OPN, "open to new experiences, complex"; S, sociability
      { text: 'I jump right in. The newer and more unfamiliar, the better.', loadings: { OPN: 2, S: 1 } },
      // I + OPN, curious about what makes them tick
      { text: 'I’m curious, and I like to watch how things work.', loadings: { OPN: 2, I: 1 } },
      // COM, watching for whoever's struggling
      { text: 'I look out for anyone who seems lost or left out.', loadings: { COM: 2, S: 1 } },
      // E + C, sizing up how it could run better
      { text: 'I notice how things could be run or organised better.', loadings: { E: 2, C: 1 } },
    ],
  },
  {
    question: 'When something goes wrong, what’s your first reaction?',
    options: [
      // COM, "feel others' emotions"
      { text: 'I focus on how the people affected are feeling.', loadings: { COM: 2 } },
      // I, understand the cause
      { text: 'I try to understand exactly why it happened.', loadings: { I: 2 } },
      // E + C, rally people and a plan
      { text: 'I gather people and put together a plan to fix it.', loadings: { E: 2, C: 1 } },
      // R, fix the broken thing
      { text: 'I get hands-on and fix the problem directly.', loadings: { R: 2 } },
    ],
  },
  {
    question: 'Which compliment would mean the most to you?',
    options: [
      { text: '“You make people feel safe and supported.”', loadings: { COM: 2, S: 1 } },
      { text: '“You notice things that everyone else misses.”', loadings: { I: 2, OPN: 1 } },
      { text: '“You’re someone who gets things done.”', loadings: { E: 2, C: 1 } },
      { text: '“You create really beautiful things.”', loadings: { A: 2, OPN: 1 } },
    ],
  },
  {
    // Weighted heavier than the rest, the Sorting considers your choice.
    question: 'Last one. Looking back years from now, you’d be proudest of having been someone who…',
    note: 'This one counts a little more. Answer honestly.',
    options: [
      { text: 'Kept asking hard questions and searching for real answers.', loadings: { I: 3, OPN: 1 } },
      { text: 'Stood up for people who were overlooked or unheard.', loadings: { COM: 3, S: 2 } },
      { text: 'Built things, and helped people grow, in ways that lasted.', loadings: { E: 2, C: 2, S: 1 } },
      { text: 'Explored the world and came back with a wider perspective.', loadings: { OPN: 3, S: 1 } },
    ],
  },
]

// ── Scoring ───────────────────────────────────────────────────────────────
// Stable order for tie-breaking: position in the official committees list.
const ABBR_ORDER = committees.map((c) => c.abbr)

// Population SD per axis (1–5 metric) → inverse-variance axis weights, so a
// point on a low-variance trait (Openness, Compassion) counts for a little more
// than a point on a high-variance one. Weights are normalised to average 1.
const AXIS_SD = {
  R: norms.riasec.R.sd,
  I: norms.riasec.I.sd,
  A: norms.riasec.A.sd,
  S: norms.riasec.S.sd,
  E: norms.riasec.E.sd,
  C: norms.riasec.C.sd,
  COM: norms.bigfive.compassion.sd,
  OPN: norms.bigfive.openness.sd,
}
// sqrt keeps the weighting gentle (full inverse-variance over-tilts toward the
// two low-variance facets); weights still average 1.
const _w = (a) => Math.sqrt(1 / AXIS_SD[a])
const _wSum = AXES.reduce((s, a) => s + _w(a), 0)
const AXIS_WEIGHT = Object.fromEntries(
  AXES.map((a) => [a, _w(a) * (AXES.length / _wSum)]),
)

// Largest |loading| reachable on each axis (pick the most-loading option every
// question), used to normalise a raw score into roughly [-1, 1] so axes with
// more questions don't dominate.
const AXIS_MAXABS = (() => {
  const m = Object.fromEntries(AXES.map((a) => [a, 0]))
  for (const q of QUESTIONS) {
    const best = Object.fromEntries(AXES.map((a) => [a, 0]))
    for (const opt of q.options) {
      for (const [a, v] of Object.entries(opt.loadings || {})) {
        best[a] = Math.max(best[a], Math.abs(v))
      }
    }
    for (const a of AXES) m[a] += best[a]
  }
  for (const a of AXES) if (m[a] === 0) m[a] = 1
  return m
})()

// answers: array of chosen option indices, parallel to QUESTIONS.
function rawVector(answers) {
  const raw = Object.fromEntries(AXES.map((a) => [a, 0]))
  answers.forEach((optIdx, qIdx) => {
    const opt = QUESTIONS[qIdx]?.options[optIdx]
    if (!opt) return
    for (const [a, v] of Object.entries(opt.loadings || {})) raw[a] += v
  })
  return raw
}

// Normalised respondent profile (~[-1, 1] per axis), before axis weighting.
// This is what the readout reflects, the person's own leanings.
function normVector(answers) {
  const raw = rawVector(answers)
  return Object.fromEntries(AXES.map((a) => [a, raw[a] / AXIS_MAXABS[a]]))
}

const applyWeights = (vec) => AXES.map((a) => (vec[a] || 0) * AXIS_WEIGHT[a])

function cosine(u, v) {
  let dot = 0
  let nu = 0
  let nv = 0
  for (let i = 0; i < u.length; i++) {
    dot += u[i] * v[i]
    nu += u[i] * u[i]
    nv += v[i] * v[i]
  }
  if (nu === 0 || nv === 0) return -1
  return dot / Math.sqrt(nu * nv)
}

// Committee centroids transformed into the same weighted space, once.
const CENTROIDS = Object.entries(COMMITTEE_PROFILES).map(([abbr, profile]) => ({
  abbr,
  vec: applyWeights(profile),
}))

// Returns abbrs ranked best-first: profile similarity (cosine) desc, then
// official list order. Same return contract as before (SortingPage uses
// ranked[0] as the winner and ranked[1..2] as the runners-up).
export function scoreAnswers(answers) {
  const me = applyWeights(normVector(answers))
  return CENTROIDS.map((c) => ({ abbr: c.abbr, sim: cosine(me, c.vec) }))
    .sort(
      (a, b) =>
        b.sim - a.sim ||
        ABBR_ORDER.indexOf(a.abbr) - ABBR_ORDER.indexOf(b.abbr),
    )
    .map((s) => s.abbr)
}

// A small, friendly readout of the respondent's own profile for the result
// screen: their top 1–2 RIASEC interests and the standout Big-Five facet (if
// any). Thresholds keep it from over-claiming on a flat profile.
export function profileFor(answers) {
  const nv = normVector(answers)
  const interests = AXES.filter((a) => AXIS_INFO[a].riasec)
    .map((a) => ({ axis: a, ...AXIS_INFO[a], score: nv[a] }))
    .sort((x, y) => y.score - x.score)
    .filter((x) => x.score > 0.08)
    .slice(0, 2)
  const traitAxis = nv.OPN >= nv.COM ? 'OPN' : 'COM'
  const trait =
    nv[traitAxis] > 0.12
      ? { axis: traitAxis, ...AXIS_INFO[traitAxis], score: nv[traitAxis] }
      : null
  return { interests, trait }
}

// ── "The science behind the Sorting" (openable info section) ────────────────
export const QUIZ_BASIS =
  'There’s real psychology under the hood here. It leans on two of the most ' +
  'studied ideas in the field, Holland’s RIASEC model of the kinds of work ' +
  'people are drawn to, and the Big Five personality traits, then weights them ' +
  'using survey data openly shared by hundreds of thousands of real people. The ' +
  'questions are borrowed from the public-domain International Personality Item ' +
  'Pool, and every committee sits in that same trait space, so your answers do ' +
  'the matching, not a label we stuck on you. All of it is for fun and a bit of ' +
  'self-reflection, not a diagnosis, so wear the result lightly.'

export const QUIZ_SOURCES = [
  {
    label: 'Open survey data (openpsychometrics.org)',
    href: 'https://openpsychometrics.org/_rawdata/',
    note: 'The public RIASEC (~145k people) and Big-Five (~1M people) responses we built the weights from.',
  },
  {
    label: 'International Personality Item Pool (IPIP)',
    href: 'https://ipip.ori.org/',
    note: 'The free, public item bank our questions are borrowed from.',
  },
  {
    label: 'Holland’s RIASEC interest model',
    href: 'https://en.wikipedia.org/wiki/Holland_Codes',
    note: 'The six interest types that sit behind the sorting.',
  },
  {
    label: 'Hurtado Rúa, Stead & Poklar (2019)',
    href: 'https://journals.sagepub.com/doi/abs/10.1177/1069072718780447',
    note: 'The study linking interests and personality that guided where each committee sits.',
  },
]
