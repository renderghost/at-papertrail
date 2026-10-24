/** BookHive stores authors as one tab-separated string. */
const TAB = '\t'

export function parseAuthors(authors: string | undefined | null): string[] {
  if (!authors) return []
  return authors
    .split(TAB)
    .map((a) => a.trim())
    .filter(Boolean)
}

export function formatAuthors(authors: readonly string[]): string {
  return authors
    .map((a) => a.trim())
    .filter(Boolean)
    .join(TAB)
}

/** "Ann Leckie, Becky Chambers" */
export function displayAuthors(authors: string | undefined | null): string {
  return parseAuthors(authors).join(', ')
}

export function firstAuthor(authors: string | undefined | null): string {
  return parseAuthors(authors)[0] ?? ''
}
