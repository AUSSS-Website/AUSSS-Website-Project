import { QueryClient } from '@tanstack/react-query'

// One QueryClient for the portal. 30 s staleTime: profile/assignment data
// changes rarely, so hopping between Dashboard and Profile reuses the cache
// instead of re-hitting PostgREST on every navigation. AuthProvider clears
// it on sign-out so nothing from one account survives into the next.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})
