// A clean inline PDF embed. Hides the browser PDF viewer's toolbar and side
// panel (#toolbar=0&navpanes=0, honoured by Chromium's viewer) so the document
// sits flush in a branded frame.
//
// An <iframe>, not an <object>: the site's Content-Security-Policy keeps
// `object-src 'none'` (plugins stay off) and allows same-origin frames through
// `frame-src 'self'` (vercel.json). The earlier <object> with an <iframe>
// inside was refused on both counts, and the page showed "blocked" instead of
// the document. An iframe has no fallback content, so the way out for browsers
// that can't show a PDF inline (most phones) is the link underneath.
// fit: 'width' (default) scales the page to the frame width; 'page' fits a
// whole page within the frame (one page per view).
export default function PdfFrame({ src, title, heightClass = 'h-[82vh]', fit = 'width' }) {
  const view = `${src}#toolbar=0&navpanes=0&view=${fit === 'page' ? 'Fit' : 'FitH'}`
  return (
    <div className="reveal">
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-forest-800">
        <iframe src={view} title={title} loading="lazy" className={`block w-full ${heightClass}`} />
      </div>
      <p className="mt-3 text-center text-xs text-silver/55">
        Can’t see the document?{' '}
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-medical-light underline-offset-2 hover:text-white hover:underline"
        >
          Open it in a new tab
        </a>
        .
      </p>
    </div>
  )
}
