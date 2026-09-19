// Runtime switches for the officer-managed parts of the public site.
//
// Since Phase 2 of the portal plan (September 2026) the officer backend is
// Supabase, not apps-script/officers.gs: committee page overrides live in
// committees.page, site settings in site_settings, and Open Calls in
// calls/applications. Officers edit all of it signed in at /portal; the
// public site reads it anonymously over REST (src/lib/supabaseRest.js) and
// falls back to the static society.js content when the env vars are absent.

// The Open Calls feature (officer-published recruitment calls + applications)
// is TEMPORARILY OFF on the public site. The call cards are hidden everywhere
// they appear (committee pages, and anywhere else reading `useCalls`) until
// the joining flow is settled. Officers can still prepare calls in the portal;
// flip this to `true` to show them.
export const callsLiveEnabled = false
