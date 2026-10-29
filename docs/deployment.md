# Deploying Papertrail on Vercel

Papertrail is a static site: Vercel builds it from this repository and serves it at

**https://papertrail.renderg.host/**

alongside the other `renderg.host` apps in the `renderghost` Vercel team. It's a static site plus one stateless Vercel function (the BookHive relay, below). There's no database, and nothing needs configuring at runtime.

## How it fits together

| Piece | What it does |
| --- | --- |
| [`vercel.json`](../vercel.json) | Vite build into `dist/`; routes unknown paths to `index.html` (the app's own router takes over) while missing `/assets/*` files stay real 404s; security headers, including a Content-Security-Policy; caching. |
| [`src/lib/siteUrl.ts`](../src/lib/siteUrl.ts) | Decides which URL each build describes (below). |
| [`api/bookhive/[method].ts`](../api/bookhive/%5Bmethod%5D.ts) | The BookHive relay: a Vercel function at `/api/bookhive/:method` ([below](#the-bookhive-relay-function)). |
| `client-metadata.json` | Generated per build from that URL. A PDS fetches it during sign-in and only proceeds if its `client_id` is exactly the URL it was fetched from. |
| [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) | Typecheck, tests and a production build on every pull request and push to `main`. |
| [`.github/workflows/verify-deployment.yml`](../.github/workflows/verify-deployment.yml) | After every push to `main`, waits for the domain to serve that commit, then runs [`scripts/check-deployment.mjs`](../scripts/check-deployment.mjs) against it ([below](#automatic-checks-after-each-deployment)). |

### Which URL a build describes

| Build | Site URL | So sign-in works on |
| --- | --- | --- |
| Production (`main`) | `https://$VERCEL_PROJECT_PRODUCTION_URL`: the custom domain once added, else `<project>.vercel.app` | `papertrail.renderg.host` |
| Preview (pull requests, branches) | `https://$VERCEL_BRANCH_URL`, the branch URL Vercel's PR comment links (else the deployment's own `$VERCEL_URL`) | the branch URL (see [Previews](#preview-deployments)) |
| `VITE_SITE_URL` set | that value; previews still use their own URL | the URL you set |
| Local `npm run build` | none: no `client-metadata.json`, with a warning | `127.0.0.1` only (atproto's loopback client) |

If a page is opened somewhere its build doesn't describe, such as a production deployment's unique `at-papertrail-<hash>-renderghost.vercel.app` URL, the sign-in screen says where sign-in works and links there. It doesn't start a sign-in that the PDS would reject.

On Vercel, a build with no site URL at all fails rather than shipping a sign-in that can't work.

## First-time setup

About ten minutes, by the owner of the `renderghost` Vercel team and the `renderg.host` Cloudflare zone.

### 1. Create the Vercel project

This needs a person: the Vercel connector Claude uses can read the team but isn't allowed to create projects.

1. Open **https://vercel.com/new** and choose the **renderghost** team.
2. **Import Git Repository** → `renderghost/at-papertrail`.
3. Project name `at-papertrail`. The framework preset (Vite), build and output settings come from `vercel.json`, so leave them alone.
4. **No environment variables are needed.** Leave *Automatically expose System Environment Variables* on (the default), because the build reads `VERCEL_ENV`, `VERCEL_BRANCH_URL`, `VERCEL_URL` and `VERCEL_PROJECT_PRODUCTION_URL`. Node.js 24 comes from `engines` in `package.json`.
5. **Deploy.** The first production build describes `at-papertrail.vercel.app` until the domain is added.

### 2. Add the domain

1. Project → **Settings → Domains** → **Add** → `papertrail.renderg.host` → assign it to **Production**.
2. Vercel shows *Invalid Configuration* and the `CNAME` target it wants. That's expected until step 3.

### 3. Point DNS at Vercel (Cloudflare)

1. Cloudflare → **renderg.host** → **DNS → Records**.
2. Edit the existing `papertrail` record, which currently points to `renderghost.github.io`:
   - **Type** `CNAME`, **Name** `papertrail`, **Target**: the value Vercel shows under Domains, a project-specific host like `db58eeaea4aee7b5.vercel-dns-017.com` (the generic `cname.vercel-dns.com` also works)
   - **Proxy status: DNS only** (grey cloud), like the other `renderg.host` apps. Vercel issues the HTTPS certificate itself.
3. Back in Vercel → **Domains**, wait for *Valid Configuration* and the certificate. Usually a minute or two.

### 4. Redeploy production

`VERCEL_PROJECT_PRODUCTION_URL` is read **at build time**. Production builds made before the domain was added still describe `at-papertrail.vercel.app`.

Vercel → **Deployments** → the latest Production deployment → **⋯ → Redeploy**. Or merge anything to `main`.

### 5. Retire GitHub Pages

GitHub → **https://github.com/renderghost/at-papertrail/settings/pages**:

- remove `papertrail.renderg.host` under **Custom domain**
- set **Source** to **GitHub Actions** with no workflow, or unpublish the site

The old Pages deploy workflow has been removed from this repository.

### 6. Check

```sh
npm run check:deployment -- https://papertrail.renderg.host/ --expect-vercel
```

Every line should be a ✓. The same check runs automatically after each production deployment (next section). Then open https://papertrail.renderg.host/ and sign in with your handle.

## Automatic checks after each deployment

Every build stamps `index.html` with the commit it was built from (`<meta name="papertrail-build" content="<sha>">`, from `VERCEL_GIT_COMMIT_SHA`). After each push to `main`, the **Verify deployment** workflow waits up to ten minutes for `https://papertrail.renderg.host/` to serve that commit, then checks:

- `client-metadata.json` returns 200 **without a redirect**, as `application/json`
- its `client_id` is its own URL, its `redirect_uris` include the site, and it is a public DPoP client with the `atproto` scope
- the site is **served by Vercel** (catches DNS still pointing elsewhere)
- the app loads with its security headers (CSP, HSTS, nosniff, Referrer-Policy)
- deep links serve the app, and missing assets are real 404s
- the BookHive relay function answers

A failure shows on the commit in GitHub (**Actions → Verify deployment**) with the exact check that failed. Run it on demand with **Actions → Verify deployment → Run workflow** (it then checks whatever is live, e.g. after an Instant Rollback), or locally with the command above.

- It is triggered by the push rather than by Vercel's deployment events, so it doesn't depend on which events the Vercel GitHub integration sends.
- A newer push cancels the previous run, because Vercel cancels the older build too.
- It checks the custom domain rather than the deployment's own URL, because Vercel Deployment Protection puts a login in front of deployment URLs. If the domain ever changes, update `PRODUCTION_URL` in the workflow.

## The BookHive relay function

bookhive.buzz's XRPC API sends no CORS headers, so the browser can't call it from another site. `GET /api/bookhive/:method` relays an **allowlist** of BookHive's public, read-only queries: `searchBooks`, `getBook`, `getBookIdentifiers`, `getAuthorBooks`, `getExplore`, `listGenres`, `getLanguages`, `getProfile`, `getReadingStats`, `getUserLists` and `getList`.

- **Anonymous:** no cookies, credentials or visitor headers go upstream. Only the listed parameters pass, and the upstream host is fixed.
- **Cached by Vercel's CDN** per method, from 5 minutes (profiles, lists) to a day (identifiers, genres). Repeat traffic doesn't reach BookHive. Errors: XRPC 4xx answers pass through with a short cache; upstream failures become an uncached `502`.
- **Self-contained:** the file has no local imports, so Vercel compiles it on its own. `npm run dev` and `npm run preview` serve the same handler (`vite.config.ts`), and `src/server/bookhiveProxy.test.ts` tests it.
- `vercel.json`'s app rewrite skips `/api/` so the function isn't shadowed by `index.html`. Vercel routes `/api/bookhive/x` to the file as `/api/bookhive/[method]?method=x`; the handler accepts both forms.
- **Retire it** once BookHive allows CORS (#42) or adds its `#bookhive_appview` service (#43).

The deployment check asks for an unknown method and expects the function's own `404 MethodNotSupported`, so it proves the function is deployed without depending on bookhive.buzz.

## Day to day

- **Pull request:** Vercel builds a preview and comments with its URL; CI runs the tests and a production build.
- **Merge to `main`:** Vercel deploys production.
- **Roll back:** Vercel → **Deployments** → a previous Production deployment → **⋯ → Instant Rollback**. No rebuild needed.

## Preview deployments

New Vercel projects use **Standard Deployment Protection**: previews require a Vercel login. You can browse them, but your PDS fetches `client-metadata.json` from its own servers without that login. It gets a 401, so **sign-in fails on previews** with *"Your PDS couldn't load Papertrail's sign-in details (invalid_client_metadata…)"*. Test sign-in locally or in production; see #11 for the options.

## Environment variables

None are required. Optional, in Vercel → **Settings → Environment Variables**:

| Variable | Scope | Purpose |
| --- | --- | --- |
| `VITE_SITE_URL` | **Production only** | Pins the production URL, e.g. if more custom domains are added and the shortest isn't the canonical one. Previews ignore it. |
| `VITE_GOOGLE_BOOKS_API_KEY` | All | Higher Google Books quota. It's visible in the browser bundle, so restrict it to the site's domains in Google Cloud. |

Locally, put them in `.env.local` (see [`.env.example`](../.env.example)).

## Security headers

Set in `vercel.json` for every response:

- **Content-Security-Policy:**
  - scripts, styles and fonts from the site itself only
  - images and network requests to any `https:` origin (people's PDSes, covers and the directories live anywhere)
  - no plugins, no framing
- **Strict-Transport-Security, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy, Cross-Origin-Opener-Policy**

If a new feature loads something the policy blocks, the browser console shows a `Refused to …` error. Widen only the directive it names.

## Local development

```sh
npm install
npm run dev        # http://127.0.0.1:5173
npm run build      # warns "No site URL" unless VITE_SITE_URL is set; fine locally
npm run preview    # http://127.0.0.1:4173
```

Use `127.0.0.1`, not `localhost`: atproto's loopback OAuth client redirects there, so local sign-in needs no metadata file and no deployment.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Sign-in screen: "Sign-in works at https://… — you're on …" | The page is open on a URL its build doesn't describe, e.g. a deployment's unique URL | Use the linked URL |
| Production still describes `at-papertrail.vercel.app` after adding the domain | The production build predates the domain | Redeploy production (setup step 4) |
| Sign-in on a **preview** fails with `invalid_client_metadata` | Deployment Protection blocks the PDS (401) | Expected; see [Preview deployments](#preview-deployments) |
| Sign-in on **production** fails with `invalid_client_metadata` | The PDS can't fetch the metadata | `npm run check:deployment -- https://papertrail.renderg.host/`; check the domain isn't proxied or protected |
| **Verify deployment** fails: "serves the expected build — still serving …" | The commit's production deployment failed, was cancelled, or took over ten minutes | Vercel → **Deployments**: open that commit's build log; once it's live, re-run the workflow |
| **Verify deployment** fails: "served by Vercel — server is …" | DNS for the domain doesn't point at Vercel yet | Setup step 3 |
| **Verify deployment** fails: "client_id is its own URL" | The production build describes a different URL (built before the domain was added, or a `VITE_SITE_URL` mismatch) | Redeploy production; check `VITE_SITE_URL` (Production) |
| Vercel build fails: "No site URL: client-metadata.json was not generated" | System environment variables aren't exposed to the build | Settings → Environment Variables → enable *Automatically expose System Environment Variables*, then redeploy |
| Domain stuck on *Invalid Configuration* | DNS still points at GitHub, or Cloudflare proxies it | Setup step 3 |
| **Verify deployment** fails: "the BookHive relay function answers — HTTP 200, not the function" | `index.html` answered `/api/…`: the app rewrite in `vercel.json` lost its `api/` exclusion | Restore `"source": "/((?!assets/\|api/).*)"` |
| Book pages show no BookHive reviews; `/api/bookhive/getBook` returns `502` | bookhive.buzz is down or slow | Nothing to fix here; the page falls back to catalogue records |
| Browser console: `Refused to load …` | The Content-Security-Policy blocked something new | Widen the named directive in `vercel.json` |
| A page loads blank after a deploy, with a 404 for `/assets/…` | A tab open from before the deploy requested an old asset | Reload; hashed assets are replaced on every deploy |
