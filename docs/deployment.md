# Deploying Papertrail to GitHub Pages

Papertrail is a static site. GitHub Actions builds it and publishes it to GitHub Pages at:

**https://renderghost.github.io/at-papertrail/**

There is no server and nothing to configure at runtime. One value matters: `VITE_SITE_URL` in the committed [`.env`](../.env). The build generates the OAuth client document (`client-metadata.json`) and the site's base path from it. A PDS only lets you sign in if it can fetch that document at exactly the URL the document names as its `client_id`.

## How the pipeline works

[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) has three jobs:

| Job | Runs on | Does |
| --- | --- | --- |
| `build` | every pull request, every push to `main`, manual runs | `npm ci`, `npm test`, `npm run build`. On `main` only, uploads `dist/` as the Pages artifact. |
| `deploy` | pushes to `main` and manual runs on `main` | Publishes the artifact to the `github-pages` environment. |
| `verify` | after every deploy | Checks the live site: `client-metadata.json` returns 200 with no redirect and names its own URL as `client_id`, and a deep link serves the app. |

Pull requests never deploy. Deploys queue one at a time and are never cancelled half-way. A superseded pull-request build is cancelled.

## First deployment (one time)

These steps are done in the GitHub web UI by someone with admin access to the repository.

1. **Check the repository is public.** GitHub Pages on a free plan needs a public repository; `renderghost/at-papertrail` already is.
2. **Turn on Pages with Actions as the source.**
   - Open **https://github.com/renderghost/at-papertrail/settings/pages**.
   - Under **Build and deployment** → **Source**, choose **GitHub Actions**. Not "Deploy from a branch", which would publish the raw repository instead of the build.
   - Leave **Custom domain** empty (see [Using a custom domain](#using-a-custom-domain) if you want one).
3. **Merge the pull request into `main`.** Open https://github.com/renderghost/at-papertrail/pull/6 and click **Merge pull request**. The push to `main` starts the workflow.
4. **Watch the run.** Open **https://github.com/renderghost/at-papertrail/actions/workflows/deploy.yml** and click the newest run. `build`, `deploy` and `verify` should all go green, in about two minutes. The `deploy` job shows the live URL.
5. **Restrict the environment to `main`** (recommended, once it exists after the first deploy). Open **https://github.com/renderghost/at-papertrail/settings/environments**, then **github-pages** → **Deployment branches and tags**. Check it lists only `main`. GitHub normally sets this when you choose Actions as the source.
6. **Sign in.** Open https://renderghost.github.io/at-papertrail/, enter your handle, approve access on your PDS, and check your BookHive books appear in the Library.

### Checking it by hand

The `verify` job runs these checks for you; to repeat them from a terminal:

```sh
# Must be HTTP 200 (not 301/302) with application/json …
curl -sI https://renderghost.github.io/at-papertrail/client-metadata.json | head -n 5

# … and client_id must be exactly this URL.
curl -s https://renderghost.github.io/at-papertrail/client-metadata.json | jq -r .client_id

# Deep links: GitHub Pages answers 404 but serves the app (404.html), which then routes.
curl -s https://renderghost.github.io/at-papertrail/feed | grep -c '<div id="root">'
```

## Deploying changes

- **Normally:** merge a pull request into `main`. Every push to `main` deploys.
- **Re-deploy without a code change:** go to **Actions** → **Build and deploy** → **Run workflow**, choose branch **`main`**, and click **Run workflow**. Runs started from another branch only build: the `github-pages` environment accepts `main` alone.
- **Before merging:** each pull request runs the same tests and build, so a red check means the deploy would fail too.

## Rolling back

Revert the change on `main` (`git revert <commit>` and push, or **Revert** on the merged pull request in GitHub). The push deploys the previous state.

Re-running an old workflow run isn't a reliable rollback: the Pages artifact it uploaded expires after a day.

## Previewing the production build locally

```sh
npm run build
npm run preview    # http://127.0.0.1:4173/at-papertrail/
```

This serves `dist/` under the same `/at-papertrail/` path as GitHub Pages. Sign-in works here too: on `127.0.0.1` the app uses atproto's loopback OAuth client instead of `client-metadata.json`. Use `127.0.0.1`, not `localhost`.

## Using a custom domain

The OAuth client id is derived from the site URL, so moving domains changes the client. Do all of this in one go:

1. **DNS:** at your DNS provider, add a `CNAME` record from the subdomain (e.g. `papertrail.example.com`) to `renderghost.github.io`.
2. **Pages:** at https://github.com/renderghost/at-papertrail/settings/pages, enter the domain under **Custom domain**, click **Save**, wait for the DNS check to pass, then tick **Enforce HTTPS**.
3. **`.env`:** set `VITE_SITE_URL=https://papertrail.example.com/` (a custom domain serves from the root, so the base path becomes `/`), commit and push to `main`.
4. **Check:** the `verify` job, or the curl commands above with the new URL, must pass.

Once a custom domain is set, GitHub redirects the old `renderghost.github.io/at-papertrail/` address, so the old client metadata URL stops working. People who were signed in will have to sign in again; their books on their PDS are unaffected.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `deploy` fails with "Ensure GitHub Pages has been enabled" or a 404 from the Pages API | Pages isn't on, or its source is "Deploy from a branch" | Step 2 of [First deployment](#first-deployment-one-time) |
| `deploy` fails with "Branch … is not allowed to deploy to github-pages" | The run wasn't on `main` | Merge to `main`, or run the workflow with branch `main` |
| `build` fails with "No public site URL is configured" | `VITE_SITE_URL` is missing or empty in `.env` | Restore it in `.env` |
| `verify` fails on client metadata with HTTP 301/302 | The site is being redirected, usually by a custom domain on the repo or on a `renderghost.github.io` user site | Set `VITE_SITE_URL` to the final URL ([Using a custom domain](#using-a-custom-domain)) |
| The site shows the README, or a 404 at the root | Pages source is "Deploy from a branch" | Switch the source to **GitHub Actions** and re-run the workflow |
| Sign-in fails with "Papertrail's sign-in is misconfigured" | The PDS rejected the client metadata, e.g. the `client_id` doesn't match the URL it was fetched from | Run the curl checks; `client_id` must equal the URL you fetched |
| Sign-in on your machine says to use 127.0.0.1 | You opened `localhost` | Open `http://127.0.0.1:5173/` (dev) or `http://127.0.0.1:4173/at-papertrail/` (preview) |
| A page link opens a blank page | `404.html` wasn't published | Check `dist/404.html` exists after `npm run build`; the build makes it |
| `verify` fails right after the first deploy | The Pages CDN was still warming up (the job retries for about two minutes) | Re-run the `verify` job |
