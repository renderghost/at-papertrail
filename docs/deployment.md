# Deploying Papertrail to GitHub Pages

Papertrail is a static site. GitHub Actions builds it and publishes it to GitHub Pages on the custom domain:

**https://papertrail.renderg.host/**

There is no server and nothing to configure at runtime. Two settings must agree:

| Where | Value |
| --- | --- |
| `VITE_SITE_URL` in the committed [`.env`](../.env) | `https://papertrail.renderg.host/` |
| **Settings → Pages → Custom domain** (also recorded in [`CNAME`](../CNAME)) | `papertrail.renderg.host` |

The build generates the OAuth client document (`client-metadata.json`) and the site's base path from `VITE_SITE_URL`. A PDS only lets you sign in if it can fetch that document at exactly the URL it names as its `client_id`, with no redirect. If the two settings disagree, the site may load but nobody can sign in.

## How the pipeline works

[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) has three jobs:

| Job | Runs on | Does |
| --- | --- | --- |
| `build` | every pull request, every push to `main`, manual runs | `npm ci`, `npm test`, `npm run build`. On `main` only, uploads `dist/` as the Pages artifact. |
| `deploy` | pushes to `main` and manual runs on `main` | Publishes the artifact to the `github-pages` environment. |
| `verify` | after every deploy | Checks the live site: `client-metadata.json` returns 200 with no redirect and names its own URL as `client_id`, and a deep link serves the app. |

Pull requests never deploy. Deploys queue one at a time and are never cancelled half-way. A superseded pull-request build is cancelled.

## First deployment (one time)

Do these in the GitHub web UI with admin access to `renderghost/at-papertrail`.

1. **Switch Pages to GitHub Actions.** This is the step that matters most.
   - Open **https://github.com/renderghost/at-papertrail/settings/pages**.
   - Under **Build and deployment** → **Source**, choose **GitHub Actions**.
   - While it says **Deploy from a branch**, GitHub runs its own "pages build and deployment" job on every push. That job publishes the raw repository (the README) and overwrites the app.
2. **Check the custom domain**, on the same page.
   - **Custom domain** must read `papertrail.renderg.host` with a green "DNS check successful".
   - Tick **Enforce HTTPS**. If the box is greyed out, the certificate is still being issued; wait and come back.
   - DNS needs a `CNAME` record for `papertrail` in the `renderg.host` zone pointing to `renderghost.github.io`. It's already working if the DNS check is green.
3. **Merge the pull request into `main`.** The push to `main` starts the workflow.
4. **Watch the run.** Open **https://github.com/renderghost/at-papertrail/actions/workflows/deploy.yml** and click the newest run. `build`, `deploy` and `verify` should all go green within a few minutes. There should be **no** new "pages build and deployment" run; if there is, go back to step 1.
5. **Check the environment is limited to `main`.** Open **https://github.com/renderghost/at-papertrail/settings/environments** → **github-pages** → **Deployment branches and tags**. It should list only `main`; GitHub normally sets this up on the first Actions deploy.
6. **Sign in.** Open https://papertrail.renderg.host/, enter your handle, approve access on your PDS, and check your BookHive books appear in the Library.

### Checking it by hand

The `verify` job runs these checks for you. To repeat them from a terminal:

```sh
# Must be HTTP 200 (not 301/302) with application/json …
curl -sI https://papertrail.renderg.host/client-metadata.json | head -n 5

# … and client_id must be exactly this URL.
curl -s https://papertrail.renderg.host/client-metadata.json | jq -r .client_id

# The app, not the README: should print the app's root element.
curl -s https://papertrail.renderg.host/ | grep -o '<div id="root">'

# Deep links: GitHub Pages answers 404 but serves the app (404.html), which then routes.
curl -s https://papertrail.renderg.host/feed | grep -o '<div id="root">'
```

## Deploying changes

- **Normally:** merge a pull request into `main`. Every push to `main` deploys.
- **Re-deploy without a code change:** **Actions** → **Build and deploy** → **Run workflow**, choose branch **`main`**, then **Run workflow**. Runs started from another branch only build, because the `github-pages` environment accepts `main` alone.
- **Before merging:** each pull request runs the same tests and build, so a red check means the deploy would fail too.

## Rolling back

Revert the change on `main` (`git revert <commit>` and push, or **Revert** on the merged pull request in GitHub). The push deploys the previous state.

Re-running an old workflow run isn't a reliable rollback: the Pages artifact it uploaded expires after a day.

## Previewing the production build locally

```sh
npm run build
npm run preview    # http://127.0.0.1:4173/
```

This serves `dist/` exactly as GitHub Pages will. Sign-in works here too: on `127.0.0.1` the app uses atproto's loopback OAuth client instead of `client-metadata.json`. Use `127.0.0.1`, not `localhost`.

## Changing the domain

The OAuth client id is derived from the site URL, so changing domain changes the client. Do all of this in one go:

1. **DNS:** add a `CNAME` record for the new host pointing to `renderghost.github.io`.
2. **Pages:** at https://github.com/renderghost/at-papertrail/settings/pages, enter the new domain under **Custom domain**, click **Save**, wait for the DNS check, then tick **Enforce HTTPS**.
3. **`.env`:** set `VITE_SITE_URL` to the new URL with a trailing slash (e.g. `https://reading.example.com/`), then commit and push to `main`.
   - To drop the custom domain, clear it in Settings, delete `CNAME`, and set `VITE_SITE_URL=https://renderghost.github.io/at-papertrail/`. The build then serves under `/at-papertrail/` automatically.
4. **Check:** the `verify` job, or the curl commands above with the new URL, must pass.

After a domain change, people who were signed in must sign in again. Their books on their PDS are unaffected.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| The site shows the README, or the app flickers back to the README after a deploy | Pages source is still "Deploy from a branch", so GitHub's branch build overwrites the Actions deploy | Step 1 of [First deployment](#first-deployment-one-time), then re-run the workflow |
| The page loads blank, and the browser console shows 404s for `/assets/…` | `VITE_SITE_URL` doesn't match the domain being served, so the asset paths are wrong | Make `.env` match **Settings → Pages → Custom domain** |
| `deploy` fails with "Ensure GitHub Pages has been enabled" or a 404 from the Pages API | Pages is off | Step 1 |
| `deploy` fails with "Branch … is not allowed to deploy to github-pages" | The run wasn't on `main` | Merge to `main`, or run the workflow with branch `main` |
| `build` fails with "No public site URL is configured" | `VITE_SITE_URL` is missing or empty in `.env` | Restore it |
| `verify` fails on client metadata with HTTP 301/302 | The site is being redirected, e.g. the custom domain changed or HTTPS isn't enforced yet | Set `VITE_SITE_URL` to the final URL ([Changing the domain](#changing-the-domain)) |
| `verify` fails with a TLS or connection error | The custom domain's certificate isn't issued yet, or DNS is wrong | Wait for **Enforce HTTPS** to become available, check the DNS record, re-run `verify` |
| Sign-in fails with "Papertrail's sign-in is misconfigured" | The PDS rejected the client metadata, e.g. its `client_id` doesn't match the URL it was fetched from | Run the curl checks |
| Sign-in on your machine says to use 127.0.0.1 | You opened `localhost` | Open `http://127.0.0.1:5173/` (dev) or `http://127.0.0.1:4173/` (preview) |
| A link to a page opens blank | `404.html` wasn't published | Check `dist/404.html` exists after `npm run build`; the build creates it |
| `verify` fails straight after the first deploy | The Pages CDN was still warming up; the job retries for about two minutes | Re-run the `verify` job |
