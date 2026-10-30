#!/usr/bin/env node
/**
 * Checks a deployed Papertrail can actually sign people in, the way a PDS and a
 * browser see it. Used by .github/workflows/verify-deployment.yml after each
 * push to main; run it yourself with:
 *
 *   npm run check:deployment -- https://papertrail.renderg.host/
 *
 * Options:
 *   --retries <n>   attempts for the first request, 20 s apart (default 1),
 *                   for builds, CDNs and domain aliases that take a moment
 *   --expect-build <sha>  first wait (within --retries) until the site serves
 *                   the build of this commit, read from its papertrail-build meta tag
 *   --expect-vercel fail unless the site is served by Vercel
 *   --fetch-from <origin>  request this origin instead of the site's own (for
 *                   testing a build locally; the checks still expect the site URL)
 */

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const option = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : fallback
}
const valued = ['--retries', '--expect-build', '--fetch-from']
const positional = args.filter((a, i) => !a.startsWith('--') && !valued.includes(args[i - 1]))
const site = positional[0] && new URL(positional[0].endsWith('/') ? positional[0] : `${positional[0]}/`)
const expectBuild = option('--expect-build', '')
if (!site || (expectBuild && !/^[0-9a-f]{7,40}$/i.test(expectBuild))) {
  console.error(
    'Usage: check-deployment.mjs <site-url> [--retries n] [--expect-build sha] [--expect-vercel] [--fetch-from origin]',
  )
  process.exit(2)
}
const retries = Number(option('--retries', '1'))
const fetchFrom = option('--fetch-from', site.origin)
const at = (path) => new URL(`${site.pathname.replace(/\/$/, '')}${path}`, fetchFrom).href

const results = []
const pass = (name, detail = '') => results.push({ ok: true, name, detail })
const fail = (name, detail) => results.push({ ok: false, name, detail })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** No redirects: a PDS fetching client metadata must not be redirected. */
async function get(path, userAgent = 'papertrail-deployment-check') {
  const res = await fetch(at(path), { redirect: 'manual', headers: { 'user-agent': userAgent } })
  return { res, body: await res.text() }
}

const clientId = `${site.href}client-metadata.json`

// 0. Wait for the commit's build: Vercel deploys main on its own schedule.
if (expectBuild) {
  let served
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const { res, body } = await get('/')
      served = body.match(/<meta name="papertrail-build" content="([0-9a-f]+)"/i)?.[1]?.toLowerCase() ?? `no build stamp (HTTP ${res.status})`
    } catch (err) {
      served = err.message
    }
    if (served.startsWith(expectBuild.toLowerCase())) break
    if (attempt < retries) {
      console.log(`Attempt ${attempt}: serving ${served}, waiting for ${expectBuild}; retrying in 20 s…`)
      await sleep(20_000)
    }
  }
  if (served.startsWith(expectBuild.toLowerCase())) pass('serves the expected build', served)
  else fail('serves the expected build', `still serving ${served}, not ${expectBuild}: check its deployment in Vercel → Deployments`)
}

// 1. Client metadata: what every PDS fetches during sign-in.
let meta
const metaAttempts = expectBuild ? 1 : retries
for (let attempt = 1; attempt <= metaAttempts; attempt++) {
  try {
    meta = await get('/client-metadata.json')
    if (meta.res.status === 200) break
  } catch (err) {
    meta = { error: err }
  }
  if (attempt < metaAttempts) {
    console.log(`Attempt ${attempt}: ${meta.error ? meta.error.message : `HTTP ${meta.res.status}`}; retrying in 20 s…`)
    await sleep(20_000)
  }
}

if (meta.error) {
  fail('client-metadata.json is reachable', meta.error.message)
} else {
  const { res, body } = meta
  const server = res.headers.get('server') ?? '(none)'
  if (res.status === 200) pass('client-metadata.json returns 200 without a redirect')
  else if (res.status >= 300 && res.status < 400) fail('client-metadata.json returns 200 without a redirect', `HTTP ${res.status} → ${res.headers.get('location')} (PDSes don't follow redirects for client metadata)`)
  else fail('client-metadata.json returns 200 without a redirect', `HTTP ${res.status} from server "${server}"${res.status === 401 ? ' (Deployment Protection?)' : ''}`)

  if (flag('--expect-vercel')) {
    if (/vercel/i.test(server)) pass('served by Vercel')
    else fail('served by Vercel', `server is "${server}": DNS for ${site.host} doesn't point at Vercel yet (CNAME to the target shown in Vercel → Domains, DNS only)`)
  }

  if (res.status === 200) {
    if (/application\/json/.test(res.headers.get('content-type') ?? '')) pass('client-metadata.json is application/json')
    else fail('client-metadata.json is application/json', res.headers.get('content-type'))
    let doc
    try {
      doc = JSON.parse(body)
    } catch {
      fail('client-metadata.json parses', body.slice(0, 120))
    }
    if (doc) {
      if (doc.client_id === clientId) pass('client_id is its own URL', clientId)
      else fail('client_id is its own URL', `expected ${clientId}, got ${doc.client_id}`)
      if (Array.isArray(doc.redirect_uris) && doc.redirect_uris.includes(site.href)) pass('redirect_uris include the site')
      else fail('redirect_uris include the site', JSON.stringify(doc.redirect_uris))
      if (typeof doc.scope === 'string' && doc.scope.split(' ').includes('atproto')) pass('scope includes atproto', doc.scope)
      else fail('scope includes atproto', doc.scope)
      if (doc.dpop_bound_access_tokens === true && doc.token_endpoint_auth_method === 'none') pass('public DPoP client')
      else fail('public DPoP client', JSON.stringify({ dpop: doc.dpop_bound_access_tokens, auth: doc.token_endpoint_auth_method }))
    }
  }
}

