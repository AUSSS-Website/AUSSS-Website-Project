import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase.js'

// Every PostgREST read/write the portal makes, plus the react-query hooks
// around them. Keys include the uid so switching accounts never shows the
// previous account's rows even before the cache is cleared.

const keys = {
  profile: (uid) => ['profile', uid],
  assignments: (uid) => ['assignments', uid],
  myVerification: (uid) => ['verification', 'mine', uid],
  pendingVerification: () => ['verification', 'pending'],
}

// Shape fixed by the contract; term is !inner so the is_current filter on the
// embedded row actually drops non-current assignments instead of nulling them.
const ASSIGNMENT_SELECT =
  'id, status, position:positions(id,key,title,short_title,level,can_assign_tasks,committee:committees(id,slug,name,abbr,color,logo,kind)), term:terms!inner(id,label,is_current)'

function unwrap({ data, error }) {
  if (error) throw error
  return data
}

async function fetchProfile(uid) {
  return unwrap(
    await supabase.from('profiles').select('*').eq('id', uid).maybeSingle(),
  )
}

async function fetchAssignments(uid) {
  const rows = unwrap(
    await supabase
      .from('assignments')
      .select(ASSIGNMENT_SELECT)
      .eq('profile_id', uid)
      .eq('status', 'active')
      .eq('term.is_current', true),
  )
  return rows || []
}

// Latest request only: the UI cares about "is one pending / what was decided".
async function fetchMyVerification(uid) {
  return unwrap(
    await supabase
      .from('verification_requests')
      .select('id, status, message, created_at, decided_at')
      .eq('profile_id', uid)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  )
}

// verification_requests has two FKs to profiles (profile_id, decided_by), so
// the embed must name the column or PostgREST refuses it as ambiguous.
async function fetchPendingVerifications() {
  const rows = unwrap(
    await supabase
      .from('verification_requests')
      .select(
        'id, message, created_at, profile_id, profile:profiles!verification_requests_profile_id_fkey(full_name,email,membership_status)',
      )
      .eq('status', 'pending')
      .order('created_at', { ascending: true }),
  )
  return rows || []
}

async function updateProfile(uid, patch) {
  return unwrap(
    await supabase.from('profiles').update(patch).eq('id', uid).select().single(),
  )
}

// ---- the photo a person chooses ---------------------------------------------

// Stored in the public `avatars` bucket under the person's own folder. The
// profile keeps the object (photo_path) and the address every byline shows
// (avatar_url). The previous photo is removed once the profile points at the
// new one, so a failed save never leaves the profile without a picture.
const AVATARS = 'avatars'

async function setProfilePhoto({ uid, blob, previousPath }) {
  const path = `${uid}/${crypto.randomUUID()}.jpg`
  const bucket = supabase.storage.from(AVATARS)
  const { error } = await bucket.upload(path, blob, {
    contentType: 'image/jpeg',
    upsert: false,
    cacheControl: '31536000',
  })
  if (error) throw error
  let row
  try {
    row = await updateProfile(uid, {
      photo_path: path,
      avatar_url: bucket.getPublicUrl(path).data.publicUrl,
    })
  } catch (err) {
    await bucket.remove([path]).catch(() => {})
    throw err
  }
  if (previousPath) await bucket.remove([previousPath]).catch(() => {})
  return row
}

// Back to the picture of the account they sign in with, when it has one.
async function clearProfilePhoto({ uid, previousPath, fallbackUrl }) {
  const row = await updateProfile(uid, { photo_path: null, avatar_url: fallbackUrl || null })
  if (previousPath) await supabase.storage.from(AVATARS).remove([previousPath]).catch(() => {})
  return row
}

// The members who opted in to the directory, with this term's positions.
async function fetchDirectory() {
  return unwrap(await supabase.rpc('directory')) || []
}

async function requestVerification(uid, message) {
  return unwrap(
    await supabase
      .from('verification_requests')
      .insert({ profile_id: uid, message: message || null })
      .select()
      .single(),
  )
}

// decision: 'approved' | 'declined'. new_status only matters on approve; the
// RPC defaults it to 'active' when omitted.
async function decideVerification({ request_id, decision, new_status }) {
  const args = { request_id, decision }
  if (new_status) args.new_status = new_status
  return unwrap(await supabase.rpc('decide_verification', args))
}

// ---- hooks ----------------------------------------------------------------

export function useProfile(uid) {
  return useQuery({
    queryKey: keys.profile(uid),
    queryFn: () => fetchProfile(uid),
    enabled: Boolean(uid),
  })
}

export function useAssignments(uid) {
  return useQuery({
    queryKey: keys.assignments(uid),
    queryFn: () => fetchAssignments(uid),
    enabled: Boolean(uid),
  })
}

export function useMyVerification(uid) {
  return useQuery({
    queryKey: keys.myVerification(uid),
    queryFn: () => fetchMyVerification(uid),
    enabled: Boolean(uid),
  })
}

// `enabled` lets the dashboard skip the query for non-EB members, whose RLS
// would just return an empty list anyway.
export function usePendingVerifications(enabled = true) {
  return useQuery({
    queryKey: keys.pendingVerification(),
    queryFn: fetchPendingVerifications,
    enabled,
  })
}

export function useUpdateProfile(uid) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch) => updateProfile(uid, patch),
    onSuccess: (row) => {
      qc.setQueryData(keys.profile(uid), row)
      // the name and the directory switch show elsewhere in the portal
      qc.invalidateQueries({ queryKey: ['names'] })
      qc.invalidateQueries({ queryKey: ['directory'] })
    },
  })
}

// Photo changes show in every byline, so the cached names go too.
export function useProfilePhoto(uid) {
  const qc = useQueryClient()
  const onSuccess = (row) => {
    qc.setQueryData(keys.profile(uid), row)
    qc.invalidateQueries({ queryKey: ['names'] })
    qc.invalidateQueries({ queryKey: ['directory'] })
  }
  return {
    set: useMutation({ mutationFn: (args) => setProfilePhoto({ uid, ...args }), onSuccess }),
    clear: useMutation({ mutationFn: (args) => clearProfilePhoto({ uid, ...args }), onSuccess }),
  }
}

export function useDirectory() {
  return useQuery({ queryKey: ['directory'], queryFn: fetchDirectory })
}

export function useRequestVerification(uid) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (message) => requestVerification(uid, message),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.myVerification(uid) })
      qc.invalidateQueries({ queryKey: keys.pendingVerification() })
    },
  })
}

export function useDecideVerification() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: decideVerification,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.pendingVerification() })
      qc.invalidateQueries({ queryKey: ['verification', 'mine'] })
      qc.invalidateQueries({ queryKey: ['profile'] })
    },
  })
}
