import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase.js'
import { resizeImage } from '../lib/resizeImage.js'
import { sortChanges } from './examFile.js'
import { refreshIn } from './examStats.js'

// The exchange exam: reads and writes for the people who set it up (the SCOPE
// and SCORE officers and the Executive Board). Same shape as eventQueries.js.
// Authorisation lives in the database: row-level security on the exam tables,
// and every RPC asks app.is_exam_officer() first. A taker's account reads none
// of this. The results and the overview have a file of their own
// (examResultQueries.js).
//
// Everything set up here sits under one key, ['exams'], and every write ends
// by reading all of it again, whether it went through or not: a new question
// changes the exam's counts, a released ID changes the list, and a refusal
// usually means the exam has started since the page was loaded, which the next
// read then shows.
//
// A student starting is no officer's write, so nothing above would show it.
// While students can start, the exam and its registered list are therefore
// read again every 30 seconds (refreshIn in examStats.js says when), which is
// how the page learns that the exam has started and what that locks.

export const examKeys = {
  all: () => ['exams'],
  list: () => ['exams', 'list'],
  one: (id) => ['exams', 'one', id],
  questions: (examId) => ['exams', 'questions', examId],
  passages: (examId) => ['exams', 'passages', examId],
  registrations: (examId) => ['exams', 'registrations', examId],
}

// The root of the keys examResultQueries.js keeps the ranking, the papers and
// the question figures under: ['exam', <exam id>, ...]. A write here changes
// them too (a corrected right answer changes grades, a longer exam changes
// who is still sitting).
export const RESULTS_ROOT = ['exam']

// How often the pages ask again by themselves while an exam is being sat.
export const LIVE_MS = 30_000

// Reads again everything the Exam page holds, both families of keys. Each
// write on either side ends with it.
export function refreshExamData(qc) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: examKeys.all() }),
    qc.invalidateQueries({ queryKey: RESULTS_ROOT }),
  ])
}

function unwrap({ data, error }) {
  if (error) throw error
  return data
}

// ---- the exam ---------------------------------------------------------------

const EXAM_SELECT =
  '*, term:terms(label, is_current), exam_questions(count), exam_registrations(count), exam_attempts(count)'

const countOf = (embedded) => (Array.isArray(embedded) ? embedded[0]?.count ?? 0 : 0)

// The row as the pages take it: the three counts as plain numbers beside the
// row's own columns, and `started` (the exam has at least one paper, after
// which the database locks parts of it).
function shapeExam(row) {
  if (!row) return null
  const attempts = countOf(row.exam_attempts)
  return {
    ...row,
    questions: countOf(row.exam_questions),
    registrations: countOf(row.exam_registrations),
    attempts,
    started: attempts > 0,
  }
}

// Every exam, newest first (the database returns them all to an exam officer
// and none to anyone else).
async function fetchExams() {
  const rows = unwrap(await supabase.from('exams').select(EXAM_SELECT).order('created_at', { ascending: false }))
  return (rows || []).map(shapeExam)
}

export function useExams(enabled = true) {
  return useQuery({ queryKey: examKeys.list(), queryFn: fetchExams, enabled })
}

async function fetchExam(id) {
  return shapeExam(unwrap(await supabase.from('exams').select(EXAM_SELECT).eq('id', id).maybeSingle()))
}

// One exam. While students can start it is read again every 30 seconds, so
// `started` and the counts follow the hall; before its opening time the next
// read waits for that time.
export function useExam(id, enabled = true) {
  return useQuery({
    queryKey: examKeys.one(id),
    queryFn: () => fetchExam(id),
    enabled: enabled && Boolean(id),
    refetchInterval: (query) => refreshIn(query.state.data, Date.now(), LIVE_MS),
  })
}

// A new exam is a draft of the current term; the database gives it a random
// word for its address.
async function createExam({ title }) {
  return shapeExam(unwrap(await supabase.from('exams').insert({ title }).select(EXAM_SELECT).single()))
}

// `patch` holds columns of public.exams: title, address_word, status,
// opens_at, closes_at, minutes, start_code.
async function updateExam(id, patch) {
  return shapeExam(unwrap(await supabase.from('exams').update(patch).eq('id', id).select(EXAM_SELECT).single()))
}

