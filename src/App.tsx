import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Loading } from './components/bits'
import { Layout } from './components/Layout'
import { AuthProvider, useAuth } from './lib/auth'
import { AddBook } from './pages/AddBook'
import { BookClub } from './pages/BookClub'
import { BookPage } from './pages/BookPage'
import { Covered } from './pages/Covered'
import { Feed } from './pages/Feed'
import { Library } from './pages/Library'
import { Login } from './pages/Login'
import { NotFound } from './pages/NotFound'
import { Profile } from './pages/Profile'

function Gate() {
  const { state } = useAuth()
  if (state.status === 'restoring') {
    return (
      <div className="page">
        <Loading>Opening your library…</Loading>
      </div>
    )
  }
  if (state.status === 'signed-out') return <Login notice={state.notice} />
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Library />} />
        <Route path="add" element={<AddBook />} />
        <Route path="book/:hiveId" element={<BookPage />} />
        <Route path="feed" element={<Feed />} />
        <Route path="club" element={<BookClub />} />
        <Route path="covered" element={<Covered />} />
        <Route path="covered/:period" element={<Covered />} />
        <Route path="profile/:actor" element={<Profile />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}

export function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </BrowserRouter>
  )
}
