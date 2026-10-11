import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase.js'
import { LIVE_MS, RESULTS_ROOT, refreshExamData } from './examQueries.js'
import { anySitting, refreshIn } from './examStats.js'

// The results side of the Exam page: the ranking, one person's paper and the
// question figures, for the exam officers (the EB and the SCOPE and SCORE
// officers). The setting-up side is examQueries.js. Authorisation lives in
// the database: each of these functions refuses anyone else, and a taker's
// account can call none of them (migration 20261010120001_exchange_exam.sql).
//
// No grade is stored. Each read counts a paper's right answers at that
// moment, so a corrected right answer or a longer exam shows on the next read.
//
// Every key starts with ['exam', <exam id>] (the root is examQueries.js's
// RESULTS_ROOT), so invalidating ['exam'] refreshes all the page holds about
// its exams' results.

export const examResultKeys = {
  results: (examId) => [...RESULTS_ROOT, examId, 'results'],
  sheet: (examId, attemptId) => [...RESULTS_ROOT, examId, 'sheet', attemptId],
  questionStats: (examId) => [...RESULTS_ROOT, examId, 'question-stats'],
}

function unwrap({ data, error }) {
  if (error) throw error
  return data
}

// The ranking: { questions, now, attempts: [...] }, highest grade first, equal
// grades by name. It is read again every 30 seconds while anyone is still
// sitting (grades move, and a paper runs out of time with nobody pressing
// anything) and while a student can still start, which is when a new paper
// appears: `exam` is the exam's row, which says when that is. Without it the
// ranking follows the sitting papers only.
export function useExamResults(examId, exam = null) {
  return useQuery({
    queryKey: examResultKeys.results(examId),
    queryFn: async () => unwrap(await supabase.rpc('exam_results', { p_exam: examId })),
    enabled: Boolean(examId),
    refetchInterval: (query) =>
      anySitting(query.state.data?.attempts) ? LIVE_MS : refreshIn(exam, Date.now(), LIVE_MS),
  })
}

// One paper: { attempt, rows }, every question in the officers' order with the
// right option and the chosen one. Read again every 30 seconds while that
// person is still sitting. `enabled` false stops the reads, for a paper that
// is being deleted.
export function useExamSheet(examId, attemptId, enabled = true) {
  return useQuery({
    queryKey: examResultKeys.sheet(examId, attemptId),
    queryFn: async () => unwrap(await supabase.rpc('exam_sheet', { p_attempt: attemptId })),
    enabled: enabled && Boolean(attemptId),
    refetchInterval: (query) => (query.state.data?.attempt?.state === 'sitting' ? LIVE_MS : false),
  })
}

// The question figures: { attempts, questions: [...] }, how many papers got
// each question right and chose each option. Every paper counts, finished or
// not, so it keeps in step with the ranking: read again every 30 seconds while
// `live` (someone is still sitting) and while a student can still start
// (`exam`, the exam's row).
export function useExamQuestionStats(examId, { live = false, exam = null } = {}) {
  return useQuery({
    queryKey: examResultKeys.questionStats(examId),
    queryFn: async () => unwrap(await supabase.rpc('exam_question_stats', { p_exam: examId })),
    enabled: Boolean(examId),
    refetchInterval: () => (live ? LIVE_MS : refreshIn(exam, Date.now(), LIVE_MS)),
  })
}

// Deletes a paper and its answers; the student may then start again. A paper
// fewer changes the ranking, the figures, who on the list of IDs has started
// and the counts on the list of exams, so both families of keys are read
// again, whether the delete went through or not: a refusal usually means the
// paper is already gone. The reads are not waited for, so the page can leave
// the paper as soon as it is deleted. The ranking it goes back to is the one
// kept from before, shown at once while it is read again: the paper is taken
// out of that copy first, so its row is not there to be opened beside the line
// that says it was deleted. The ranks are the database's and stay as they were
// until the new read brings them.
export function useDeleteAttempt() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (attemptId) => unwrap(await supabase.rpc('exam_delete_attempt', { p_attempt: attemptId })),
    onSuccess: (_answer, attemptId) => {
      // Of the three things kept under this root, only a ranking has a list of
      // papers; a paper's own sheet and the question figures are left alone.
      qc.setQueriesData({ queryKey: RESULTS_ROOT }, (kept) =>
        Array.isArray(kept?.attempts)
          ? { ...kept, attempts: kept.attempts.filter((row) => row?.attempt_id !== attemptId) }
          : kept,
      )
    },
    onSettled: () => {
      refreshExamData(qc)
    },
  })
}
