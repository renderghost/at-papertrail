import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ErrorNote, Loading } from '../components/bits'
import { Cover } from '../components/Cover'
import { Icon } from '../components/Icon'
import { searchHive, type HiveBook } from '../lib/bookhive/api'
import { displayAuthors, firstAuthor } from '../lib/bookhive/authors'
import { STATUS, STATUS_LABEL, type BookEntry, type BookStatus } from '../lib/bookhive/types'
import { useBookWrites, useDebounced, useMyLibrary } from '../lib/hooks'
import { bookPath } from '../lib/paths'
import {
  bookKey,
  fullTitle,
  identityFromCandidate,
  matchCatalog,
  newBookRecord,
  searchBooks,
  withoutCatalogued,
  type Candidate,
} from '../lib/search'

const QUICK_STATUSES: BookStatus[] = [STATUS.wantToRead, STATUS.reading, STATUS.finished]

export function AddBook() {
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState(params.get('q') ?? '')
  const q = useDebounced(query.trim(), 400)

  // BookHive's own catalogue first: anything added from it is guaranteed to show on bookhive.buzz (#3).
  const hive = useQuery({
    queryKey: ['hive-search', q],
    queryFn: ({ signal }) => searchHive(q, { limit: 8, signal }),
    enabled: q.length >= 2,
    staleTime: 10 * 60 * 1000,
    retry: false,
  })
  const results = useQuery({
    queryKey: ['search', q],
    queryFn: ({ signal }) => searchBooks(q, signal),
    enabled: q.length >= 2,
    staleTime: 10 * 60 * 1000,
  })
  const hiveBooks = hive.data ?? []
  const others = results.data ? withoutCatalogued(results.data, hiveBooks) : undefined
  const searching = (hive.isFetching && !hive.data) || (results.isFetching && !results.data)

  return (
    <>
      <div className="page-header">
        <div>
          <p className="kicker">Add a book</p>
          <h1>What are you reading?</h1>
          <p className="lede">
            BookHive's catalogue first, then Open Library and Google Books. Books BookHive knows appear on bookhive.buzz
            too.
          </p>
        </div>
      </div>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault()
          setParams(query ? { q: query } : {}, { replace: true })
        }}
      >
        <div className="search-wrap">
          <Icon name="search" />
          <input
            className="input search-input"
            type="search"
            placeholder="Title, author or ISBN"
            aria-label="Search for a book"
            value={query}
            autoFocus
            onChange={(e) => {
              setQuery(e.target.value)
              setParams(e.target.value ? { q: e.target.value } : {}, { replace: true })
            }}
          />
        </div>
      </form>

      {hiveBooks.length > 0 && (
        <section className="section" aria-label="On BookHive">
          <div className="section-title">
            <h2>On BookHive</h2>
          </div>
          <ul className="results">
            {hiveBooks.map((book) => (
              <HiveResult key={book.id} book={book} />
            ))}
          </ul>
        </section>
      )}
      {searching && <Loading>Searching…</Loading>}
      {results.isError && hiveBooks.length === 0 && <ErrorNote error={results.error} />}
      {others && others.length > 0 && (
        <section className="section" aria-label="More books">
          {hiveBooks.length > 0 && (
            <div className="section-title">
              <h2>More from Open Library and Google Books</h2>
            </div>
          )}
          <ul className="results">
            {others.map((c) => (
              <SearchResult key={c.key} candidate={c} />
            ))}
          </ul>
        </section>
      )}
      {!searching && results.data && hiveBooks.length === 0 && others?.length === 0 && (
        <p className="muted" style={{ marginTop: 24 }}>
          No books found for “{q}”. Try the author's surname, or an ISBN.
        </p>
      )}
    </>
  )
}

function useExistingEntry(hiveId: string | undefined, isbn13: string | undefined, key: string): BookEntry | undefined {
  const library = useMyLibrary()
  return library.data?.find(
    (e) =>
      (hiveId && e.value.hiveId === hiveId) ||
      (isbn13 && e.value.identifiers?.isbn13 === isbn13) ||
      bookKey(e.value.title, firstAuthor(e.value.authors)) === key,
  )
}

/** Add buttons, or a link to your copy when the book is already in your library. */
function AddActions({
  existing,
  ready,
  pending,
  onAdd,
}: {
  existing: BookEntry | undefined
  ready: boolean
  pending: BookStatus | null
  onAdd: (status: BookStatus) => void
}) {
  return (
    <div className="actions">
      {existing ? (
        <Link className="btn btn-sm" to={bookPath(existing.value.hiveId)} state={{ entry: existing }}>
          In your library · {existing.value.status ? STATUS_LABEL[existing.value.status as BookStatus] : 'Open'}
        </Link>
      ) : (
        QUICK_STATUSES.map((s) => (
          <button
            key={s}
            className={`btn btn-sm${s === STATUS.reading ? ' btn-primary' : ''}`}
            disabled={!ready || pending !== null}
            onClick={() => onAdd(s)}
          >
            {pending === s ? 'Adding…' : STATUS_LABEL[s]}
          </button>
        ))
      )}
    </div>
  )
}

