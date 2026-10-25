import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ErrorNote, Loading } from '../components/bits'
import { Cover } from '../components/Cover'
import { Icon } from '../components/Icon'
import { STATUS, STATUS_LABEL, type BookEntry, type BookStatus } from '../lib/bookhive/types'
import { useBookWrites, useDebounced, useMyLibrary } from '../lib/hooks'
import {
  bookKey,
  fullTitle,
  identityFromCandidate,
  matchCatalog,
  newBookRecord,
  searchBooks,
  type Candidate,
} from '../lib/search'
import { firstAuthor } from '../lib/bookhive/authors'

const QUICK_STATUSES: BookStatus[] = [STATUS.wantToRead, STATUS.reading, STATUS.finished]

export function AddBook() {
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState(params.get('q') ?? '')
  const q = useDebounced(query.trim(), 400)

  const results = useQuery({
    queryKey: ['search', q],
    queryFn: ({ signal }) => searchBooks(q, signal),
    enabled: q.length >= 2,
    staleTime: 10 * 60 * 1000,
  })

  return (
    <>
      <div className="page-header">
        <div>
          <p className="kicker">Add a book</p>
          <h1>What are you reading?</h1>
          <p className="lede">
            Results come from Open Library and Google Books. Books BookHive already knows are marked, and appear on
            bookhive.buzz too.
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

      {results.isFetching && !results.data && <Loading>Searching…</Loading>}
      {results.isError && <ErrorNote error={results.error} />}
      {results.data && results.data.length === 0 && (
        <p className="muted" style={{ marginTop: 24 }}>
          No books found for “{q}”. Try the author's surname, or an ISBN.
        </p>
      )}
      {results.data && results.data.length > 0 && (
        <ul className="results">
          {results.data.map((c) => (
            <SearchResult key={c.key} candidate={c} />
          ))}
        </ul>
      )}
    </>
  )
}

function useExistingEntry(hiveId: string | undefined, candidate: Candidate): BookEntry | undefined {
  const library = useMyLibrary()
  const key = bookKey(fullTitle(candidate), candidate.authors[0])
  return library.data?.find(
    (e) =>
      (hiveId && e.value.hiveId === hiveId) ||
      (candidate.isbn13 && e.value.identifiers?.isbn13 === candidate.isbn13) ||
      bookKey(e.value.title, firstAuthor(e.value.authors)) === key,
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
  const existing = useExistingEntry(match.data?.hiveId, candidate)
  const [pending, setPending] = useState<BookStatus | null>(null)
  const catalog = match.data?.catalog ?? null

  const add = async (status: BookStatus) => {
    if (!match.data) return
    setPending(status)
    try {
      const record = newBookRecord(identityFromCandidate(candidate, match.data.hiveId), catalog, status)
      const entry = await create.mutateAsync(record)
      navigate(`/book/${entry.value.hiveId}`, { state: { entry, justAdded: true } })
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
        <div className="actions">
          {existing ? (
            <Link className="btn btn-sm" to={`/book/${existing.value.hiveId}`} state={{ entry: existing }}>
              In your library · {existing.value.status ? STATUS_LABEL[existing.value.status as BookStatus] : 'Open'}
            </Link>
          ) : (
            QUICK_STATUSES.map((s) => (
              <button
                key={s}
                className={`btn btn-sm${s === STATUS.reading ? ' btn-primary' : ''}`}
                disabled={!match.data || pending !== null}
                onClick={() => void add(s)}
              >
                {pending === s ? 'Adding…' : STATUS_LABEL[s]}
              </button>
            ))
          )}
        </div>
        {create.isError && pending === null && <ErrorNote error={create.error} />}
      </div>
    </li>
  )
}
