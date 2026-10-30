import { useQueries } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Empty, ErrorNote, Loading } from '../components/bits'
import { BookCard, CardGrid } from '../components/Cards'
import { useSession } from '../lib/auth'
import { readerLanguage } from '../lib/bibliography'
import { getAuthorBooks, getGenreBooks } from '../lib/bookhive/api'
import { firstAuthor } from '../lib/bookhive/authors'
import { fetchCatalogBook } from '../lib/bookhive/catalog'
import { STATUS, type BookEntry } from '../lib/bookhive/types'
import { excluded, loadNotForMe, recommendFor, saveNotForMe, seedsFrom, telling, type Recommendation } from '../lib/discover'
import { useDocumentTitle, useMyLibrary } from '../lib/hooks'
import { useNetwork } from '../lib/network'
import { OCCASIONS, pagesPerDay, pickFor, surprise, type Candidate } from '../lib/nextRead'
import { copiesOf, networkIndex, networkTake, tasteTwins } from '../lib/taste'

const HOUR = 60 * 60 * 1000

function useCatalogs(entries: BookEntry[]) {
  return useQueries({
    queries: entries.map((e) => ({
      queryKey: ['catalog', e.value.hiveId],
      queryFn: () => fetchCatalogBook(e.value.hiveId),
      staleTime: 6 * HOUR,
      gcTime: 6 * HOUR,
    })),
  })
}

/** Discovery (#71, #74): the right book from your list for the moment, and books like the ones you loved. */
export function DiscoverPage() {
  useDocumentTitle('Discover')
  const library = useMyLibrary()
  return (
    <>
      <div className="page-header">
        <div>
          <p className="kicker">Discover</p>
          <h1>What to read next</h1>
          <p className="lede">
            The right book from your want-to-read list for the moment, and books like the ones you loved. Every pick says why. Or{' '}
            <Link to="/explore">explore BookHive</Link>.
          </p>
        </div>
      </div>
      {library.isPending ? (
        <Loading />
      ) : library.isError ? (
        <ErrorNote error={library.error} />
      ) : (
        <>
          <PickNextRead library={library.data} />
          <BecauseYouLoved library={library.data} />
        </>
      )}
    </>
  )
}

function PickNextRead({ library }: { library: BookEntry[] }) {
  const { did } = useSession()
  const network = useNetwork(did)
  const [params, setParams] = useSearchParams()
  const [ownedFirst, setOwnedFirst] = useState(false)
  const [surprised, setSurprised] = useState<Candidate | null>(null)
  const occasion = OCCASIONS.find((o) => o.id === params.get('for'))

  const want = useMemo(() => library.filter((e) => e.value.status === STATUS.wantToRead).slice(0, 80), [library])
  const finished = useMemo(() => library.filter((e) => e.value.status === STATUS.finished && e.value.startedAt && e.value.finishedAt).slice(0, 30), [library])
  const wantCatalog = useCatalogs(want)
  const finishedCatalog = useCatalogs(finished)
  const ready = wantCatalog.every((q) => !q.isPending)
  const candidates = useMemo(() => {
    const index = networkIndex(network.readers, did)
    return want.map((entry, i): Candidate => ({
      entry,
      catalog: wantCatalog[i]?.data ?? null,
      networkAverage: networkTake(copiesOf(entry, index).map((c) => c.entry)).average,
    }))
  }, [want, wantCatalog, network.readers, did])
  const pace = useMemo(() => pagesPerDay(finished.map((entry, i) => ({ entry, pages: finishedCatalog[i]?.data?.numPages }))), [finished, finishedCatalog])
  const result = occasion && ready ? pickFor(candidates, occasion, { ownedFirst, pace }) : null

  const choose = (id: string) => {
    setSurprised(null)
    setParams((p) => {
      const next = new URLSearchParams(p)
      next.set('for', id)
      return next
    })
  }

  return (
    <section className="section">
      <div className="section-title">
        <h2>Pick my next read</h2>
        <span className="count">from your want-to-read list</span>
      </div>
      {want.length === 0 ? (
        <p className="muted">Add books to your want-to-read list and this will pick one for the moment.</p>
      ) : (
        <>
          <div className="occasions" role="group" aria-label="Occasion">
            {OCCASIONS.map((o) => (
              <button key={o.id} type="button" className="chip" aria-pressed={o === occasion} title={o.blurb} onClick={() => choose(o.id)}>
                {o.label}
              </button>
            ))}
            <button type="button" className="chip" onClick={() => setSurprised(surprise(candidates))} disabled={!ready}>
              Surprise me
            </button>
          </div>
          <label className="checkbox">
            <input type="checkbox" checked={ownedFirst} onChange={(e) => setOwnedFirst(e.target.checked)} /> Books I own first
          </label>
          {surprised ? (
            <CardGrid size="large" className="picks" label="Your surprise">
              <PickCard candidate={surprised} why={['picked at random, likelier the better it is rated']} />
            </CardGrid>
          ) : occasion ? (
            !ready ? (
              <Loading>Weighing up your list…</Loading>
            ) : (
              <>
                <p className="small muted occasion-blurb">{occasion.blurb}.</p>
                {result!.note && <p className="small">{result!.note}</p>}
                <CardGrid size="large" className="picks" label={`For a ${occasion.label.toLowerCase()}`}>
                  {result!.picks.map((p) => (
                    <PickCard key={p.candidate.entry.uri} candidate={p.candidate} why={p.why} />
                  ))}
                </CardGrid>
              </>
            )
          ) : (
            <p className="small muted">Choose an occasion.</p>
          )}
        </>
      )}
    </section>
  )
}

