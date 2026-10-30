import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Empty, ErrorNote, Loading, Stars } from '../components/bits'
import { BookCard, CardGrid, PersonCard } from '../components/Cards'
import { useMaybeSession } from '../lib/auth'
import { distinctWorks, inLanguage, readerLanguage } from '../lib/bibliography'
import { sameBookKeys } from '../lib/bookclub'
import { getExplore, getGenreBooks, getLanguages, listGenres, type HiveBook } from '../lib/bookhive/api'
import type { BookEntry } from '../lib/bookhive/types'
import { displayName, plural } from '../lib/format'
import { useDocumentTitle, useMyLibrary } from '../lib/hooks'
import { useNetwork, type Reader } from '../lib/network'
import { authorPath } from '../lib/paths'
import { LOVED } from '../lib/taste'

const HOUR = 60 * 60 * 1000

/** The language to explore in: ?language=, else the reader's if BookHive has books in it, else every language (""). */
function useExploreLanguage() {
  const [params, setParams] = useSearchParams()
  const languages = useQuery({ queryKey: ['bookhive-languages'], queryFn: ({ signal }) => getLanguages(signal), staleTime: 24 * HOUR })
  const reader = readerLanguage()
  const fallback = languages.data?.find((l) => inLanguage({ language: l }, reader)) ?? ''
  const language = params.get('language') ?? fallback
  const setLanguage = (value: string) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p)
        next.set('language', value)
        return next
      },
      { replace: true },
    )
  return { language, setLanguage, languages: languages.data ?? [] }
}

export const genrePath = (genre: string, language?: string) => `/explore/genres/${encodeURIComponent(genre)}${language !== undefined ? `?language=${encodeURIComponent(language)}` : ''}`

