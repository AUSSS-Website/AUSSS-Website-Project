// Exports for the data the site collects: any list in the portal can be saved
// as a CSV (for a spreadsheet) or a PDF (for reading, printing or sharing).
//
// A column is { label, value: (row) => string | number | null }; the same
// list drives both formats. The PDF is built in the browser with jsPDF and
// its AutoTable plugin, loaded on demand so the portal bundle stays small.
// Two layouts: 'table' (one row per record, for compact lists such as the
// roster) and 'records' (one block of label / value lines per record, for
// things with long text such as stories and applications).
//
// Font: IBM Plex Sans Arabic (fonts/, OFL), a Latin + Arabic family embedded
// into every PDF so a name written in Arabic comes out as it was typed. jsPDF
// shapes Arabic itself by mapping letters to their presentation-form
// codepoints (U+FE70 to U+FEFF) and reversing each Arabic run, so the font
// must carry those glyphs: Plex does, most modern Arabic fonts (Tajawal,
// Cairo) do not and lose letters. A line mixing the two scripts reads best
// when one script dominates, which is what names, cities and short answers are.

import fontRegularUrl from './fonts/IBMPlexSansArabic-Regular.ttf?url'
import fontBoldUrl from './fonts/IBMPlexSansArabic-Bold.ttf?url'

const BRAND = 'AUSSS'
const FONT = 'PlexArabic'
const GREEN = [6, 64, 43]
const INK = [27, 27, 27]
const MUTED = [110, 110, 110]

function csvCell(v) {
  const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(columns, rows) {
  const head = columns.map((c) => csvCell(c.label)).join(',')
  const body = rows.map((r) => columns.map((c) => csvCell(c.value(r))).join(','))
  return '﻿' + [head, ...body].join('\r\n')
}

export function downloadText(filename, text, type = 'text/csv;charset=utf-8') {
  downloadBlob(filename, new Blob([text], { type }))
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// YYYY-MM-DD for file names.
export function dateStamp(d = new Date()) {
  return d.toISOString().slice(0, 10)
}

function text(v) {
  if (v == null) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

async function loadPdf() {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ])
  return { jsPDF, autoTable }
}

// The two font files as base64 (what jsPDF's virtual file system takes),
// fetched once per session and kept.
let fontFiles
async function loadFonts() {
  if (!fontFiles) {
    fontFiles = Promise.all([fontRegularUrl, fontBoldUrl].map(fetchBase64)).catch((e) => {
      fontFiles = null
      throw e
    })
  }
  return fontFiles
}

async function fetchBase64(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Could not load the PDF font (${res.status})`)
  const blob = await res.blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
    reader.onerror = () => reject(reader.error || new Error('Could not read the PDF font'))
    reader.readAsDataURL(blob)
  })
}

function registerFonts(doc, [regular, bold]) {
  doc.addFileToVFS('PlexArabic-Regular.ttf', regular)
  doc.addFont('PlexArabic-Regular.ttf', FONT, 'normal')
  doc.addFileToVFS('PlexArabic-Bold.ttf', bold)
  doc.addFont('PlexArabic-Bold.ttf', FONT, 'bold')
  doc.setFont(FONT, 'normal')
}

// Builds and downloads the PDF.
//   title, subtitle   the document heading
//   columns, rows     the data (rows already filtered the way the screen shows them)
//   layout            'table' | 'records'
//   summary           optional [[label, value], ...] printed under the heading
//   landscape         wide tables
//   filename          without the extension
export async function exportPdf({
  title,
  subtitle = '',
  columns,
  rows,
  layout = 'table',
  summary = [],
  landscape = false,
  filename = 'export',
}) {
  const [{ jsPDF, autoTable }, fonts] = await Promise.all([loadPdf(), loadFonts()])
  const doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'pt', format: 'a4', compress: true })
  registerFonts(doc, fonts)
  const pageW = doc.internal.pageSize.getWidth()
  const margin = 40
  const generated = new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })

  // Heading
  doc.setTextColor(...GREEN)
  doc.setFont(FONT, 'bold')
  doc.setFontSize(9)
  doc.text(BRAND.toUpperCase(), margin, margin)
  doc.setFontSize(18)
  doc.setTextColor(...INK)
  doc.text(title, margin, margin + 22)
  doc.setFont(FONT, 'normal')
  doc.setFontSize(10)
  doc.setTextColor(...MUTED)
  let y = margin + 38
  if (subtitle) {
    const lines = doc.splitTextToSize(subtitle, pageW - margin * 2)
    doc.text(lines, margin, y)
    y += lines.length * 12
  }
  doc.text(`${rows.length} ${rows.length === 1 ? 'record' : 'records'}, exported ${generated}`, margin, y)
  y += 18

  const base = { font: FONT, textColor: INK }

  if (summary.length) {
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      theme: 'plain',
      styles: { ...base, fontSize: 10, cellPadding: 3 },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 160, textColor: MUTED } },
      body: summary.map(([k, v]) => [text(k), text(v)]),
    })
    y = doc.lastAutoTable.finalY + 14
  }

  const footer = (data) => {
    doc.setFont(FONT, 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...MUTED)
    doc.text(
      `${BRAND} - ${title} - page ${data.pageNumber}`,
      margin,
      doc.internal.pageSize.getHeight() - 20,
    )
  }

  if (layout === 'records') {
    // One block per record: the first column's value is the block's heading, the
    // rest are label / value lines. Long values wrap; a block may span pages.
    for (const row of rows) {
      const [first, ...rest] = columns
      const body = rest
        .map((c) => [c.label, text(c.value(row))])
        .filter(([, v]) => v !== '')
      autoTable(doc, {
        startY: y,
        margin: { left: margin, right: margin, bottom: 40 },
        theme: 'plain',
        head: [[{ content: text(first.value(row)), colSpan: 2, styles: { fontStyle: 'bold', fontSize: 12, textColor: GREEN } }]],
        body,
        styles: { ...base, fontSize: 9.5, cellPadding: { top: 2, bottom: 2, left: 3, right: 3 }, valign: 'top' },
        columnStyles: { 0: { cellWidth: 120, textColor: MUTED, fontStyle: 'bold' } },
        didDrawPage: footer,
      })
      y = doc.lastAutoTable.finalY + 16
    }
  } else {
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin, bottom: 40 },
      theme: 'striped',
      headStyles: { fillColor: GREEN, textColor: 255, fontSize: 9, fontStyle: 'bold' },
      styles: { ...base, fontSize: 8, cellPadding: 2, overflow: 'linebreak', valign: 'top' },
      alternateRowStyles: { fillColor: [244, 247, 245] },
      head: [columns.map((c) => c.label)],
      body: rows.map((r) => columns.map((c) => text(c.value(r)))),
      didDrawPage: footer,
    })
  }

  doc.save(`${filename}.pdf`)
}
