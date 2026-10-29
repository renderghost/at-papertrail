/**
 * RFC 4180 CSV, as Goodreads, StoryGraph and Hardcover export it: quoted
 * fields may hold commas, doubled quotes and line breaks. Lenient where those
 * exports are sloppy: a byte-order mark is skipped, a quote in the middle of
 * an unquoted field is just a character, and blank lines are dropped.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let fieldStarted = false
  const endRow = () => {
    row.push(field)
    if (row.length > 1 || row[0] !== '') rows.push(row)
    row = []
    field = ''
    fieldStarted = false
  }
  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length; i++) {
    const c = text[i]!
    if (quoted) {
      if (c !== '"') field += c
      else if (text[i + 1] === '"') {
        field += '"'
        i++
      } else quoted = false
    } else if (c === '"' && !fieldStarted) {
      quoted = true
      fieldStarted = true
    } else if (c === ',') {
      row.push(field)
      field = ''
      fieldStarted = false
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      endRow()
    } else {
      field += c
      fieldStarted = true
    }
  }
  if (field !== '' || fieldStarted || row.length) endRow()
  return rows
}

/** The first row as trimmed headers, the rest as objects keyed by them. */
export function csvRecords(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const [head = [], ...body] = parseCsv(text)
  const headers = head.map((h) => h.trim())
  const rows = body.map((cells) => {
    const row: Record<string, string> = {}
    headers.forEach((h, i) => {
      if (h) row[h] = (cells[i] ?? '').trim()
    })
    return row
  })
  return { headers, rows }
}

function cell(value: string | number | boolean | undefined | null): string {
  const s = value === undefined || value === null ? '' : String(value)
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Rows to CSV text, quoting only where needed, with CRLF line ends as spreadsheets expect. */
export function toCsv(rows: (string | number | boolean | undefined | null)[][]): string {
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'
}