function LanguagePicker({ language, languages, onChange }: { language: string; languages: string[]; onChange: (l: string) => void }) {
  return (
    <label className="field inline-field">
      <span className="label">Books in</span>
      <select value={language} onChange={(e) => onChange(e.target.value)}>
        <option value="">Every language</option>
        {languages.map((l) => (
          <option key={l} value={l}>
            {l.split(';')[0]}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Explore BookHive (#79): its genres and most-read authors in your language, and what the people you follow loved lately. */
export function ExplorePage() {
  useDocumentTitle('Explore BookHive')
  const me = useMaybeSession()
  const { language, setLanguage, languages } = useExploreLanguage()
  const explore = useQuery({ queryKey: ['explore', language], queryFn: ({ signal }) => getExplore(language || undefined, signal), staleTime: 6 * HOUR })
  const genres = useQuery({ queryKey: ['genres'], queryFn: ({ signal }) => listGenres({ signal }), staleTime: 24 * HOUR })
  const allGenres = useMemo(() => {
    const top = explore.data?.genres.map((g) => g.genre) ?? []
    return [...top, ...(genres.data ?? []).map((g) => g.genre).filter((g) => !top.includes(g))]
  }, [explore.data, genres.data])

  return (
    <>
      <div className="page-header">
        <div>
          <p className="kicker">Explore</p>
          <h1>Explore BookHive</h1>
          <p className="lede">Its biggest genres and most-read authors, and what the people you follow have loved lately.</p>
        </div>
        <LanguagePicker language={language} languages={languages} onChange={setLanguage} />
      </div>

      {me && <NetworkPicks did={me.did} />}

      <section className="section">
        <div className="section-title">
          <h2>Genres</h2>
        </div>
        {explore.isError && <ErrorNote error={explore.error} />}
        {allGenres.length === 0 && (explore.isPending || genres.isPending) ? (
          <Loading />
        ) : (
          <ul className="genre-chips">
            {allGenres.map((g) => (
              <li key={g}>
                <Link className="chip" to={genrePath(g, language)}>
                  {g}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {explore.data && explore.data.topAuthors.length > 0 && (
        <section className="section">
          <div className="section-title">
            <h2>Most-read authors</h2>
          </div>
          <CardGrid size="compact" className="top-authors" label="Most-read authors">
            {explore.data.topAuthors.map((a) => (
              <PersonCard
                key={a.author}
                size="compact"
                person={{ name: a.author, ...(a.thumbnail?.startsWith('https://') ? { avatar: a.thumbnail } : {}) }}
                to={authorPath(a.author)}
                context={
                  <p>
                    {plural(a.bookCount, 'book')}
                    {a.avgRating ? ` · ${(a.avgRating / 10).toFixed(1)} stars` : ''}
                  </p>
                }
              />
            ))}
          </CardGrid>
        </section>
      )}
    </>
  )
}

type Loved = { book: BookEntry; readers: Reader[]; average: number }

/** Community picks from your own network: books the people you follow loved in the past year, that you don't have. */
function NetworkPicks({ did }: { did: string }) {
  const network = useNetwork(did)
  const library = useMyLibrary()
  const picks = useMemo(() => {
    const mine = new Set((library.data ?? []).flatMap(sameBookKeys))
    const since = new Date(Date.now() - 365 * 24 * HOUR).toISOString()
    const byBook = new Map<string, Loved>()
    for (const reader of network.readers) {
      if (reader.profile.did === did) continue
      for (const b of reader.books) {
        if ((b.value.stars ?? 0) < LOVED || (b.value.finishedAt ?? b.value.createdAt) < since) continue
        const keys = sameBookKeys(b)
        if (keys.some((k) => mine.has(k))) continue
        const key = keys[1]!
        const seen = byBook.get(key) ?? { book: b, readers: [], average: 0 }
        if (!seen.readers.includes(reader)) {
          seen.average = (seen.average * seen.readers.length + b.value.stars!) / (seen.readers.length + 1)
          seen.readers.push(reader)
        }
        byBook.set(key, seen)
      }
    }
    return [...byBook.values()].sort((a, b) => b.readers.length - a.readers.length || b.average - a.average).slice(0, 12)
  }, [network.readers, library.data, did])

  if (!picks.length) return null
  return (
    <section className="section">
      <div className="section-title">
        <h2>Loved in your network</h2>
        <span className="count">the past year</span>
      </div>
      <CardGrid size="compact" className="network-picks" label="Loved in your network">
        {picks.map(({ book, readers, average }) => {
          const v = book.value
          return (
            <BookCard
              key={book.uri}
              size="compact"
              book={{ hiveId: v.hiveId, title: v.title, authors: v.authors, identifiers: v.identifiers, entry: book }}
              context={
                <p>
                  Loved by {displayName(readers[0]!.profile)}
                  {readers.length > 1 ? ` and ${plural(readers.length - 1, 'other')}` : ''} <Stars stars={Math.round(average)} size={12} />
                </p>
              }
            />
          )
        })}
      </CardGrid>
    </section>
  )
}

/** A genre's most-read books on BookHive, one edition each, in your language (#79). */
export function GenrePage() {
  const { genre = '' } = useParams()
  useDocumentTitle(genre)
  const { language, setLanguage, languages } = useExploreLanguage()
  const books = useQuery({
    queryKey: ['genre-books', genre, language],
    queryFn: ({ signal }) => getGenreBooks(genre, { language: language || undefined, limit: 100, signal }),
    staleTime: 6 * HOUR,
  })
  const works = useMemo(() => distinctWorks(books.data ?? []), [books.data])

  return (
    <>
      <div className="page-header">
        <div>
          <p className="kicker">
            <Link to={`/explore${language ? `?language=${encodeURIComponent(language)}` : ''}`}>Explore</Link> · Genre
          </p>
          <h1>{genre}</h1>
          <p className="lede">The most-read {genre.toLowerCase()} on BookHive, one edition of each.</p>
        </div>
        <LanguagePicker language={language} languages={languages} onChange={setLanguage} />
      </div>
      {books.isPending ? (
        <Loading />
      ) : books.isError ? (
        <ErrorNote error={books.error} />
      ) : works.length === 0 ? (
        <Empty title={`No ${genre.toLowerCase()} in this language yet`}>
          <p>Try every language.</p>
        </Empty>
      ) : (
        <HiveGrid books={works} label={`Most-read ${genre.toLowerCase()}`} />
      )}
    </>
  )
}

export function HiveGrid({ books, label }: { books: HiveBook[]; label?: string }) {
  return (
    <CardGrid size="compact" className="genre-books" label={label}>
      {books.map((b) => (
        <BookCard
          key={b.id}
          size="compact"
          book={{ hiveId: b.id, title: b.title, authors: b.authors, identifiers: b.identifiers, catalog: b }}
          context={b.rating ? <p>{(b.rating / 1000).toFixed(2)} average</p> : undefined}
        />
      ))}
    </CardGrid>
  )
}
