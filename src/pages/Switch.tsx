import { Link } from 'react-router-dom'
import { useMaybeSession } from '../lib/auth'
import { useDocumentTitle } from '../lib/hooks'
import { loginPath } from '../lib/paths'

const SERVICES = [
  {
    id: 'goodreads',
    name: 'Goodreads',
    steps: [
      'On a computer (the Goodreads app can\'t export), open My Books.',
      'Under Tools, choose Import and export, then Export Library.',
      'Wait while Goodreads prepares the file; a big library takes a few minutes.',
      'Download the CSV from the dated link that appears on the same page.',
    ],
    href: 'https://www.goodreads.com/review/import',
  },
  {
    id: 'storygraph',
    name: 'StoryGraph',
    steps: [
      'Sign in on the web and open Manage Account from your profile menu.',
      'Find the export option on the User Export page and generate your library export.',
      'Download the CSV when it\'s ready.',
    ],
    href: 'https://app.thestorygraph.com',
  },
  {
    id: 'hardcover',
    name: 'Hardcover',
    steps: ['Open your account\'s Exports page.', 'Create a CSV export of your library.', 'Download it when it\'s ready.'],
    href: 'https://hardcover.app/account/exports',
  },
] as const

/** "Leaving Goodreads, StoryGraph or Hardcover": a public guide that ends in the importer (#48). */
export function SwitchPage() {
  useDocumentTitle('Switching to Papertrail')
  const signedIn = !!useMaybeSession()
  const toImport = signedIn ? '/import' : loginPath('/import')

  return (
    <article className="switch">
      <div className="page-header">
        <div>
          <p className="kicker">Switching</p>
          <h1>Bring your reading life with you</h1>
          <p className="lede">
            Leaving Goodreads, StoryGraph or Hardcover? Export your library there, import it here, and your books, dates,
            ratings and reviews come across. It takes a few minutes.
          </p>
        </div>
        <Link className="btn btn-primary" to={toImport}>
          {signedIn ? 'Import your file' : 'Sign in to import'}
        </Link>
      </div>

      <section className="section">
        <h2>1. Export your library</h2>
        <div className="switch-services">
          {SERVICES.map((s) => (
            <section key={s.id} className="panel" aria-labelledby={`export-${s.id}`}>
              <h3 id={`export-${s.id}`}>{s.name}</h3>
              <ol>
                {s.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <a className="small" href={s.href} target="_blank" rel="noreferrer">
                Open {s.name}
              </a>
            </section>
          ))}
        </div>
        <p className="small muted">Menus move about; if a step doesn't match what you see, look for "export" in your account settings.</p>
      </section>

      <section className="section stack">
        <h2>2. Import it here</h2>
        <p>
          Choose the file on the <Link to={toImport}>import page</Link>. It's read in your browser, and you'll see every
          change before anything is saved. Import only fills gaps: books already in your library keep what they have, and
          running it again only adds what's still missing.
        </p>
      </section>

      <section className="section switch-columns">
        <div>
          <h2>What comes across</h2>
          <ul>
            <li>Every book, with its status: read, reading, want to read, and did not finish</li>
            <li>The dates you added, started and finished each book</li>
            <li>Re-reads, where the export dates them (StoryGraph does)</li>
            <li>Ratings, in half stars</li>
            <li>Reviews (ones marked as spoilers only if you choose)</li>
            <li>Owned books</li>
            <li>Shelves, tags and lists, as lists if you like</li>
          </ul>
        </div>
        <div>
          <h2>What doesn't, yet</h2>
          <ul>
            <li>StoryGraph's quarter stars round to the nearest half.</li>
            <li>Moods, pace, content warnings and private notes have no shared place to live yet. Keep your export: they can come across later.</li>
            <li>Goodreads only dates your latest read of each book, so earlier re-reads can't be dated.</li>
          </ul>
        </div>
      </section>

      <section className="section">
        <h2>What's different here</h2>
        <ul>
          <li>
            <strong>Your data lives on your own PDS</strong>, the server that holds your AT Protocol account, not in a
            company's database.
          </li>
          <li>
            <strong>One library, several apps.</strong> Papertrail writes the same records as{' '}
            <a href="https://bookhive.buzz">BookHive</a> and <a href="https://popfeed.social">PopFeed</a>, so your books show
            up there too.
          </li>
          <li>
            <strong>You can leave any time.</strong> <Link to="/export">Export</Link> to JSON or a Goodreads CSV whenever you
            like, or just use another app: your records stay where they are.
          </li>
        </ul>
      </section>

      <section className="section stack">
        <h2>Need an account?</h2>
        <p>
          If you're on Bluesky, you already have one: sign in with your Bluesky handle. Otherwise, create an account at{' '}
          <a href="https://bsky.app">bsky.app</a> or with any other AT Protocol host, then come back and sign in.
        </p>
        <div>
          <Link className="btn btn-primary" to={toImport}>
            {signedIn ? 'Import your file' : 'Sign in to import'}
          </Link>
        </div>
      </section>
    </article>
  )
}
