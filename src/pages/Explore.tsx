import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Empty, ErrorNote, Loading } from '../components/bits'
import { BookCard, CardGrid, PersonCard } from '../components/Cards'
import { distinctWorks, inLanguage, readerLanguage } from '../lib/bibliography'
import { getExplore, getGenreBooks, getLanguages, listGenres, type HiveBook } from '../lib/bookhive/api'
import { plural } from '../lib/format'
import { useDocumentTitle } from '../lib/hooks'
import { authorPath, genrePath, PATHS } from '../lib/paths'
import { useNotInterestedIds } from '../lib/useLists'

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

/** Discover › Browse all (#79, #104): BookHive's genres and most-read authors, in your language. Public. */
export function ExplorePage() {
  useDocumentTitle('Browse BookHive')
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
          <p className="kicker">Discover</p>
          <h1>Browse BookHive</h1>
          <p className="lede">Its biggest genres and most-read authors, in the language you choose.</p>
        </div>
        <LanguagePicker language={language} languages={languages} onChange={setLanguage} />
      </div>

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
  // Books you've marked Not Interested (#106) stay out.
  const passed = useNotInterestedIds()
  const works = useMemo(() => distinctWorks(books.data ?? []).filter((b) => !passed.includes(b.id)), [books.data, passed])

  return (
    <>
      <div className="page-header">
        <div>
          <p className="kicker">
            <Link to={`${PATHS.browse}${language ? `?language=${encodeURIComponent(language)}` : ''}`}>Browse all</Link> · Genre
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
