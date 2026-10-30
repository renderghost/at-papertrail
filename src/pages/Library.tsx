import { Link } from 'react-router-dom'
import { Empty, ErrorNote, Loading } from '../components/bits'
import { ReadingCard } from '../components/BookTile'
import { CardGrid } from '../components/Cards'
import { Icon } from '../components/Icon'
import { ListsGrid } from '../components/Lists'
import { ContinueSeries } from '../components/Series'
import { Shelves } from '../components/Shelves'
import { useSession } from '../lib/auth'
import { STATUS } from '../lib/bookhive/types'
import { plural } from '../lib/format'
import { useMyLibrary } from '../lib/hooks'
import { shelvesPath } from '../lib/paths'
import { useLists } from '../lib/useLists'

/** Your four newest lists, with a way to make more. */
function YourLists() {
  const { did, session } = useSession()
  const lists = useLists(did)
  const handle = session.handle.startsWith('did:') ? did : session.handle
  return (
    <section className="section">
      <div className="section-title">
        <h2>Your lists</h2>
        <Link className="btn btn-quiet btn-sm" to={shelvesPath(handle)}>
          {lists.data?.length ? 'All lists' : 'Make a list'}
        </Link>
      </div>
      {lists.data?.length ? (
        <ListsGrid lists={lists.data.slice(0, 4)} owner={handle} />
      ) : (
        <p className="muted small">
          Lists you make here are saved on your PDS in BookHive and PopFeed's format, so they show on both.
        </p>
      )}
    </section>
  )
}

export function Library() {
  const library = useMyLibrary()

  if (library.isPending) return <Loading>Fetching your library from your PDS…</Loading>
  if (library.isError) return <ErrorNote error={library.error} />

  const entries = library.data
  const reading = entries.filter((e) => e.value.status === STATUS.reading)
  const finishedThisYear = entries.filter(
    (e) => e.value.status === STATUS.finished && e.value.finishedAt?.startsWith(String(new Date().getUTCFullYear())),
  ).length

  return (
    <>
      <div className="page-header">
        <div>
          <p className="kicker">Your library</p>
          <h1>Every book, logged.</h1>
          <p className="lede">
            {entries.length
              ? `${plural(entries.length, 'book')} on your shelves · ${plural(finishedThisYear, 'book')} finished this year.`
              : 'Your shelves are empty. Add the first book you remember loving.'}
          </p>
        </div>
        <Link to="/add" className="btn btn-primary">
          <Icon name="plus" size={18} /> Add a book
        </Link>
      </div>
      <nav className="library-tools small" aria-label="Library tools">
        <Link to="/scan">Scan</Link>
        <Link to="/import">Import</Link>
        <Link to="/export">Export</Link>
        <Link to="/fix">Fix matches</Link>
      </nav>

      {entries.length === 0 ? (
        <Empty title="Start your paper trail">
          <p>Search millions of books from Open Library and Google Books, matched to BookHive's catalogue.</p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <Link to="/add" className="btn btn-primary">
              Find a book
            </Link>
            <Link to="/switch" className="btn">
              Bring your Goodreads, StoryGraph or Hardcover books
            </Link>
          </div>
        </Empty>
      ) : (
        <>
          {reading.length > 0 && (
            <section>
              <div className="section-title">
                <h2>Currently reading</h2>
                <span className="count">{reading.length}</span>
              </div>
              <CardGrid size="large" className="reading-list" label="Currently reading">
                {reading.map((e) => (
                  <ReadingCard key={e.uri} entry={e} />
                ))}
              </CardGrid>
            </section>
          )}
          <ContinueSeries entries={entries} />
          <YourLists />
          <section className="section">
            <div className="section-title">
              <h2>Shelves</h2>
            </div>
            <Shelves entries={entries} emptyMessage="No books with this status." editable />
          </section>
        </>
      )}
    </>
  )
}