/** A result from BookHive's own search: already catalogued, so it's added by its hiveId. */
function HiveResult({ book }: { book: HiveBook }) {
  const navigate = useNavigate()
  const { create } = useBookWrites()
  const existing = useExistingEntry(book.id, book.identifiers?.isbn13, bookKey(book.title, firstAuthor(book.authors)))
  const [pending, setPending] = useState<BookStatus | null>(null)

  const add = async (status: BookStatus) => {
    setPending(status)
    try {
      const identity = { hiveId: book.id, title: book.title, authors: book.authors, identifiers: book.identifiers }
      const entry = await create.mutateAsync(newBookRecord(identity, book, status))
      navigate(bookPath(entry.value.hiveId), { state: { entry, justAdded: true } })
    } catch {
      setPending(null)
    }
  }

  return (
    <li className="result">
      <Cover hiveId={book.id} title={book.title} authors={book.authors} fallbackUrl={book.cover ?? book.thumbnail} size="sm" />
      <div>
        <h3>
          <Link to={bookPath(book.id)}>{book.title}</Link>
        </h3>
        <div className="muted small">
          {displayAuthors(book.authors)}
          {book.publicationYear ? ` · ${book.publicationYear}` : ''}
          {book.numPages ? ` · ${book.numPages} pages` : ''}
          {book.rating ? ` · ${(book.rating / 1000).toFixed(2)} average` : ''}
        </div>
        <div style={{ marginTop: 6 }}>
          <span className="badge badge-hive">
            <Icon name="check" size={14} /> On BookHive
          </span>
        </div>
        <AddActions existing={existing} ready pending={pending} onAdd={(s) => void add(s)} />
        {create.isError && pending === null && <ErrorNote error={create.error} />}
      </div>
    </li>
  )
}

function SearchResult({ candidate }: { candidate: Candidate }) {
  const navigate = useNavigate()
  const { create } = useBookWrites()
  const match = useQuery({
    queryKey: ['catalog-match', candidate.key],
    queryFn: () => matchCatalog(candidate),
    staleTime: Infinity,
  })
  const existing = useExistingEntry(match.data?.hiveId, candidate.isbn13, bookKey(fullTitle(candidate), candidate.authors[0]))
  const [pending, setPending] = useState<BookStatus | null>(null)
  const catalog = match.data?.catalog ?? null

  const add = async (status: BookStatus) => {
    if (!match.data) return
    setPending(status)
    try {
      const record = newBookRecord(identityFromCandidate(candidate, match.data.hiveId), catalog, status)
      const entry = await create.mutateAsync(record)
      navigate(bookPath(entry.value.hiveId), { state: { entry, justAdded: true } })
    } catch {
      setPending(null)
    }
  }

  const hiveId = match.data?.hiveId
  return (
    <li className="result">
      {hiveId ? (
        <Cover
          hiveId={hiveId}
          title={catalog?.title ?? candidate.title}
          authors={catalog?.authors ?? candidate.authors.join('\t')}
          isbn13={candidate.isbn13}
          fallbackUrl={candidate.coverUrl}
          size="sm"
        />
      ) : (
        <div className="cover cover-sm" />
      )}
      <div>
        <h3>{catalog?.title ?? candidate.title}</h3>
        {!catalog && candidate.subtitle && <div className="muted small">{candidate.subtitle}</div>}
        <div className="muted small">
          {candidate.authors.join(', ')}
          {candidate.year ? ` · ${candidate.year}` : ''}
          {(catalog?.numPages ?? candidate.pages) ? ` · ${catalog?.numPages ?? candidate.pages} pages` : ''}
        </div>
        <div style={{ marginTop: 6 }}>
          {match.isPending ? (
            <span className="badge">Checking BookHive…</span>
          ) : catalog ? (
            <span className="badge badge-hive">
              <Icon name="check" size={14} /> On BookHive
            </span>
          ) : (
            <span className="badge" title="Saved to your PDS, but bookhive.buzz only lists books in its catalogue.">
              Not on bookhive.buzz yet
            </span>
          )}
        </div>
        <AddActions existing={existing} ready={!!match.data} pending={pending} onAdd={(s) => void add(s)} />
        {create.isError && pending === null && <ErrorNote error={create.error} />}
      </div>
    </li>
  )
}
