// Turns the Secretary General's membership spreadsheet (an .xlsx download or a
// .csv export of its "Database" tab) into the rows rpc/import_roster expects.
//
// The layout is the sheet's own: a title row, then a header row whose first
// cell is "Name", then one member per row. Columns are addressed by position
// because the sheet's header cells have been blank or reworded before:
//   0 name, 1 email, 2 year joined, 3 years spent, 4 LGAs, 5 NGAs,
//   6 current position, 7 status ("Status [As of dd/mm/yyyy]").
// apps-script/roster-sync.gs and scripts/db/import-roster.mjs read it the same way.

const FIELDS = [
  'full_name',
  'email',
  'joined_year',
  'years_spent',
  'lgas',
  'ngas',
  'current_position',
  'status',
]

// RFC 4180: quoted cells may hold commas, line breaks and doubled quotes.
export function parseCsv(text) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  const src = text.replace(/^﻿/, '')
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

// grid: array of arrays of cell text. Returns { rows, batch } or throws with a
// message an officer can act on.
function gridToRoster(grid) {
  const hi = grid.findIndex((r) => String(r?.[0] ?? '').trim().toLowerCase() === 'name')
  if (hi === -1) {
    throw new Error(
      'Couldn’t find the header row (a row whose first cell is “Name”). Export the “Database” tab.',
    )
  }
  const asOf = String(grid[hi][7] ?? '').match(/\[(.+?)\]/)
  const rows = []
  for (const r of grid.slice(hi + 1)) {
    const cells = FIELDS.map((_, j) => String(r?.[j] ?? '').trim())
    if (!cells[0]) continue
    rows.push(Object.fromEntries(FIELDS.map((f, j) => [f, cells[j]])))
  }
  if (!rows.length) throw new Error('No member rows found under the header.')
  return { rows, batch: asOf ? asOf[1].replace(/\s+/g, ' ').trim() : null }
}

export async function parseRosterFile(file) {
  const name = file.name.toLowerCase()
  if (name.endsWith('.csv')) return gridToRoster(parseCsv(await file.text()))
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    // Loaded on demand: the spreadsheet reader is large and only this one
    // button needs it.
    const XLSX = await import('xlsx')
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    const sheet = wb.Sheets.Database || wb.Sheets[wb.SheetNames[0]]
    if (!sheet) throw new Error('That workbook has no sheets.')
    return gridToRoster(XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false }))
  }
  throw new Error('Choose the roster as an .xlsx or .csv file.')
}
