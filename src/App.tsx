import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { Loading } from './components/bits'
import { Layout } from './components/Layout'
import { StatusPromptProvider } from './components/StatusPrompts'
import { ToastProvider } from './components/Toast'
import { AuthProvider, useAuth } from './lib/auth'
import { MOVED, movedPath } from './lib/nav'
import { bookPath, loginPath, safeNext } from './lib/paths'
import { AddBook } from './pages/AddBook'
import { AuthorPage } from './pages/AuthorPage'
import { BookClub } from './pages/BookClub'
import { BookPage } from './pages/BookPage'
import { Feed } from './pages/Feed'
import { LibraryBooks, LibraryLists, Manage, Overview } from './pages/Library'
import { ListPage, ListsPage } from './pages/Lists'
import { Login } from './pages/Login'
import { NotFound } from './pages/NotFound'
import { Profile } from './pages/Profile'

// Pages most visits never open load on demand, keeping the first load small.
const Covered = lazy(() => import('./pages/Covered').then((m) => ({ default: m.Covered })))
const ImportPage = lazy(() => import('./pages/Import').then((m) => ({ default: m.ImportPage })))
const ExportPage = lazy(() => import('./pages/Export').then((m) => ({ default: m.ExportPage })))
const FixPage = lazy(() => import('./pages/Fix').then((m) => ({ default: m.FixPage })))
const SwitchPage = lazy(() => import('./pages/Switch').then((m) => ({ default: m.SwitchPage })))
const ScanPage = lazy(() => import('./pages/Scan').then((m) => ({ default: m.ScanPage })))
const SeriesPage = lazy(() => import('./pages/SeriesPage').then((m) => ({ default: m.SeriesPage })))
const TwinsPage = lazy(() => import('./pages/Twins').then((m) => ({ default: m.TwinsPage })))
const WantToReadPage = lazy(() => import('./pages/WantToRead').then((m) => ({ default: m.WantToReadPage })))
const ExplorePage = lazy(() => import('./pages/Explore').then((m) => ({ default: m.ExplorePage })))
const GenrePage = lazy(() => import('./pages/Explore').then((m) => ({ default: m.GenrePage })))
const BecauseYouLovedPage = lazy(() => import('./pages/Discover').then((m) => ({ default: m.BecauseYouLovedPage })))
const PickNextReadPage = lazy(() => import('./pages/Discover').then((m) => ({ default: m.PickNextReadPage })))
const ContinueSeriesPage = lazy(() => import('./pages/Discover').then((m) => ({ default: m.ContinueSeriesPage })))
const RecommendationsPage = lazy(() => import('./pages/Discover').then((m) => ({ default: m.RecommendationsPage })))

function OnDemand({ children }: { children: ReactNode }) {
  return <Suspense fallback={<Loading />}>{children}</Suspense>
}

/** Pages that need your session; signed out, they send you to sign in and back. */
function RequireSession() {
  const { state } = useAuth()
  const location = useLocation()
  if (state.status !== 'signed-in') {
    return <Navigate to={loginPath(location.pathname + location.search)} replace />
  }
  return <Outlet />
}

function LoginRoute() {
  const { state } = useAuth()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next')) ?? '/'
  if (state.status === 'signed-in') return <Navigate to={next} replace />
  return <Login notice={state.status === 'signed-out' ? state.notice : undefined} next={next} />
}

/** Links from before the /books/ paths. */
function OldBookPath() {
  const { hiveId = '' } = useParams()
  return <Navigate to={bookPath(hiveId)} replace />
}

/** Links from before the two-level navigation (#104): the same page at its new address, query and all. */
function Moved({ move }: { move: { from: string; to: string } }) {
  const { pathname, search, hash } = useLocation()
  return <Navigate to={`${movedPath(pathname, move)}${search}${hash}`} replace />
}

function AppRoutes() {
  const { state } = useAuth()
  if (state.status === 'restoring') {
    return (
      <div className="page">
        <Loading>Opening your library…</Loading>
      </div>
    )
  }
  const signedIn = state.status === 'signed-in'
  return (
    <Routes>
      <Route path="login" element={<LoginRoute />} />
      {!signedIn && <Route index element={<Login notice={state.notice} next="/" />} />}
      <Route path="book/:hiveId" element={<OldBookPath />} />
      <Route element={<Layout />}>
        {/* Public: everything they show is public data, so they work signed out. */}
        <Route path="books/:hiveId" element={<BookPage />} />
        <Route path="profile/:actor" element={<Profile />} />
        <Route path="authors/:name" element={<AuthorPage />} />
        <Route path="authors/:name/series/:series" element={<OnDemand><SeriesPage /></OnDemand>} />
        <Route path="shelves/:actor" element={<ListsPage />} />
        <Route path="shelves/:actor/:rkey" element={<ListPage />} />
        <Route path="switch" element={<OnDemand><SwitchPage /></OnDemand>} />
        <Route path="discover/browse" element={<OnDemand><ExplorePage /></OnDemand>} />
        <Route path="discover/browse/genres/:genre" element={<OnDemand><GenrePage /></OnDemand>} />
        {MOVED.map((move) => (
          <Route key={move.from} path={`${move.from.slice(1)}/*`} element={<Moved move={move} />} />
        ))}
        <Route path="library" element={<Navigate to="/" replace />} />
        <Route element={<RequireSession />}>
          {/* Library */}
          {signedIn && <Route index element={<Overview />} />}
          <Route path="library/books" element={<LibraryBooks />} />
          <Route path="library/lists" element={<LibraryLists />} />
          <Route path="library/manage" element={<Manage />} />
          <Route path="library/manage/scan" element={<OnDemand><ScanPage /></OnDemand>} />
          <Route path="library/manage/import" element={<OnDemand><ImportPage /></OnDemand>} />
          <Route path="library/manage/export" element={<OnDemand><ExportPage /></OnDemand>} />
          <Route path="library/manage/fix" element={<OnDemand><FixPage /></OnDemand>} />
          {/* Friends */}
          <Route path="friends" element={<Feed />} />
          <Route path="friends/club" element={<BookClub />} />
          <Route path="friends/like-you" element={<OnDemand><TwinsPage /></OnDemand>} />
          <Route path="friends/ask-around" element={<OnDemand><WantToReadPage /></OnDemand>} />
          {/* Discover; Browse all is public, above */}
          <Route path="discover" element={<OnDemand><BecauseYouLovedPage /></OnDemand>} />
          <Route path="discover/next-read" element={<OnDemand><PickNextReadPage /></OnDemand>} />
          <Route path="discover/series" element={<OnDemand><ContinueSeriesPage /></OnDemand>} />
          <Route path="discover/recommendations" element={<OnDemand><RecommendationsPage /></OnDemand>} />
          <Route path="discover/search" element={<AddBook />} />
          {/* Covered */}
          <Route path="covered" element={<OnDemand><Covered /></OnDemand>} />
          <Route path="covered/:period" element={<OnDemand><Covered /></OnDemand>} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}

export function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <AuthProvider>
        <ToastProvider>
          <StatusPromptProvider>
            <AppRoutes />
          </StatusPromptProvider>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