function PickCard({ candidate: { entry, catalog }, why }: { candidate: Candidate; why: string[] }) {
  const v = entry.value
  return (
    <BookCard
      book={{ hiveId: v.hiveId, title: v.title, authors: v.authors, identifiers: v.identifiers, catalog, entry }}
      state={{ entry }}
      context={<p className="why">{why.length ? why.join(' · ') : catalog?.numPages ? `${catalog.numPages} pages` : 'On your list'}</p>}
    />
  )
}

function BecauseYouLoved({ library }: { library: BookEntry[] }) {
  const { did } = useSession()
  const network = useNetwork(did)
  const [notForMe, setNotForMe] = useState(() => loadNotForMe(did))
  // What you had when the page opened: a book you add here stays, showing your status.
  const [known] = useState(library)
  const reader = readerLanguage()
  const seeds = useMemo(() => seedsFrom(library), [library])
  const authors = useQueries({
    queries: seeds.map((s) => ({
      queryKey: ['author-books', firstAuthor(s.value.authors)],
      queryFn: ({ signal }: { signal: AbortSignal }) => getAuthorBooks(firstAuthor(s.value.authors), signal),
      staleTime: 6 * HOUR,
      retry: false,
    })),
  })
  const catalogs = useCatalogs(seeds)
  const genres = seeds.map((_, i) => telling(catalogs[i]?.data?.genres))
  const genreBooks = useQueries({
    queries: genres.map((g) => ({
      queryKey: ['genre-books', g, reader ?? ''],
      queryFn: ({ signal }: { signal: AbortSignal }) => getGenreBooks(g!, { language: reader, limit: 60, signal }),
      enabled: !!g,
      staleTime: 6 * HOUR,
      retry: false,
    })),
  })
  const twins = useMemo(() => tasteTwins(library, network.readers, did), [library, network.readers, did])
  const groups = useMemo(() => {
    const skip = excluded(known, notForMe)
    return seeds.map((seed, i) => {
      const genre = genres[i]
      const recs = recommendFor(seed, { byAuthor: authors[i]?.data?.books, ...(genre && genreBooks[i]?.data ? { genre: { name: genre, books: genreBooks[i]!.data! } } : {}) }, twins, skip, { reader })
      // Each book once, under the first book it's like.
      for (const r of recs) skip.add(`hive:${r.hiveId}`)
      return { seed, recs, loading: !!authors[i]?.isPending || !!catalogs[i]?.isPending }
    })
  }, [seeds, authors, catalogs, genreBooks, genres, twins, known, notForMe, reader])

  const dismiss = (hiveId: string) => {
    const next = [...notForMe, hiveId]
    setNotForMe(next)
    saveNotForMe(did, next)
  }

  return (
    <section className="section">
      <div className="section-title">
        <h2>Because you loved…</h2>
      </div>
      {seeds.length === 0 ? (
        <Empty title="Rate a few books first">
          <p>Give the books you love four and a half or five stars, and books like them will gather here.</p>
        </Empty>
      ) : (
        groups.map(({ seed, recs, loading }) => (
          <div key={seed.uri} className="because">
            <h3 className="club-group-label">Because you loved {seed.value.title}</h3>
            {recs.length === 0 ? (
              <p className="small muted">{loading ? 'Looking…' : 'Nothing new to suggest yet.'}</p>
            ) : (
              <CardGrid size="compact" className="picks" label={`Because you loved ${seed.value.title}`}>
                {recs.map((r) => (
                  <RecommendationCard key={r.hiveId} rec={r} onDismiss={() => dismiss(r.hiveId)} />
                ))}
              </CardGrid>
            )}
          </div>
        ))
      )}
    </section>
  )
}

function RecommendationCard({ rec, onDismiss }: { rec: Recommendation; onDismiss: () => void }) {
  return (
    <BookCard
      size="compact"
      book={{ hiveId: rec.hiveId, title: rec.title, authors: rec.authors, identifiers: rec.identifiers, catalog: rec.catalog }}
      context={<p className="why">{rec.why}</p>}
      more={[{ label: 'Not for me', onSelect: onDismiss }]}
    />
  )
}
