import { useQueries } from '@tanstack/react-query'
import { useMemo, useState, type ReactNode } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { Empty, ErrorNote, Loading, Stars } from '../components/bits'
import { BookCard, CardGrid } from '../components/Cards'
import { NetworkScan } from '../components/NetworkScan'
import { ContinueSeries } from '../components/Series'
import { useSession } from '../lib/auth'
import { readerLanguage } from '../lib/bibliography'
import { sameBookKeys } from '../lib/bookclub'
import { getAuthorBooks, getGenreBooks } from '../lib/bookhive/api'
import { firstAuthor } from '../lib/bookhive/authors'
import { fetchCatalogBook } from '../lib/bookhive/catalog'
import { STATUS, type BookEntry } from '../lib/bookhive/types'
import {
  excluded,
  loadNotForMe,
  lovedBy,
  lovedInNetwork,
  popularWithTwins,
  recommendFor,
  saveNotForMe,
  seedsFrom,
  telling,
  type NetworkPick,
  type Recommendation,
} from '../lib/discover'
import { useDocumentTitle, useMyLibrary } from '../lib/hooks'
import { useNetwork } from '../lib/network'
import { OCCASIONS, pagesPerDay, pickFor, surprise, type Candidate } from '../lib/nextRead'
import { PATHS } from '../lib/paths'
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

/** A Discover tab (#104): its header, then what it makes of your library once that's loaded. */
function DiscoverTab({ title, lede, children }: { title: string; lede: ReactNode; children: (library: BookEntry[]) => ReactNode }) {
  useDocumentTitle(title)
  const library = useMyLibrary()
  return (
    <>
      <div className="page-header">
        <div>
          <p className="kicker">Discover</p>
          <h1>{title}</h1>
          <p className="lede">{lede}</p>
        </div>
      </div>
      {library.isPending ? <Loading /> : library.isError ? <ErrorNote error={library.error} /> : children(library.data)}
    </>
  )
}

/** Discover › Because you loved… (#71): books like the ones you rated highest. */
export function BecauseYouLovedPage() {
  const [params] = useSearchParams()
  // Before #104, occasions were picked on this page.
  if (params.has('for')) return <Navigate to={`${PATHS.nextRead}?${params}`} replace />
  return (
    <DiscoverTab
      title="Because you loved…"
      lede="Books like the ones you rated highest: more from their authors, favourites of the readers most like you, and the best of their genres. Every pick says why."
    >
      {(library) => <BecauseYouLoved library={library} />}
    </DiscoverTab>
  )
}

/** Discover › Pick my next read (#74): the right book from your want-to-read list for the moment. */
export function PickNextReadPage() {
  return (
    <DiscoverTab title="Pick my next read" lede="The right book from your want-to-read list for the moment: choose an occasion, or be surprised.">
      {(library) => <PickNextRead library={library} />}
    </DiscoverTab>
  )
}

/** Discover › Continue a series (#61). */
export function ContinueSeriesPage() {
  return (
    <DiscoverTab title="Continue a series" lede="The next book in each series you've read from, the most recent first.">
      {(library) => <ContinueSeries entries={library} />}
    </DiscoverTab>
  )
}