// 2. The app itself, with its security headers.
try {
  const { res, body } = await get('/')
  if (res.status === 200 && body.includes('<div id="root">')) pass('the site serves the app')
  else fail('the site serves the app', `HTTP ${res.status}`)
  for (const header of ['content-security-policy', 'strict-transport-security', 'x-content-type-options', 'referrer-policy']) {
    if (res.headers.get(header)) pass(`${header} header`)
    else fail(`${header} header`, 'missing (is vercel.json deployed?)')
  }
  // The barcode scanner needs the camera, and WebAssembly where the browser has no reader of its own (iPhones).
  if (/camera=\(self\)/.test(res.headers.get('permissions-policy') ?? '')) pass('the scanner may use the camera')
  else fail('the scanner may use the camera', `Permissions-Policy is "${res.headers.get('permissions-policy')}", without camera=(self)`)
  if (/script-src[^;]*'wasm-unsafe-eval'/.test(res.headers.get('content-security-policy') ?? '')) pass("the scanner's WebAssembly decoder may run")
  else fail("the scanner's WebAssembly decoder may run", "script-src lacks 'wasm-unsafe-eval', so iPhones can't read barcodes")
} catch (err) {
  fail('the site serves the app', err.message)
}

// 3. Routing: deep links serve the app; missing assets are real 404s.
try {
  const { res, body } = await get('/feed')
  if (res.status === 200 && body.includes('<div id="root">')) pass('deep links serve the app')
  else fail('deep links serve the app', `HTTP ${res.status}`)
  const missing = await get('/assets/deployment-check-missing.js')
  if (missing.res.status === 404) pass('missing assets return 404')
  else fail('missing assets return 404', `HTTP ${missing.res.status}`)
} catch (err) {
  fail('routing', err.message)
}

// 4. The BookHive relay function is deployed. An unknown method is refused by the
// function itself, so this never depends on bookhive.buzz being up.
try {
  const { res, body } = await get('/api/bookhive/deploymentCheck')
  let error
  try {
    error = JSON.parse(body).error
  } catch {
    // Not JSON: the SPA or a platform error page answered instead of the function.
  }
  if (res.status === 404 && error === 'MethodNotSupported') pass('the BookHive relay function answers')
  else fail('the BookHive relay function answers', `HTTP ${res.status}${error ? ` (${error})` : ', not the function'}`)
} catch (err) {
  fail('the BookHive relay function answers', err.message)
}

// 5. Link previews: crawlers get a share card, people get the app, on the same URL.
try {
  const path = '/books/bk_deploymentCheck'
  const crawler = await get(path, 'Mozilla/5.0 (compatible; Bluesky Cardyb/1.1; +mailto:support@bsky.app)')
  if (crawler.res.status === 200 && crawler.body.includes('property="og:title"')) pass('link-preview crawlers get a share card')
  else fail('link-preview crawlers get a share card', `HTTP ${crawler.res.status}${crawler.body.includes('<div id="root">') ? ', the app instead' : ''}`)
  const person = await get(path, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15')
  if (person.res.status === 200 && person.body.includes('<div id="root">')) pass('people get the app on the same URL')
  else fail('people get the app on the same URL', `HTTP ${person.res.status}`)
} catch (err) {
  fail('link previews', err.message)
}

console.log(`\nDeployment check for ${site.href}${fetchFrom !== site.origin ? ` (fetched from ${fetchFrom})` : ''}`)
for (const r of results) console.log(`${r.ok ? '  ✓' : '  ✗'} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`)
const failed = results.filter((r) => !r.ok)
if (failed.length) {
  console.log(`\n${failed.length} check(s) failed. See docs/deployment.md → Troubleshooting.`)
  process.exit(1)
}
console.log('\nAll checks passed: a PDS can load the client metadata and sign-in can work.')
