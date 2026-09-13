import { createClient } from '@supabase/supabase-js'

// Single browser client for the member portal. Import this ONLY from
// src/auth/** and src/portal/** so the public site bundle never pulls
// supabase-js in (the portal is its own lazy route in App.jsx).
//
// Implicit flow rather than PKCE on purpose: a magic link opened in a phone
// mail app or a different browser has no PKCE verifier to pair with, and the
// OTP-code fallback needs a custom email template the free plan cannot set.
const url = import.meta.env.VITE_SUPABASE_URL || ''
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

// False when either env var is blank (local build without .env.local, or a
// Vercel preview before the vars are set). PortalRoot then shows a
// NotConfigured panel instead of letting createClient throw.
export const supabaseEnabled = Boolean(url && key)

export const supabase = supabaseEnabled
  ? createClient(url, key, {
      auth: {
        flowType: 'implicit',
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null
