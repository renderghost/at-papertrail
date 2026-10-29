import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { Loading } from './components/bits'
import { Layout } from './components/Layout'
import { AuthProvider, useAuth } from './lib/auth'
import { bookPath, loginPath, safeNext } from './lib/paths'
import { AddBook } from './pages/AddBook'
import { AuthorPage } from './pages/AuthorPage'
import { BookClub } from './pages/BookClub'
import { BookPage } from './pages/BookPage'
import { Covered } from './pages/Covered'
import { Feed } from './pages/Feed'
import { Library } from './pages/Library'
import { ListPage, ListsPage } from './pages/Lists'
import { Login } from './pages/Login'
import { NotFound } from './pages/NotFound'
import { Profile } from './pages/Profile'

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
        <Route element={<RequireSession />}>
          {signedIn && <Route index element={<Library />} />}
          <Route path="add" element={<AddBook />} />
          <Route path="feed" element={<Feed />} />
          <Route path="club" element={<BookClub />} />
          <Route path="covered" element={<Covered />} />
          <Route path="covered/:period" element={<Covered />} />
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
