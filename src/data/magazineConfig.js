// Magazine engagement (reads, likes, downloads, reading depth) is recorded in
// the database through rpc/magazine_track (src/hooks/useMagazineEngagement.js)
// and shown to the CBSD officers in the portal.

// Whether to SHOW the live reads/likes counter + Like button on the page.
// Views and reading depth are still recorded in the background when this is
// false, only the on-page counter UI is hidden. Flip to true to surface it.
export const magazineCountersVisible = false
