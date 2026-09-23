// Page-image URLs for the flip readers (magazine editions and the incomings
// booklet). `pages` is { base, count, pad?, ext? }: the images live at
// `${base}/${NNN}.${ext}`, zero-padded to `pad` digits, built by
// _source/build-magazine.mjs.
export function pageUrls(pages) {
  if (!pages?.count) return []
  const pad = pages.pad || 3
  const ext = pages.ext || 'jpg'
  return Array.from({ length: pages.count }, (_, i) => {
    const n = String(i + 1).padStart(pad, '0')
    return `${pages.base}/${n}.${ext}`
  })
}