/** Discover › Recommendations (#104): what the readers most like you loved, then what everyone you follow loved. */
export function RecommendationsPage() {
  return (
    <DiscoverTab
      title="Recommendations"
      lede="Books popular with the readers most like you, then what everyone you follow loved this past year. Worked out in your browser from public libraries; nothing is stored."
    >
      {(library) => <Recommendations library={library} />}
    </DiscoverTab>
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
    <section>
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
    <>
      {seeds.length === 0 ? (
        <Empty title="Rate a few books first">
          <p>Give the books you love four and a half or five stars, and books like them will gather here.</p>
        </Empty>
      ) : (
        groups.map(({ seed, recs, loading }, i) => (
          <section key={seed.uri} className={`because${i ? ' section' : ''}`}>
            <div className="section-title">
              <h2>Because you loved {seed.value.title}</h2>
            </div>
            {recs.length === 0 ? (
              <p className="small muted">{loading ? 'Looking…' : 'Nothing new to suggest yet.'}</p>
            ) : (
              <CardGrid size="compact" className="picks" label={`Because you loved ${seed.value.title}`}>
                {recs.map((r) => (
                  <RecommendationCard key={r.hiveId} rec={r} onDismiss={() => dismiss(r.hiveId)} />
                ))}
              </CardGrid>
            )}
          </section>
        ))
      )}
    </>
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

const YEAR = 365 * 24 * HOUR

function Recommendations({ library }: { library: BookEntry[] }) {
  const { did } = useSession()
  const network = useNetwork(did)
  const [notForMe, setNotForMe] = useState(() => loadNotForMe(did))
  // What you had when the page opened: a book you add here stays, showing your status.
  const [known] = useState(library)
  const twins = useMemo(() => tasteTwins(known, network.readers, did), [known, network.readers, did])
  const alike = twins.filter((t) => (t.match.score ?? 0) >= 60).length
  const { popular, loved } = useMemo(() => {
    const skip = excluded(known, notForMe)
    const popular = popularWithTwins(twins, skip)
    // Each book once: the readers like you come first.
    for (const p of popular) for (const k of sameBookKeys(p.book)) skip.add(k)
    const since = new Date(Date.now() - YEAR).toISOString()
    return { popular, loved: lovedInNetwork(network.readers, skip, { myDid: did, since }) }
  }, [twins, known, notForMe, network.readers, did])
  const scanning = network.status === 'loading'

  const dismiss = (hiveId: string) => {
    const next = [...notForMe, hiveId]
    setNotForMe(next)
    saveNotForMe(did, next)
  }

  return (
    <>
      <NetworkScan network={network} />
      <section>
        <div className="section-title">
          <h2>Popular with readers like you</h2>
          {alike > 0 && <span className="count">from {alike === 1 ? '1 reader' : `${alike} readers`} like you</span>}
        </div>
        {popular.length ? (
          <PickGrid picks={popular} label="Popular with readers like you" onDismiss={dismiss} />
        ) : scanning ? (
          <p className="small muted">Still looking through your network…</p>
        ) : alike === 0 ? (
          <p className="small muted">
            Nobody you follow reads quite like you yet. Rate more of your books, and the readers most like you show up in{' '}
            <Link to={PATHS.likeYou}>Like you</Link>.
          </p>
        ) : (
          <p className="small muted">The readers most like you haven't loved anything you don't already have. Yet.</p>
        )}
      </section>
      <section className="section">
        <div className="section-title">
          <h2>Loved by people you follow</h2>
          <span className="count">the past year</span>
        </div>
        {loved.length ? (
          <PickGrid picks={loved} label="Loved by people you follow" onDismiss={dismiss} />
        ) : (
          <p className="small muted">{scanning ? 'Still looking through your network…' : "Nothing you don't already have, from the past year."}</p>
        )}
      </section>
    </>
  )
}

function PickGrid({ picks, label, onDismiss }: { picks: NetworkPick[]; label: string; onDismiss: (hiveId: string) => void }) {
  return (
    <CardGrid size="compact" className="picks network-picks" label={label}>
      {picks.map((p) => {
        const v = p.book.value
        const stars = p.readers.reduce((sum, r) => sum + r.stars, 0) / p.readers.length
        return (
          <BookCard
            key={p.book.uri}
            size="compact"
            book={{ hiveId: v.hiveId, title: v.title, authors: v.authors, identifiers: v.identifiers, entry: p.book }}
            context={
              <p className="why">
                {lovedBy(p)} <Stars stars={Math.round(stars)} size={12} />
              </p>
            }
            more={[{ label: 'Not for me', onSelect: () => onDismiss(v.hiveId) }]}
          />
        )
      })}
    </CardGrid>
  )
}
