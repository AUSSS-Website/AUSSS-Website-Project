// pdf.js (about 1 MB) and its worker, fetched the first time something needs
// them: the document reader (src/components/PdfReader.jsx) and the portal,
// which reads a PDF's pages before uploading it (src/portal/contentQueries.js).
export async function loadPdfJs() {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ])
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  return pdfjs
}

// The options every PDF on the site is opened with. The site's content policy
// allows neither WebAssembly nor code made from text, and none of its files
// needs either.
export const PDF_SAFE_OPTIONS = Object.freeze({ useWasm: false, isEvalSupported: false })
