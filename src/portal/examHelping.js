import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase.js'

// Which exams the person signed in helps with: the officers can name anyone
// with an account a helper for one exam's registered list (examQueries.js has
// the rest). This part sits in a file of its own because the portal's layout
// asks it for every member, to know whether to show the Exam link, and should
// not carry the exam pages' code to do so.

// Under the exam pages' own root key, so their writes read it again too.
export const HELPING_KEY = ['exams', 'helping']

// Nearly everyone helps with no exam, so the answer is kept for five minutes.
export const HELPING_STALE_MS = 5 * 60_000

// [{ id, title, status, opens_at, closes_at, minutes, term: { label },
// registrations, started }], newest first; empty for someone who helps with none.
export async function fetchHelperExams() {
  const { data, error } = await supabase.rpc('exam_helper_exams')
  if (error) throw error
  return data || []
}

// Whether to show the Exam link to someone who is not an exam officer.
export function useHelpsWithExam(enabled = true) {
  const helping = useQuery({ queryKey: HELPING_KEY, queryFn: fetchHelperExams, enabled, staleTime: HELPING_STALE_MS })
  return (helping.data || []).length > 0
}
