import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ErrorNote, Loading } from '../components/bits'
import { BookCard, CardGrid } from '../components/Cards'
import { Icon } from '../components/Icon'
import { searchHive, type HiveBook } from '../lib/bookhive/api'
import { useDebounced, useDocumentTitle, useMyCopy } from '../lib/hooks'
import { PATHS } from '../lib/paths'
import { identityFromCandidate, matchCatalog, searchBooks, withoutCatalogued, type Candidate } from '../lib/search'

/** Discover › Search (#104): the one book search, which is also how you add a book. */
export function AddBook() {
  useDocumentTitle('Search')
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
          <p className="kicker">Discover</p>
          <h1>Find a book</h1>
          <p className="lede">
            BookHive's catalogue first, then Open Library and Google Books. Add any result to your library; books BookHive
            knows show on bookhive.buzz too.
          </p>
        </div>
        <Link className="btn" to={PATHS.scan}>
          <Icon name="scan" size={18} /> Scan a barcode
        </Link>
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
          <CardGrid size="list" className="search-results" label="On BookHive">
            {hiveBooks.map((book) => (
              <HiveResult key={book.id} book={book} />
            ))}
          </CardGrid>
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
          <CardGrid size="list" className="search-results" label="More books">
            {others.map((c) => (
              <SearchResult key={c.key} candidate={c} />
            ))}
          </CardGrid>
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

/** "1998 · 546 pages · 4.12 average", and whether BookHive has it. */
function Facts({ year, pages, rating, catalogued }: { year?: number; pages?: number; rating?: number; catalogued: boolean | null }) {
  const facts = [year, pages ? `${pages} pages` : null, rating ? `${(rating / 1000).toFixed(2)} average` : null].filter(Boolean)
  return (
    <p className="search-facts">
      {facts.join(' · ')}
      {facts.length > 0 && ' · '}
      {catalogued === null ? (
        <span className="muted">Checking BookHive…</span>
      ) : catalogued ? (
        <span className="on-bookhive">
          <Icon name="check" size={14} /> On BookHive
        </span>
      ) : (
        <span className="muted" title="Saved to your PDS, but bookhive.buzz only lists books in its catalogue.">
          Not on bookhive.buzz yet
        </span>
      )}
    </p>
  )
}

/** A result from BookHive's own search: already catalogued, so it's added by its hiveId (#106: a list card). */
function HiveResult({ book }: { book: HiveBook }) {
  return (
    <BookCard
      book={{ hiveId: book.id, title: book.title, authors: book.authors, identifiers: book.identifiers, catalog: book, coverUrl: book.cover ?? book.thumbnail }}
      context={<Facts year={book.publicationYear} pages={book.numPages} rating={book.rating} catalogued />}
    />
  )
}

/** A result from Open Library or Google Books, matched to BookHive's catalogue where it can be. */
function SearchResult({ candidate }: { candidate: Candidate }) {
  const match = useQuery({
    queryKey: ['catalog-match', candidate.key],
    queryFn: () => matchCatalog(candidate),
    staleTime: Infinity,
  })
  const catalog = match.data?.catalog ?? null
  const identity = match.data ? identityFromCandidate(candidate, match.data.hiveId) : null
  const mine = useMyCopy(identity)
  const facts = <Facts year={candidate.year} pages={catalog?.numPages ?? candidate.pages} catalogued={match.isPending ? null : !!catalog} />
  if (!identity) {
    // Until the match is back there's nothing to add it by: the card waits.
    return (
      <article className="card book-card book-card-large" aria-busy="true">
        <div className="cover cover-sm" />
        <div className="card-body">
          <h3 className="card-title">{candidate.title}</h3>
          <p className="card-sub">{candidate.authors.join(', ')}</p>
          <div className="card-context">{facts}</div>
        </div>
      </article>
    )
  }
  return (
    <BookCard
      book={{ ...identity, title: catalog?.title ?? identity.title, authors: catalog?.authors ?? identity.authors, catalog, coverUrl: candidate.coverUrl }}
      // A book BookHive doesn't know has no page to open until it's yours.
      to={catalog || mine ? undefined : null}
      context={facts}
    />
  )
}
