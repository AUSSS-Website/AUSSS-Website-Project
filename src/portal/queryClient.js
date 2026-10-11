import { QueryClient } from '@tanstack/react-query'
import { UNREACHED, errorText } from '../lib/errorText.js'

// One QueryClient for the portal. 30 s staleTime: profile/assignment data
// changes rarely, so hopping between Dashboard and Profile reuses the cache
// instead of re-hitting PostgREST on every navigation. AuthProvider clears
// it on sign-out so nothing from one account survives into the next.
//
// A read that fails is tried once more, unless it failed because the request
// got no answer. supabase-js has by then tried a table read (a GET) four
// times itself, waiting 1, 2 and 4 seconds in between (fetchWithRetry in
// @supabase/postgrest-js, read in version 2.116.0), and a second round here
// took "We couldn’t reach the server" from about 7 seconds to about 15. A
// read through a database function is a POST, which supabase-js sends once:
// with no answer it now fails at once, and is asked again when the browser
// says the connection is back or the page is opened again.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => failureCount < 1 && errorText(error, '') !== UNREACHED,
      refetchOnWindowFocus: false,
    },
  },
})
