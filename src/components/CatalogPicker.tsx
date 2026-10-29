import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { searchHive, type HiveBook } from '../lib/bookhive/api'
import { displayAuthors } from '../lib/bookhive/authors'
import { Cover } from './Cover'

/**
 * Search BookHive's catalogue and choose the right book: the importer's
 * unmatched rows and the match fixer both use it (#57, #60).
 * Shows `suggestions` until you search for something else.
 */
export function CatalogPicker({
  initialQuery,
  suggestions = [],
  chosenId,
  busy = false,
  pickLabel = 'This one',
  onPick,
}: {
  initialQuery: string
  suggestions?: HiveBook[]
  chosenId?: string
  busy?: boolean
  pickLabel?: string
  onPick: (book: HiveBook) => void
}) {
  const [text, setText] = useState(initialQuery)
  // With no suggestions to show, search straight away.
  const [query, setQuery] = useState<string | null>(suggestions.length ? null : initialQuery.trim() || null)
  const results = useQuery({
    queryKey: ['hive-search', query],
    queryFn: ({ signal }) => searchHive(query!, { limit: 6, signal }),
    enabled: !!query,
    staleTime: 60 * 60 * 1000,
  })
  const books = query ? (results.data ?? []) : suggestions

  return (
    <div className="catalog-picker">
      <form
        role="search"
        className="row picker-search"
        onSubmit={(e) => {
          e.preventDefault()
          setQuery(text.trim() || null)
        }}
      >
        <input className="input" aria-label="Search BookHive's catalogue" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn btn-sm" type="submit">
          Search
        </button>
      </form>
      {query && results.isFetching && <p className="small muted">Searching BookHive…</p>}
      {query && results.isError && <p className="small muted">BookHive's search couldn't be reached. Try again in a moment.</p>}
      {query && results.isSuccess && !books.length && <p className="small muted">Nothing on BookHive matches “{query}”.</p>}
      {books.length > 0 && (
        <ul className="picker-results">
          {books.map((b) => (
            <li key={b.id} className={b.id === chosenId ? 'picked' : undefined}>
              <Cover hiveId={b.id} title={b.title} authors={b.authors} fallbackUrl={b.thumbnail || b.cover} size="xs" />
              <span className="picker-names">
                <strong>{b.title}</strong>
                <span className="small muted">
                  {displayAuthors(b.authors)}
                  {b.publicationYear ? ` · ${b.publicationYear}` : ''}
                </span>
              </span>
              <button
                type="button"
                className={`btn btn-sm${b.id === chosenId ? ' btn-primary' : ''}`}
                aria-pressed={b.id === chosenId}
                disabled={busy}
                onClick={() => onPick(b)}
              >
                {b.id === chosenId ? 'Chosen' : pickLabel}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
