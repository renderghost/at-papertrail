import { useState, type FormEvent } from 'react'
import { useAuth } from '../lib/auth'

const SPINES = ['#c8402a', '#e3a63b', '#f6f1e7', '#24543e', '#4b2a4f', '#c9dde3', '#c8402a', '#f6f1e7', '#e3a63b', '#24543e', '#7a3b2e', '#c9dde3']

export function Login() {
  const { state, signIn } = useAuth()
  const [handle, setHandle] = useState('')
  const [busy, setBusy] = useState(false)
  const error = state.status === 'signedOut' ? state.error : undefined

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!handle.trim()) return
    setBusy(true)
    await signIn(handle)
    // Only reached if the redirect didn't happen.
    setBusy(false)
  }

  return (
    <div className="login">
      <div className="login-form">
        <p className="kicker">Social reading on the AT Protocol</p>
        <h1>
          Papertrail<span className="wordmark-dot">.</span>
        </h1>
        <p className="lede">
          Log every book, see what the people you follow are reading, find your book club, and get your reading life
          Covered. A better window onto your <a href="https://bookhive.buzz">BookHive</a> library — all of it stored on
          your own PDS.
        </p>
        <form onSubmit={submit} className="stack">
          <div className="field">
            <label htmlFor="handle">Your handle</label>
            <input
              id="handle"
              className="input"
              placeholder="alice.bsky.social"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
            />
          </div>
          {error && (
            <div className="notice notice-error" role="alert">
              {error}
            </div>
          )}
          <button className="btn btn-primary" type="submit" disabled={busy || !handle.trim()}>
            {busy ? 'Opening sign-in…' : 'Sign in with your PDS'}
          </button>
          <p className="muted small">
            You'll sign in on your own PDS (Bluesky, or wherever your account lives). Papertrail only asks to write
            BookHive book records; everything else it shows is public.
          </p>
        </form>
      </div>
      <div className="login-art" aria-hidden="true">
        <div className="spines">
          {SPINES.map((c, i) => (
            <span key={i} style={{ background: c, height: `${55 + ((i * 37) % 45)}%` }} />
          ))}
        </div>
        <blockquote>
          “I have always imagined that Paradise will be a kind of library.”
          <cite>Jorge Luis Borges</cite>
        </blockquote>
      </div>
    </div>
  )
}