// The questions, the list of IDs and every paper go with the row.
// The exam's pictures go after its row, best effort: a file left behind is a
// stray file in a folder nothing points at, never a broken exam. (While the
// exam has papers the bucket refuses to give its pictures up, so the row goes
// first.)
async function deleteExam(id) {
  unwrap(await supabase.from('exams').delete().eq('id', id))
  await removeExamFolder(id).catch(() => {})
  return id
}

export function useExamMutations() {
  const qc = useQueryClient()
  const done = () => refreshExamData(qc)
  const create = useMutation({ mutationFn: createExam, onSettled: done })
  const update = useMutation({ mutationFn: ({ id, patch }) => updateExam(id, patch), onSettled: done })
  // Not waited for: the page leaves for the list as soon as the row is gone,
  // and has no use for one more read of an exam that is not there. The list
  // it leaves for is the one kept from before, shown at once while it is read
  // again: the exam is taken out of that copy first, so the list never shows
  // it beside the line that says it was deleted.
  const remove = useMutation({
    mutationFn: deleteExam,
    onSuccess: (id) => {
      qc.setQueryData(examKeys.list(), (rows) => (Array.isArray(rows) ? rows.filter((row) => row.id !== id) : rows))
    },
    onSettled: () => {
      done()
    },
  })
  return { create, update, remove }
}

// ---- questions --------------------------------------------------------------

const QUESTION_SELECT =
  'id, exam_id, sort, body, options, keep_option_order, section, passage_id, image_path, created_at, updated_at, exam_key(correct_option)'

// A question with its right answer beside it: `correct` is the option's place
// in `options` as the officers wrote them, from 0 (null if it has no key).
function shapeQuestion({ exam_key: key, ...row }) {
  const one = Array.isArray(key) ? key[0] : key
  return { ...row, options: Array.isArray(row.options) ? row.options : [], correct: one?.correct_option ?? null }
}

// The exam's questions in the officers' order.
async function fetchQuestions(examId) {
  const rows = unwrap(
    await supabase
      .from('exam_questions')
      .select(QUESTION_SELECT)
      .eq('exam_id', examId)
      .order('sort')
      .order('created_at')
      .order('id'),
  )
  return (rows || []).map(shapeQuestion)
}

export function useExamQuestions(examId) {
  return useQuery({
    queryKey: examKeys.questions(examId),
    queryFn: () => fetchQuestions(examId),
    enabled: Boolean(examId),
  })
}

// Adds a question at the end (no `id`) or changes one; the question and its
// key are written together. `correct` is the right option's place, from 0.
// `more` is { section, passage_id, image_path } with any of the three; a key
// that is not there leaves that part of the question as it is, and no `more`
// leaves all three (as when only the right answer is corrected). Answers with
// the question's id.
async function saveQuestion({ examId, id = null, body, options, correct, keepOrder = false, more = null }) {
  return unwrap(
    await supabase.rpc('save_exam_question', {
      p_exam: examId,
      p_question: id,
      p_body: body,
      p_options: options,
      p_correct: correct,
      p_keep_order: keepOrder,
      ...(more ? { p_more: more } : {}),
    }),
  )
}

// `rows` as examFile.js makes them. All of them or none; answers with how many
// were added.
async function importQuestions({ examId, rows }) {
  return unwrap(await supabase.rpc('import_exam_questions', { p_exam: examId, p_rows: rows }))
}

// Takes { id, imagePath }. The picture goes after the row, here and not in a
// callback of the page: a callback given with the call runs only for the last
// of several removals, and not at all once the page has gone.
async function deleteQuestion({ id, imagePath = null }) {
  unwrap(await supabase.from('exam_questions').delete().eq('id', id))
  await removeExamPicture(imagePath)
  return id
}

// New order: the questions' ids as the list now shows them. The questions are
// read first, and only the rows whose number changes are written, together.
// Reading first means the numbers are worked out from what the database holds
// and not from what the screen showed: when the drag before this one failed
// to save, this one still saves the whole order the officer is looking at.
async function reorderQuestions({ examId, ids }) {
  const stored = await fetchQuestions(examId)
  if (stored.length !== ids.length || stored.some((q) => !ids.includes(q.id))) {
    // Another officer added or removed a question in the meantime. The mark
    // says the sentence is written for the officer: errorText
    // (src/lib/errorText.js) then shows it as it is.
    throw Object.assign(
      new Error('The questions changed while you were moving one. The list has been read again: move it once more.'),
      { rejected: true },
    )
  }
  const results = await Promise.all(
    sortChanges(stored, ids).map(({ id, sort }) => supabase.from('exam_questions').update({ sort }).eq('id', id)),
  )
  results.forEach(unwrap)
  return ids
}

