# Papertrail

A social reading client for [BookHive](https://bookhive.buzz), built on the AT Protocol. Log every book, see what the people you follow are reading, find who's reading the same books as you, and get your reading year **Covered**.

Papertrail is a **front end with no database**: a static site plus two small, stateless functions. You sign in with OAuth in the browser, and every write goes straight from your browser to your own PDS, in the formats BookHive and PopFeed already use: `buzz.bookhive.book` for your books, PopFeed lists for your lists and shelves, PopFeed's profile record for your favourites, Bluesky follows for people. Anything you do here also appears on bookhive.buzz (and PopFeed), and the reverse.

## What's in it

| | |
| --- | --- |
| **Library** | Your shelves (reading, want to read, finished, abandoned). Edit status, dates, progress (pages or %), half-star ratings, reviews and ownership. Re-reading a finished book keeps the earlier read in its history, as BookHive does. |
| **Add a book** | Searches BookHive's own catalogue first, then Open Library and Google Books (duplicates dropped), matching each of those to BookHive by `hiveId`. Catalogued books appear on bookhive.buzz. Uncatalogued ones still save, flagged. |
| **Book pages** | `/books/bk_…`, the same paths as bookhive.buzz. Catalogue details, series, the rating spread, your reading and re-reads, the lists it's on, the author's own details when they're on [Byline](https://byline.pub), what people you follow thought (on BookHive and PopFeed, spoilers hidden), and every BookHive review and comment. |
| **Lists** | `/shelves/:handle/:rkey`. Make, rank, reorder, annotate and share book lists; add from any book page or your library. Stored as PopFeed lists exactly as BookHive writes them, so they show on both. PopFeed's own shelves appear read-only. |
| **Authors** | `/authors/:name`. The bibliography (editions merged, series in order), you and the author, which friends read them, and the author's Byline profile, follow button and forthcoming books, or an invitation to claim the page. |
| **Feed** | "@friend started / finished / reviewed / wants to read …" from everyone you follow on Bluesky. |
| **Book club** | For each book you're reading: who you follow is reading it now, and who has read it before (their reviews are folded away to avoid spoilers). One tap opens a Bluesky post to start the conversation. |
| **Covered** | Wrapped-style story cards for any year or month: books and pages, month-by-month chart, top genres, longest and shortest, fastest read, highest rated, most-read author, bookends. |
| **Profiles** | `/profile/:handle`: bio and links, currently reading, favourite books (PopFeed's `favorites.books`, editable on your own), lists, latest reviews, shelves, and a follow button. |
| **Link previews** | Book, profile, list and author links unfold into proper cards on Bluesky, Slack, Discord and the like. |

Book, profile, list and author pages are public: they work signed out.

## How it works

```
Browser ──OAuth (DPoP)──▶ your PDS          writes: buzz.bookhive.book, social.popfeed.feed.list / listItem,
   │                                                social.popfeed.actor.profile (favourites), app.bsky.graph.follow
   │
   ├──▶ public.api.bsky.app                 profiles, who you follow
   ├──▶ plc.directory → each follow's PDS    their buzz.bookhive.book records
   ├──▶ each follow's PDS                    their social.popfeed.feed.review book reviews (read only)
   ├──▶ relay1.us-east.bsky.network          which follows use BookHive or PopFeed; Byline's authors
   ├──▶ Byline authors' PDSes                pub.byline.profile, pub.byline.book (author-signed details)
   ├──▶ @bookhive.buzz's PDS                 buzz.bookhive.catalogBook (rich book data, keyed by hiveId)
   ├──▶ /api/bookhive/* (Vercel function) ─▶ bookhive.buzz's XRPC: search, reviews, comments (no CORS upstream)
   └──▶ Open Library, Google Books           search, plus details for books BookHive hasn't catalogued
```

- **OAuth scopes** name exactly the collections above (`src/lib/oauthConfig.ts`); follows are create and delete only. Everything Papertrail reads is public. A session from before a scope was added is asked to sign in once more, at the moment it's needed, and comes straight back.
- **Link previews:** `vercel.json` sends requests from link-preview crawlers for those pages to `api/share.ts`, which answers with Open Graph tags built from public data; people get the app as usual.
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
- **Your network** is scanned in the browser (`src/lib/network.ts`): only follows the relay's index lists as BookHive or PopFeed users, a copy of the last scan in IndexedDB so a reload is instant, and a repo is re-read only when its latest commit has changed.
- **The BookHive relay** (`api/bookhive/[method].ts`) forwards an allowlist of BookHive's public, read-only queries. It sends no cookies or credentials upstream, and Vercel's CDN caches each answer.

### Good to know

- **Records on a PDS are public.** Your shelves, ratings and reviews can be read by anyone, as they can on BookHive.
- **Sign-in lasts up to about two weeks.** Browser-only OAuth sessions are capped by your PDS, after which you sign in again.
- **Feed dates for reviews and ratings are approximate**, because the record stores state rather than history ([#4](https://github.com/renderghost/at-papertrail/issues/4)).

## Development

```sh
npm install
npm run dev        # http://127.0.0.1:5173, with /api/bookhive/* served too (sign-in uses atproto's loopback client)
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
- After each push to `main`, `.github/workflows/verify-deployment.yml` waits for Vercel to serve that commit, then checks the live site can sign people in. Run the same check yourself with `npm run check:deployment -- https://papertrail.renderg.host/`.

## Roadmap

The roadmap lives in GitHub issues: start at [#15](https://github.com/renderghost/at-papertrail/issues/15), which links an epic per theme (pages and lists, personal reading, library, social, discovery, e-reader, integrations, platform).

## Credits

Built on [BookHive](https://github.com/nperez0111/bookhive)'s lexicons (MIT), with book data from BookHive's catalogue, [Open Library](https://openlibrary.org) and Google Books. Typeset in Fraunces and Inter.
