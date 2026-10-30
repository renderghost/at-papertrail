/** ISBN helpers. */

/** Digits (and a trailing X for ISBN-10) only. */
export function cleanIsbn(value: string | undefined | null): string {
  return (value ?? '').replace(/[^0-9Xx]/g, '').toUpperCase()
}

/** The ISBN-10 for a 978-prefixed ISBN-13; 979 ISBNs have none. */
export function isbn13To10(isbn13: string): string | null {
  const digits = cleanIsbn(isbn13)
  if (digits.length !== 13 || !digits.startsWith('978')) return null
  const core = digits.slice(3, 12)
  let sum = 0
  for (let i = 0; i < 9; i++) sum += (10 - i) * Number(core[i])
  const check = (11 - (sum % 11)) % 11
  return core + (check === 10 ? 'X' : String(check))
}

/** The ISBN-13 for an ISBN-10. */
export function isbn10To13(isbn10: string): string | null {
  const digits = cleanIsbn(isbn10)
  if (digits.length !== 10) return null
  const core = `978${digits.slice(0, 9)}`
  let sum = 0
  for (let i = 0; i < 12; i++) sum += (i % 2 === 0 ? 1 : 3) * Number(core[i])
  return core + String((10 - (sum % 10)) % 10)
}

/** Every spelling of a book's ISBNs, for matching records that carry only one of them. */
export function isbnKeys(ids: { isbn10?: string; isbn13?: string } | undefined): string[] {
  const keys = new Set<string>()
  const add = (v: string | null) => v && keys.add(v)
  const i13 = cleanIsbn(ids?.isbn13)
  const i10 = cleanIsbn(ids?.isbn10)
  if (i13.length === 13) {
    add(i13)
    add(isbn13To10(i13))
  }
  if (i10.length === 10) {
    add(i10)
    add(isbn10To13(i10))
  }
  return [...keys]
}

function checksumOk13(digits: string): boolean {
  let sum = 0
  for (let i = 0; i < 12; i++) sum += (i % 2 === 0 ? 1 : 3) * Number(digits[i])
  return (10 - (sum % 10)) % 10 === Number(digits[12])
}

function checksumOk10(digits: string): boolean {
  let sum = 0
  for (let i = 0; i < 10; i++) sum += (10 - i) * (digits[i] === 'X' ? 10 : Number(digits[i]))
  return sum % 11 === 0
}

/** A book's barcode: an EAN-13 in the 978/979 "Bookland" range with a valid check digit. */
export function isBooklandEan(code: string): boolean {
  return /^97[89]\d{10}$/.test(code) && checksumOk13(code)
}

/** A typed ISBN (10 or 13 digits, hyphens and spaces allowed) as a checked ISBN-13, or null. */
export function parseIsbn(text: string): string | null {
  const digits = cleanIsbn(text)
  if (digits.length === 13) return isBooklandEan(digits) ? digits : null
  if (digits.length === 10 && /^\d{9}[\dX]$/.test(digits) && checksumOk10(digits)) return isbn10To13(digits)
  return null
}
