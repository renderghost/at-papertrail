# Papertrail

A social reading client for [BookHive](https://bookhive.buzz), built on the AT Protocol. Log every book, see what the people you follow are reading, find who's reading the same books as you, and get your reading year **Covered**.

Papertrail is a **pure front end**: a static site with no server and no database. You sign in with OAuth in the browser, and every write goes straight from your browser to your own PDS as a standard `buzz.bookhive.book` record. Anything you log here also appears on bookhive.buzz, and the reverse.

## What's in it

| | |
| --- | --- |
| **Library** | Your shelves (reading, want to read, finished, abandoned). Edit status, dates, progress (pages or %), half-star ratings, reviews and ownership. Re-reading a finished book keeps the earlier read in its history, as BookHive does. |
| **Add a book** | Searches Open Library and Google Books, then matches each result to BookHive's catalogue by `hiveId`. Matched books get BookHive's data and appear on bookhive.buzz. Unmatched ones still save, flagged. |
| **Feed** | "@friend started / finished / reviewed / wants to read …" from everyone you follow on Bluesky. |
| **Book club** | For each book you're reading: who you follow is reading it now, and who has read it before (their reviews are folded away to avoid spoilers). One tap opens a Bluesky post to start the conversation. |
| **Covered** | Wrapped-style story cards for any year or month: books and pages, month-by-month chart, top genres, longest and shortest, fastest read, highest rated, most-read author, bookends. |
| **Profiles** | Anyone's BookHive library, read-only. |

## How it works

```
Browser ──OAuth (DPoP)──▶ your PDS          writes: buzz.bookhive.book only
   │
   ├──▶ public.api.bsky.app                 profiles, who you follow
   ├──▶ plc.directory → each follow's PDS    their buzz.bookhive.book records
   ├──▶ @bookhive.buzz's PDS                 buzz.bookhive.catalogBook (rich book data, keyed by hiveId)
   └──▶ Open Library, Google Books           search, plus details for books BookHive hasn't catalogued
```

- **OAuth scope** is `atproto repo:buzz.bookhive.book`: Papertrail can only create, edit and delete BookHive book records. Everything it reads is public.
- **Sign-in** follows the pattern from [renderghost/at-assemblage#13](https://github.com/renderghost/at-assemblage/pull/13), using `@atcute/oauth-browser-client` (`src/lib/oauth.ts`, `src/lib/auth.tsx`):
  - Handles resolve over DNS-over-HTTPS and XRPC in a race; DID documents come from PLC or did:web.
  - The callback is read from the fragment or the query string, consumed once, and scrubbed from the URL. You land back on the page that asked you to sign in.
  - A session is restored once per page load (refresh tokens are single-use), with no loading flash when there's nothing to restore.
  - When the PDS rejects a token, Papertrail probes the grant. Credentials are deleted only if it is truly dead, never on a network blip. If your account moved PDS, the sign-in screen says so.
  - Signing in, signing out and session expiry all clear cached data, and stale expiry callbacks are ignored.
  - Every auth and PDS failure goes through one `describeError` (`src/lib/errors.ts`), so the UI only ever shows safe, actionable text.
- **Edits are compare-and-swap** (`swapRecord`), so a change made in bookhive.buzz is never silently overwritten. Fields Papertrail doesn't know about are preserved.
- **hiveIds** are reproduced exactly as BookHive generates them (`src/lib/bookhive/hiveId.ts`). This is pinned to `ohash@1` and verified against a real production id.
- **Status and date rules** mirror BookHive's `core/bookLifecycle.ts` (`src/lib/bookhive/lifecycle.ts`).
- **Your network** is scanned in the browser and cached in memory for 15 minutes (`src/lib/network.ts`).

### Good to know

- **Records on a PDS are public.** Your shelves, ratings and reviews can be read by anyone, as they can on BookHive.
- **Sign-in lasts up to about two weeks.** Browser-only OAuth sessions are capped by your PDS, after which you sign in again.
- **Feed dates for reviews and ratings are approximate**, because the record stores state rather than history ([#4](https://github.com/renderghost/at-papertrail/issues/4)).

## Development

```sh
npm install
npm run dev        # http://127.0.0.1:5173 (sign-in uses atproto's loopback client; no setup needed)
npm test           # unit tests for the domain logic
npm run build      # typecheck + production build into dist/
npm run preview    # serve the build at http://127.0.0.1:4173
```

Use `127.0.0.1`, not `localhost`. atproto's loopback OAuth client redirects there, and OAuth state is per-origin, so on `localhost` the sign-in screen explains this rather than offering a flow that can't finish.

Optional: put `VITE_GOOGLE_BOOKS_API_KEY=…` in `.env.local` for a higher Google Books quota. Search works without it.

## Deploying (Vercel)

Papertrail deploys on Vercel: every pull request gets a preview, and `main` goes to production at `https://papertrail.renderg.host/`. Full guide, covering first-time setup, DNS, previews, environment variables, security headers and troubleshooting: **[docs/deployment.md](docs/deployment.md)**.

- No environment variables are required. Each build works out its own URL from Vercel's system variables (production: the project's production domain; previews: their own URL), and generates the OAuth client document (`client-metadata.json`) for it.
- `vercel.json` routes the app's pages, adds the security headers (including a Content-Security-Policy) and sets caching.
- GitHub Actions (`.github/workflows/ci.yml`) typechecks, tests and builds every pull request.
- After each production deployment, `.github/workflows/verify-deployment.yml` checks the live site can sign people in. Run the same check yourself with `npm run check:deployment -- https://papertrail.renderg.host/`.

## Future scope

- [#1](https://github.com/renderghost/at-papertrail/issues/1) E-reader sync for the Xteink X4 (KOReader Sync). In the meantime, BookHive's own KOSync server writes progress Papertrail already shows.
- [#2](https://github.com/renderghost/at-papertrail/issues/2) Covered: reading goals for the months and years ahead
- [#3](https://github.com/renderghost/at-papertrail/issues/3) Search BookHive's catalogue directly once PDS proxying (or CORS) is available
- [#4](https://github.com/renderghost/at-papertrail/issues/4) Feed: accurate dates for reviews, ratings and abandoned books
- [#5](https://github.com/renderghost/at-papertrail/issues/5) Faster network loading for large follow graphs

## Credits

Built on [BookHive](https://github.com/nperez0111/bookhive)'s lexicons (MIT), with book data from BookHive's catalogue, [Open Library](https://openlibrary.org) and Google Books. Typeset in Fraunces and Inter.
