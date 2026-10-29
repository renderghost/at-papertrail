import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { Loading } from './components/bits'
import { Layout } from './components/Layout'
import { AuthProvider, useAuth } from './lib/auth'
import { bookPath, loginPath, safeNext } from './lib/paths'
import { AddBook } from './pages/AddBook'
import { AuthorPage } from './pages/AuthorPage'
import { BookClub } from './pages/BookClub'
import { BookPage } from './pages/BookPage'
import { Feed } from './pages/Feed'
import { Library } from './pages/Library'
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
        <Route path="shelves/:actor" element={<ListsPage />} />
        <Route path="shelves/:actor/:rkey" element={<ListPage />} />
        <Route path="switch" element={<OnDemand><SwitchPage /></OnDemand>} />
        <Route element={<RequireSession />}>
          {signedIn && <Route index element={<Library />} />}
          <Route path="add" element={<AddBook />} />
          <Route path="feed" element={<Feed />} />
          <Route path="club" element={<BookClub />} />
          <Route path="covered" element={<OnDemand><Covered /></OnDemand>} />
          <Route path="covered/:period" element={<OnDemand><Covered /></OnDemand>} />
          <Route path="import" element={<OnDemand><ImportPage /></OnDemand>} />
          <Route path="export" element={<OnDemand><ExportPage /></OnDemand>} />
          <Route path="fix" element={<OnDemand><FixPage /></OnDemand>} />
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
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
