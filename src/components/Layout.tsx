import { useEffect, useId, useRef, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { useAuth, useMaybeSession } from '../lib/auth'
import { FEATURES } from '../lib/features'
import { displayName } from '../lib/format'
import { useProfile } from '../lib/hooks'
import { AREAS, areaOf, currentness, normalisePath, tabOf, type NavArea } from '../lib/nav'
import { loginPath, PATHS, profilePath } from '../lib/paths'
import { Avatar } from './bits'
import { Icon } from './Icon'
import { usePopoverPlacement } from './popover'

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

/** Light or dark: your choice, remembered in this browser, else your system's. */
function useTheme() {
  const [theme, setTheme] = useState<Theme | null>(storedTheme)
  const systemDark = typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches
  const dark = (theme ?? (systemDark ? 'dark' : 'light')) === 'dark'

  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme
    else delete document.documentElement.dataset.theme
  }, [theme])

  const toggle = () => {
    const next: Theme = dark ? 'light' : 'dark'
    setTheme(next)
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {
      // Private mode: the choice just won't persist.
    }
  }
  return { dark, toggle }
}

function ThemeToggle() {
  const { dark, toggle } = useTheme()
  const label = `Switch to ${dark ? 'light' : 'dark'} mode`
  return (
    <button className="icon-btn" onClick={toggle} title={label}>
      <Icon name={dark ? 'sun' : 'moon'} label={label} />
    </button>
  )
}

/**
 * Your account (#104): your profile, the guide for switching from another
 * app, light or dark, and signing out. Plain links and buttons in a popover,
 * like ⋯ More: Tab moves through them, Escape closes it.
 */
function AccountMenu({ did, handle }: { did: string; handle: string }) {
  const { signOut } = useAuth()
  const profile = useProfile(did)
  const { dark, toggle } = useTheme()
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  // The masthead stays put as the page scrolls, so the menu can too.
  usePopoverPlacement(trigger, panel)
  const close = () => panel.current?.hidePopover()
  const me = profile.data ?? { handle }

  return (
    <>
      <button ref={trigger} type="button" className="account-btn" popoverTarget={id} aria-label={`Your account, @${me.handle}`} title={`@${me.handle}`}>
        <Avatar profile={me} size={32} />
      </button>
      <div ref={panel} id={id} popover="auto" className="more-menu account-menu">
        <p className="account-who">
          <strong>{displayName(me)}</strong>
          <span className="small muted">@{me.handle}</span>
        </p>
        <Link to={profilePath(me.handle)} onClick={close}>
          Your profile
        </Link>
        <Link to={PATHS.switch} onClick={close}>
          Switch from another app
        </Link>
        <button type="button" onClick={toggle}>
          {dark ? 'Light mode' : 'Dark mode'}
        </button>
        <button
          type="button"
          onClick={() => {
            close()
            void signOut()
          }}
        >
          Sign out
        </button>
      </div>
    </>
  )
}

/** An area's tabs, the second and last level. On a phone they scroll sideways, keeping the current one in view. */
function Tabs({ area, path }: { area: NavArea; path: string }) {
  const tab = tabOf(area, path)
  const strip = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const s = strip.current
    const el = s?.querySelector<HTMLElement>('[aria-current]')
    if (!s || !el) return
    if (el.offsetLeft < s.scrollLeft || el.offsetLeft + el.offsetWidth > s.scrollLeft + s.clientWidth) {
      s.scrollLeft = el.offsetLeft - (s.clientWidth - el.offsetWidth) / 2
    }
  }, [tab])

  return (
    <nav className="tabs" aria-label={area.label}>
      <div className="tabs-inner" ref={strip}>
        {area.tabs.map((t) => (
          <Link key={t.to} to={t.to} aria-current={currentness(path, t.to, t === tab)}>
            {t.label}
          </Link>
        ))}
      </div>
    </nav>
  )
}

export function Layout() {
  const me = useMaybeSession()
  const location = useLocation()
  const path = normalisePath(location.pathname)
  const area = me ? areaOf(path) : undefined
  // A handle that's still a DID: there's no handle to show yet.
  const handle = me ? (me.session.handle.startsWith('did:') ? me.did : me.session.handle) : ''

  return (
    <>
      <header className={`masthead${me ? '' : ' masthead-public'}`}>
        <div className="masthead-inner">
          <Link to="/" className="wordmark">
            Papertrail<span className="wordmark-dot">.</span>
          </Link>
          {me && (
            <nav className="nav" aria-label="Main">
              {AREAS.map((a) => (
                <Link key={a.to} to={a.to} aria-current={currentness(path, a.to, a === area)}>
                  <span className="nav-icon">
                    <Icon name={a.icon} size={22} />
                  </span>
                  {a.label}
                </Link>
              ))}
            </nav>
          )}
          <div className="masthead-tools">
            {me ? (
              <>
                <Link to={PATHS.search} className="btn btn-accent btn-sm" title="Find a book">
                  <Icon name="search" size={16} />
                  <span>Search</span>
                </Link>
                <AccountMenu did={me.did} handle={handle} />
              </>
            ) : (
              <>
                <Link to={loginPath(location.pathname + location.search)} className="btn btn-primary btn-sm">
                  Sign in
                </Link>
                <ThemeToggle />
              </>
            )}
          </div>
        </div>
      </header>
      {area && area.tabs.length > 0 && <Tabs area={area} path={path} />}
      <main className="page">
        <Outlet />
      </main>
      <footer className="footer">
        Papertrail saves your books, lists and favourites on your own PDS in the formats{' '}
        <a href="https://bookhive.buzz">BookHive</a> and <a href="https://popfeed.social">PopFeed</a> use, so they show up
        there too. Book data from BookHive's catalogue,{' '}
        {FEATURES.byline && (
          <>
            <a href="https://byline.pub">Byline</a>,{' '}
          </>
        )}
        <a href="https://openlibrary.org">Open Library</a> and Google Books.
      </footer>
    </>
  )
}