export function useQuestionMutations(examId) {
  const qc = useQueryClient()
  const key = examKeys.questions(examId)
  const done = () => refreshExamData(qc)
  const save = useMutation({ mutationFn: (question) => saveQuestion({ examId, ...question }), onSettled: done })
  const importRows = useMutation({ mutationFn: (rows) => importQuestions({ examId, rows }), onSettled: done })
  const remove = useMutation({ mutationFn: deleteQuestion, onSettled: done })
  // Takes { questions, ids }: the list as it was and its ids as they are now.
  // The list shows the new order the moment a row is dropped: the cached list
  // is put in that order first, and put back if the save fails. Either way it
  // is read again afterwards, so the screen ends on what the database holds.
  // Two drags in a row are saved one after the other (the scope), so the
  // second never lands before the first, and the list is read again only
  // after the last of them. When the first of two fails, the list is not put
  // back: the second was made on top of it and saves the whole order shown.
  const orderKey = ['exam-question-order', examId]
  const reorder = useMutation({
    mutationKey: orderKey,
    scope: { id: orderKey.join(':') },
    mutationFn: ({ ids }) => reorderQuestions({ examId, ids }),
    onMutate: async ({ questions, ids }) => {
      await qc.cancelQueries({ queryKey: key })
      const before = qc.getQueryData(key)
      const byId = new Map(questions.map((q) => [q.id, q]))
      const sorts = new Map(sortChanges(questions, ids).map((c) => [c.id, c.sort]))
      const next = ids
        .filter((id) => byId.has(id))
        .map((id) => (sorts.has(id) ? { ...byId.get(id), sort: sorts.get(id) } : byId.get(id)))
      if (next.length === questions.length) qc.setQueryData(key, next)
      return { before }
    },
    onError: (_err, _vars, context) => {
      // This drag still counts as one in progress here, so 1 means no later
      // drag is waiting behind it.
      if (context?.before && qc.isMutating({ mutationKey: orderKey }) === 1) qc.setQueryData(key, context.before)
    },
    onSettled: () => (qc.isMutating({ mutationKey: orderKey }) > 1 ? undefined : done()),
  })
  return { save, importRows, remove, reorder }
}

// ---- passages ---------------------------------------------------------------

const PASSAGE_SELECT = 'id, exam_id, section, body, image_path, created_at, updated_at'

// The exam's passages, oldest first: the texts and pictures several questions
// are read with.
async function fetchPassages(examId) {
  return (
    unwrap(await supabase.from('exam_passages').select(PASSAGE_SELECT).eq('exam_id', examId).order('created_at').order('id')) || []
  )
}

export function useExamPassages(examId) {
  return useQuery({
    queryKey: examKeys.passages(examId),
    queryFn: () => fetchPassages(examId),
    enabled: Boolean(examId),
  })
}

// Adds a passage (no `id`) or changes one. Its questions follow it to a new
// section. Answers with the passage's id.
async function savePassage({ examId, id = null, body, section, imagePath = null }) {
  return unwrap(
    await supabase.rpc('save_exam_passage', {
      p_exam: examId,
      p_passage: id,
      p_body: body,
      p_section: section,
      p_image: imagePath,
    }),
  )
}

// Takes { id, imagePath }. Its questions stay, as single questions; its
// picture goes after the row.
async function deletePassage({ id, imagePath = null }) {
  unwrap(await supabase.from('exam_passages').delete().eq('id', id))
  await removeExamPicture(imagePath)
  return id
}

export function usePassageMutations(examId) {
  const qc = useQueryClient()
  const done = () => refreshExamData(qc)
  const save = useMutation({ mutationFn: (passage) => savePassage({ examId, ...passage }), onSettled: done })
  const remove = useMutation({ mutationFn: deletePassage, onSettled: done })
  return { save, remove }
}

