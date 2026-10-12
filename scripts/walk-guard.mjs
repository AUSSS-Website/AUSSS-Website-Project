// The write guard both page walks of real data share (scripts/page-walk.mjs and the
// website guide's screenshots of public pages, scripts/guide/shots.mjs).
//
// The dev server and every preview talk to the PRODUCTION database, so the
// walk must not write to it. Reads pass; so does sign-in traffic. Any other
// call to Supabase (a magazine view being counted, a notification marked
// read) is answered here with an empty success and never leaves the machine.
export const READ_RPCS = new Set([
  'check_membership',
  'committee_roster',
  'content_public',
  'events_public',
  'gallery_public',
  'people_public',
  'magazine_insights',
  'magazine_public',
  'match_roster_lines',
  'post_audience',
  'profile_names',
  'roster_sheet_info',
  'roster_stats',
  'roster_sync_token_info',
  'roster_upgrade_candidates',
  'search_roster',
  'stories_public',
  'task_assignable_people',
])

export async function guardWrites(context, blocked) {
  await context.route(/^https:\/\/[a-z0-9]+\.supabase\.co\//, (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const method = req.method()
    const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z0-9_]+)$/)?.[1]
    const reading =
      method === 'GET' || method === 'HEAD' || method === 'OPTIONS' ||
      url.pathname.startsWith('/auth/v1/') ||
      (rpc && READ_RPCS.has(rpc)) ||
      // Signed URLs for private files are made with a POST but change nothing.
      url.pathname.startsWith('/storage/v1/object/sign/')
    if (reading) return route.continue()
    blocked.add(`${method} ${url.pathname}`)
    return route.fulfill({ status: 200, contentType: 'application/json', body: 'null' })
  })
}
