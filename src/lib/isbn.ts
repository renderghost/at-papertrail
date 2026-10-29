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
