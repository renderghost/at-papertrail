import { Link } from 'react-router-dom'
import { Empty, ErrorNote, Loading } from '../components/bits'
import { ReadingCard } from '../components/BookTile'
import { Icon } from '../components/Icon'
import { Shelves } from '../components/Shelves'
import { STATUS } from '../lib/bookhive/types'
import { useMyLibrary } from '../lib/hooks'
import { plural } from '../lib/format'

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

      {entries.length === 0 ? (
        <Empty title="Start your paper trail">
          <p>Search millions of books from Open Library and Google Books, matched to BookHive's catalogue.</p>
          <Link to="/add" className="btn btn-primary">
            Find a book
          </Link>
        </Empty>
      ) : (
        <>
          {reading.length > 0 && (
            <section>
              <div className="section-title">
                <h2>Currently reading</h2>
                <span className="count">{reading.length}</span>
              </div>
              <div className="reading-list">
                {reading.map((e) => (
                  <ReadingCard key={e.uri} entry={e} />
                ))}
              </div>
            </section>
          )}
          <section className="section">
            <div className="section-title">
              <h2>Shelves</h2>
            </div>
            <Shelves entries={entries} emptyMessage="No books with this status." />
          </section>
        </>
      )}
    </>
  )
}
