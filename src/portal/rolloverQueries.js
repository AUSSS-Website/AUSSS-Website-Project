import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase.js'

// The term rollover (EB only; migration 20261008120001_term_rollover). The
// preview says what the switch would do; the switch is one database call that
// does all of it or none of it.

function unwrap({ data, error }) {
  if (error) throw error
  return data
}

export function useRolloverPreview() {
  return useQuery({
    queryKey: ['rollover-preview'],
    queryFn: async () => unwrap(await supabase.rpc('rollover_preview')),
  })
}

export function useRollOverTerm() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ label, startsOn, endsOn, archiveAlbums }) =>
      unwrap(
        await supabase.rpc('roll_over_term', {
          label,
          starts_on: startsOn,
          ends_on: endsOn,
          archive_albums: archiveAlbums,
        }),
      ),
    // Everything the portal holds belongs to the old term now, the signed-in
    // person's own positions included.
    onSuccess: () => qc.invalidateQueries(),
  })
}
