// Small things every page that offers a PDF needs: the line of facts under
// its title and a link that saves it rather than opening it. A PDF here is
// what the content editor keeps for one (src/content/schema.js, type `pdf`):
// { url, name, pages, bytes }.

// A size the way people say it: "540 KB", "1.8 MB", "19 MB".
export function fileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  if (bytes < 1e6) return `${Math.max(1, Math.round(bytes / 1000))} KB`
  return `${(bytes / 1e6).toFixed(1).replace(/\.0$/, '')} MB`
}

// "Issued October 2026 · 49 pages · PDF, 1.8 MB". `version` comes first and
// is left out when empty, as are the pages and the size when they are not known.
export function documentFacts(pdf, version = '') {
  const pages = pdf?.pages > 0 ? `${pdf.pages} ${pdf.pages === 1 ? 'page' : 'pages'}` : ''
  const size = fileSize(pdf?.bytes)
  return [String(version || '').trim(), pages, size ? `PDF, ${size}` : 'PDF'].filter(Boolean).join(' · ')
}

// A file uploaded from the portal lives in Supabase Storage, on another
// address than the site's. A browser ignores the `download` attribute on a
// link to another address and opens the file instead, so such a link asks
// Storage to send the file as an attachment (?download=<name>). The site's
// own files ("/assets/…") are left as they are, for the attribute to do it.
export function downloadHref(url, name = '') {
  if (typeof url !== 'string' || !/^https:\/\//i.test(url)) return url
  try {
    const u = new URL(url)
    if (!u.pathname.includes('/storage/v1/object/public/')) return url
    u.searchParams.set('download', name)
    return u.toString()
  } catch {
    return url
  }
}

// A file uploaded from the portal is always fetched whole by the reader:
// Storage does not show another site its Accept-Ranges header, which pdf.js
// needs before it asks for pieces. So PdfReader's `large` does nothing for
// it, and a big upload is slow to open on a phone. Past this size the portal
// says so when the file is chosen.
export const SLOW_PDF_BYTES = 8e6