// ---- pictures ---------------------------------------------------------------
//
// A question or a passage may have one picture. It is shrunk in the browser
// to a JPEG and kept in the public bucket `exam-pictures` under
// <exam id>/<32 random hex digits>.jpg. The name cannot be guessed and the
// bucket lists nothing to a student, so a picture is seen only by whoever was
// given its address: the officers here, and a student's paper after the start
// code. The row holds the picture's place in the bucket (`image_path`), not
// its address.

const PICTURES = 'exam-pictures'
// Wide enough for a diagram on a large phone held sideways, small enough that
// four hundred phones fetching a paper's pictures stay within a few megabytes each.
const PICTURE_PX = 1200
const PICTURE_QUALITY = 0.85

// Where a picture is served from; '' for no picture.
export function examPictureUrl(path) {
  return path ? supabase.storage.from(PICTURES).getPublicUrl(path).data.publicUrl : ''
}

function randomName() {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

// Shrinks the file, uploads it under the exam's folder and answers with its
// place in the bucket, for `image_path`.
export async function uploadExamPicture(examId, file) {
  let blob
  try {
    blob = await resizeImage(file, PICTURE_PX, PICTURE_QUALITY)
  } catch {
    // Marked as a refusal so that errorText shows this sentence as written.
    throw Object.assign(new Error('That file could not be read as a picture. Choose a JPEG, PNG or WebP.'), {
      rejected: true,
    })
  }
  const path = `${examId}/${randomName()}.jpg`
  const { error } = await supabase.storage.from(PICTURES).upload(path, blob, {
    contentType: 'image/jpeg',
    upsert: false,
    cacheControl: '31536000',
  })
  if (error) throw error
  return path
}

// Best effort: a picture no row points at any more. A failure leaves a stray
// file, never a broken question.
export async function removeExamPicture(path) {
  if (!path) return
  try {
    await supabase.storage.from(PICTURES).remove([path])
  } catch {
    // A stray file is all that is left.
  }
}

async function removeExamFolder(examId) {
  for (;;) {
    const { data, error } = await supabase.storage.from(PICTURES).list(examId, { limit: 100 })
    if (error) throw error
    if (!data || data.length === 0) return
    const gone = await supabase.storage.from(PICTURES).remove(data.map((o) => `${examId}/${o.name}`))
    if (gone.error) throw gone.error
    // Nothing went: the bucket is keeping them, and asking again would not end.
    if (!gone.data || gone.data.length === 0 || data.length < 100) return
  }
}

// ---- the registered list ----------------------------------------------------

// Every ID on the exam's list, in order, each with who holds it and whether
// they have started: { id, student_id, created_at, claimed_at,
// holder: null | { profile_id, full_name, email }, started }.
async function fetchRegistrations(examId) {
  return unwrap(await supabase.rpc('exam_registration_list', { p_exam: examId })) || []
}

// `exam` is the exam's row: while students can start, the list is read again
// every 30 seconds, so who holds an ID and who has started follow the hall.
export function useRegistrations(examId, exam = null) {
  return useQuery({
    queryKey: examKeys.registrations(examId),
    queryFn: () => fetchRegistrations(examId),
    enabled: Boolean(examId),
    refetchInterval: () => refreshIn(exam, Date.now(), LIVE_MS),
  })
}

// Answers { added, already, invalid }.
async function addRegistrations({ examId, ids }) {
  return unwrap(await supabase.rpc('exam_add_registrations', { p_exam: examId, p_ids: ids }))
}

// Frees an ID from the account that holds it, for a student who signed in
// with the wrong one.
async function releaseRegistration(id) {
  return unwrap(await supabase.rpc('exam_release_registration', { p_registration: id }))
}

async function deleteRegistration(id) {
  unwrap(await supabase.from('exam_registrations').delete().eq('id', id))
  return id
}

export function useRegistrationMutations(examId) {
  const qc = useQueryClient()
  const done = () => refreshExamData(qc)
  const add = useMutation({ mutationFn: (ids) => addRegistrations({ examId, ids }), onSettled: done })
  const release = useMutation({ mutationFn: releaseRegistration, onSettled: done })
  const remove = useMutation({ mutationFn: deleteRegistration, onSettled: done })
  return { add, release, remove }
}
