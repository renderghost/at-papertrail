import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Empty, ErrorNote, Loading } from '../components/bits'
import { ReadingCard } from '../components/BookTile'
import { CardGrid } from '../components/Cards'
import { Favourites } from '../components/Favourites'
import { Icon, type IconName } from '../components/Icon'
import { Shelves } from '../components/Shelves'
import { useSession } from '../lib/auth'
import { STATUS } from '../lib/bookhive/types'
import { plural } from '../lib/format'
import { useDocumentTitle, useMyLibrary } from '../lib/hooks'
import { PATHS, searchPath } from '../lib/paths'
import { ListsPage } from './Lists'

/**
 * Library (#104): Overview, Books, Lists and Manage, each its own tab.
 */

/** Add a book: a search that opens Discover › Search, where any result can be added. */
function AddABook() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  return (
    <form
      role="search"
      className="add-search"
      onSubmit={(e) => {
        e.preventDefault()
        navigate(searchPath(query))
      }}
    >
      <div className="search-wrap">
        <Icon name="search" />
        <input
          className="input search-input"
          type="search"
          placeholder="Title, author or ISBN"
          aria-label="Find a book to add"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <button type="submit" className="btn btn-primary">
        Search
      </button>
    </form>
  )
}

/** Library › Overview: what you're reading, adding a book, and your favourites. */
export function Overview() {
  const { did } = useSession()
  const library = useMyLibrary()
  useDocumentTitle('Your library')

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
          <p className="kicker">Library</p>
          <h1>Every book, logged.</h1>
          <p className="lede">
            {entries.length ? (
              <>
                <Link to={PATHS.books}>{plural(entries.length, 'book')}</Link> on your shelves · {plural(finishedThisYear, 'book')}{' '}
                finished this year.
              </>
            ) : (
              'Your shelves are empty. Add the first book you remember loving.'
            )}
          </p>
        </div>
      </div>

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

      <section className={reading.length ? 'section' : undefined}>
        <div className="section-title">
          <h2>Add a book</h2>
          <Link className="btn btn-quiet btn-sm" to={PATHS.scan}>
            <Icon name="scan" size={16} /> Scan a barcode
          </Link>
        </div>
        <AddABook />
        {entries.length === 0 && (
          <p className="small muted" style={{ marginTop: 12 }}>
            Coming from Goodreads, StoryGraph or Hardcover? <Link to={PATHS.switch}>Bring your books with you</Link>.
          </p>
        )}
      </section>

      {entries.length > 0 && <Favourites did={did} isMe />}
    </>
  )
}

/** Library › Books: every book you've logged, by status, with Select mode for changing many at once. */
export function LibraryBooks() {
  const library = useMyLibrary()
  useDocumentTitle('Your books')

  if (library.isPending) return <Loading>Fetching your library from your PDS…</Loading>
  if (library.isError) return <ErrorNote error={library.error} />

  const entries = library.data
  return (
    <>
      <div className="page-header">
        <div>
          <p className="kicker">Library</p>
          <h1>Your books</h1>
          <p className="lede">
            {entries.length
              ? `${plural(entries.length, 'book')}, by status. Show covers or details, or select books to change several at once.`
              : 'Every book you log gathers here.'}
          </p>
        </div>
      </div>
      {entries.length === 0 ? (
        <Empty title="No books yet">
          <p>Find a book to add, or bring your books from another app.</p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <Link to={PATHS.search} className="btn btn-primary">
              Find a book
            </Link>
            <Link to={PATHS.import} className="btn">
              Import
            </Link>
          </div>
        </Empty>
      ) : (
        <Shelves entries={entries} emptyMessage="No books with this status." editable />
      )}
    </>
  )
}

/** Library › Lists: your lists, and a new one. The same page others see at /shelves/you. */
export function LibraryLists() {
  const { did, session } = useSession()
  return <ListsPage actor={session.handle.startsWith('did:') ? did : session.handle} />
}

const TOOLS: { to: string; icon: IconName; title: string; blurb: string }[] = [
  { to: PATHS.scan, icon: 'scan', title: 'Scan', blurb: 'Scan a barcode to add a book, catalogue a shelf in one go, or check a book in a bookshop.' },
  { to: PATHS.import, icon: 'import', title: 'Import', blurb: 'Bring your books from Goodreads, StoryGraph or Hardcover. Nothing already here is overwritten.' },
  { to: PATHS.export, icon: 'export', title: 'Export', blurb: 'Download your library as JSON or a Goodreads CSV, whenever you like.' },
  { to: PATHS.fix, icon: 'refresh', title: 'Fix matches', blurb: "Match books to BookHive's catalogue so they show on bookhive.buzz, and merge duplicates." },
]

/** Library › Manage: the tools for your library, each opening its own page under Manage. */
export function Manage() {
  useDocumentTitle('Manage your library')
  return (
    <>
      <div className="page-header">
        <div>
          <p className="kicker">Library</p>
          <h1>Manage your library</h1>
          <p className="lede">Scan, import, export and tidy your books. They stay on your own PDS throughout.</p>
        </div>
      </div>
      <ul className="tool-grid" aria-label="Library tools">
        {TOOLS.map((t) => (
          <li key={t.to}>
            <article className="card tool-card">
              <span className="tool-icon" aria-hidden="true">
                <Icon name={t.icon} size={22} />
              </span>
              <div className="card-body">
                <h2 className="card-title">
                  <Link className="card-link" to={t.to}>
                    {t.title}
                  </Link>
                </h2>
                <p className="small muted">{t.blurb}</p>
              </div>
            </article>
          </li>
        ))}
      </ul>
    </>
  )
}
