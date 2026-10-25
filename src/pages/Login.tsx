import { useRef, useState, type FormEvent } from 'react'
import { useAuth } from '../lib/auth'
import { describeError } from '../lib/errors'
import { checkIdentifier } from '../lib/identity'

const SPINES = ['#c8402a', '#e3a63b', '#f6f1e7', '#24543e', '#4b2a4f', '#c9dde3', '#c8402a', '#f6f1e7', '#e3a63b', '#24543e', '#7a3b2e', '#c9dde3']

/** Turns http(s) URLs in a notice (e.g. "Sign-in works at https://…") into links. */
function Linkified({ text }: { text: string }) {
  return (
    <>
      {text.split(/(https?:\/\/[^\s]+[^\s.,;:!?)])/g).map((part, i) =>
        i % 2 === 1 ? (
          <a key={i} href={part}>
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </>
  )
}

export function Login({ notice }: { notice?: string }) {
  const { startOAuthSignIn } = useAuth()
  const [identifier, setIdentifier] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // A ref, not state: a double click lands before React re-renders.
  const submitting = useRef(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (submitting.current) return
    const check = checkIdentifier(identifier)
    if (!check.ok) {
      setFieldError(check.message)
      return
    }
    submitting.current = true
    setBusy(true)
    setFieldError(null)
    setError(null)
    try {
      // Come back to the page that asked for sign-in, e.g. a shared book link.
      await startOAuthSignIn(check.value, window.location.pathname + window.location.search)
    } catch (err) {
      setError(describeError(err).message)
      submitting.current = false
      setBusy(false)
    }
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
          Covered. A better window onto your <a href="https://bookhive.buzz">BookHive</a> library, all of it stored on
          your own PDS.
        </p>
        {notice && (
          <div className="notice" role="status">
            <Linkified text={notice} />
          </div>
        )}
        <form onSubmit={submit} noValidate className="stack">
          <div className="field">
            <label htmlFor="identifier">Handle or DID</label>
            <input
              id="identifier"
              className="input"
              placeholder="alice.bsky.social"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={identifier}
              aria-invalid={!!fieldError}
              aria-describedby={fieldError ? 'identifier-error' : undefined}
              onChange={(e) => {
                setIdentifier(e.target.value)
                if (fieldError) setFieldError(null)
              }}
            />
            {fieldError && (
              <p id="identifier-error" className="field-error">
                {fieldError}
              </p>
            )}
          </div>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Taking you to your PDS…' : 'Continue to sign in'}
          </button>
          {error && (
            <div className="notice notice-error" role="alert">
              {error}
            </div>
          )}
          <p className="muted small">
            You'll be sent to your own PDS (Bluesky, or wherever your account lives) to approve access. Papertrail never
            sees your password and can only write BookHive book records. This browser stays signed in until you sign
            out or your PDS ends the session.
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
