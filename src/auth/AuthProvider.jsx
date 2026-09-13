import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase.js'
import { useAssignments, useProfile } from '../portal/queries.js'
import { CALLBACK_PATH, rememberNext } from '../portal/constants.js'

// Session + identity for the portal. Supabase owns the session (localStorage,
// auto refresh); react-query owns the profile and this term's assignments.
// Must sit inside QueryClientProvider (PortalRoot does that).

const AuthContext = createContext(null)

const LEVELS = ['webmaster', 'eb', 'officer', 'assistant', 'member']

function callbackUrl() {
  return window.location.origin + CALLBACK_PATH
}

export function AuthProvider({ children }) {
  const queryClient = useQueryClient()
  // undefined = still asking Supabase; null = signed out.
  const [session, setSession] = useState(undefined)

  useEffect(() => {
    let alive = true
    supabase.auth.getSession().then(({ data }) => {
      if (alive) setSession(data.session ?? null)
    })
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next ?? null)
      // Nothing from one account may survive into the next.
      if (event === 'SIGNED_OUT') queryClient.clear()
      // SIGNED_IN needs no invalidation: the query keys carry the uid, so a
      // new account gets fresh queries anyway, and invalidating here would
      // cancel-and-refetch the requests that the uid change just started.
      // USER_UPDATED (email change etc.) does need it. Deferred with
      // setTimeout: supabase-js holds a lock while it emits, and a refetch
      // that calls back into auth from inside the callback deadlocks.
      if (event === 'USER_UPDATED') {
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ['profile'] })
          queryClient.invalidateQueries({ queryKey: ['assignments'] })
        }, 0)
      }
    })
    return () => {
      alive = false
      subscription.unsubscribe()
    }
  }, [queryClient])

  const user = session?.user ?? null
  const uid = user?.id
  const profileQ = useProfile(uid)
  const assignmentsQ = useAssignments(uid)
  const assignments = assignmentsQ.data || []

  const levels = useMemo(() => {
    const set = new Set(assignments.map((a) => a.position?.level).filter(Boolean))
    return LEVELS.filter((l) => set.has(l))
  }, [assignments])
  const isWebmaster = levels.includes('webmaster')
  const isEB = isWebmaster || levels.includes('eb')

  const officerOf = useCallback(
    (slug) =>
      isEB ||
      assignments.some(
        (a) => a.position?.level === 'officer' && a.position?.committee?.slug === slug,
      ),
    [assignments, isEB],
  )

  const signInWithGoogle = useCallback(async (next) => {
    rememberNext(next)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: callbackUrl() },
    })
    if (error) throw error
  }, [])

  const signInWithMagicLink = useCallback(async (email, next) => {
    rememberNext(next)
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: callbackUrl(), shouldCreateUser: true },
    })
    if (error) throw error
  }, [])

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut()
    queryClient.clear()
    if (error) throw error
  }, [queryClient])

  // Loading until we know the session AND, when signed in, the profile and
  // assignments have settled (error counts as settled), so RequireEB can
  // decide correctly on first render and pages never see a half-loaded user.
  const loading =
    session === undefined ||
    (Boolean(uid) && (profileQ.isPending || assignmentsQ.isPending))

  const value = useMemo(
    () => ({
      loading,
      session: session ?? null,
      user,
      profile: profileQ.data ?? null,
      profileError: profileQ.error ?? null,
      assignments,
      assignmentsError: assignmentsQ.error ?? null,
      levels,
      isWebmaster,
      isEB,
      officerOf,
      signInWithGoogle,
      signInWithMagicLink,
      signOut,
    }),
    [
      loading,
      session,
      user,
      profileQ.data,
      profileQ.error,
      assignments,
      assignmentsQ.error,
      levels,
      isWebmaster,
      isEB,
      officerOf,
      signInWithGoogle,
      signInWithMagicLink,
      signOut,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
