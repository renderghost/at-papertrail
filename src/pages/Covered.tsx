import { useMemo } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Empty, ErrorNote, Loading } from '../components/bits'
import { CoveredStory } from '../components/CoveredStory'
import { Icon } from '../components/Icon'
import { availablePeriods, MONTHS, parsePeriodSlug, periodSlug, readsIn } from '../lib/covered'
import { plural } from '../lib/format'
import { useMyLibrary } from '../lib/hooks'
import { PATHS } from '../lib/paths'

export function Covered() {
  const { period: slug } = useParams()
  const navigate = useNavigate()
  const library = useMyLibrary()
  const books = useMemo(() => library.data ?? [], [library.data])
  const periods = useMemo(() => availablePeriods(books), [books])
  const period = useMemo(() => parsePeriodSlug(slug), [slug])
  const thisYear = new Date().getUTCFullYear()

  if (library.isPending) return <Loading />
  if (library.isError) return <ErrorNote error={library.error} />

  return (
    <>
      <div className="page-header">
        <div>
          <p className="kicker">Covered</p>
          <h1>Your reading, in review</h1>
          <p className="lede">
            Pick a year or a month and play it back: what you finished, how fast, how long, what you loved.
          </p>
        </div>
        {periods.length > 0 && (
          <Link className="btn btn-accent" to={`/covered/${periods[0]!.year}`}>
            <Icon name="play" size={16} /> Play {periods[0]!.year}
          </Link>
        )}
      </div>

      {periods.length === 0 ? (
        <Empty title="Nothing to cover yet">
          <p>Finish a book (or log one you finished before) and your first Covered appears here.</p>
          <Link className="btn btn-primary" to={PATHS.search}>
            Log a book
          </Link>
        </Empty>
      ) : (
        <div className="stack" style={{ gap: 32 }}>
          {periods.map(({ year, months }) => {
            const count = readsIn(books, { kind: 'year', year }).length
            return (
              <section key={year}>
                <div className="period-grid">
                  <button className="period-card" onClick={() => navigate(`/covered/${year}`)}>
                    <span className="meta">{year === thisYear ? 'This year, so far' : 'Year'}</span>
                    <span className="year">{year}</span>
                    <span className="row" style={{ justifyContent: 'space-between' }}>
                      <span className="meta">{plural(count, 'book')} finished</span>
                      <Icon name="play" size={18} />
                    </span>
                  </button>
                </div>
                <div className="months" aria-label={`Months in ${year}`}>
                  {months.map((m) => (
                    <Link
                      key={m}
                      className="chip"
                      to={`/covered/${periodSlug({ kind: 'month', year, month: m })}`}
                      style={{ textDecoration: 'none' }}
                    >
                      {MONTHS[m]}
                      <span className="n">{readsIn(books, { kind: 'month', year, month: m }).length}</span>
                    </Link>
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}

      {period && <CoveredStory books={books} period={period} onClose={() => navigate('/covered')} />}
    </>
  )
}
