import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth, useMaybeSession } from '../lib/auth'
import { useProfile } from '../lib/hooks'
import { loginPath, profilePath } from '../lib/paths'
import { Avatar } from './bits'
import { Icon, type IconName } from './Icon'

const NAV: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: '/', label: 'Library', icon: 'library', end: true },
  { to: '/feed', label: 'Feed', icon: 'feed' },
  { to: '/club', label: 'Book club', icon: 'club' },
  { to: '/covered', label: 'Covered', icon: 'covered' },
]

type Theme = 'light' | 'dark'
const THEME_KEY = 'papertrail-theme'

function storedTheme(): Theme | null {
  try {
    const t = localStorage.getItem(THEME_KEY)
    return t === 'light' || t === 'dark' ? t : null
  } catch {
    return null
  }
}

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(storedTheme)
  const systemDark = typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches
  const effective = theme ?? (systemDark ? 'dark' : 'light')

  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme
    else delete document.documentElement.dataset.theme
  }, [theme])

  const toggle = () => {
    const next: Theme = effective === 'dark' ? 'light' : 'dark'
    setTheme(next)
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {
      // Private mode: the choice just won't persist.
    }
  }

  return (
    <button className="icon-btn" onClick={toggle} title={`Switch to ${effective === 'dark' ? 'light' : 'dark'} mode`}>
      <Icon name={effective === 'dark' ? 'sun' : 'moon'} label={`Switch to ${effective === 'dark' ? 'light' : 'dark'} mode`} />
    </button>
  )
}

export function Layout() {
  const me = useMaybeSession()
  const { signOut } = useAuth()
  const profile = useProfile(me?.did)
  const location = useLocation()

  return (
    <>
      <header className={`masthead${me ? '' : ' masthead-public'}`}>
        <div className="masthead-inner">
          <Link to="/" className="wordmark">
            Papertrail<span className="wordmark-dot">.</span>
          </Link>
          {me && (
            <nav className="nav" aria-label="Main">
              {NAV.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end}>
                  <span className="nav-icon">
                    <Icon name={item.icon} size={22} />
                  </span>
                  {item.label}
                </NavLink>
              ))}
            </nav>
          )}
          <div className="masthead-tools">
            {me ? (
              <Link to="/add" className="btn btn-accent btn-sm" title="Add a book">
                <Icon name="plus" size={16} />
                <span>Add</span>
              </Link>
            ) : (
              <Link to={loginPath(location.pathname + location.search)} className="btn btn-primary btn-sm">
                Sign in
              </Link>
            )}
            <ThemeToggle />
            {profile.data && (
              <Link to={profilePath(profile.data.handle)} title={`@${profile.data.handle}`}>
                <Avatar profile={profile.data} size={32} />
              </Link>
            )}
            {me && (
              <button className="icon-btn" onClick={() => void signOut()} title="Sign out">
                <Icon name="logout" label="Sign out" />
              </button>
            )}
          </div>
        </div>
      </header>
      <main className="page">
        <Outlet />
      </main>
      <footer className="footer">
        Papertrail reads and writes <code>buzz.bookhive.book</code> records on your own PDS, so everything here also
        shows up on <a href="https://bookhive.buzz">BookHive</a>. Book data from BookHive's catalogue,{' '}
        <a href="https://openlibrary.org">Open Library</a> and Google Books.
      </footer>
    </>
  )
}
