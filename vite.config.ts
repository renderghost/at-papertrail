/// <reference types="vitest/config" />
import type { IncomingMessage, ServerResponse } from 'node:http'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Connect, type Plugin } from 'vite'
import { handle as bookhiveProxy } from './api/bookhive/[method].ts'
import { clientMetadata } from './src/lib/oauthConfig.ts'
import { resolveSiteUrl, type ResolvedSiteUrl } from './src/lib/siteUrl.ts'

/**
 * Serves the Vercel functions in `api/` from the dev and preview servers, so
 * `npm run dev` behaves like a deployment. Each function is a Web handler.
 */
function apiFunctions(): Plugin {
  const routes: [prefix: string, handler: (request: Request) => Promise<Response>][] = [
    ['/api/bookhive/', (request) => bookhiveProxy(request)],
  ]
  const middleware: Connect.NextHandleFunction = (req: IncomingMessage, res: ServerResponse, next) => {
    const url = req.url ?? ''
    const route = routes.find(([prefix]) => url.startsWith(prefix))
    if (!route) return next()
    const request = new Request(new URL(url, 'http://127.0.0.1'), { method: req.method })
    route[1](request).then(
      async (response) => {
        res.statusCode = response.status
        response.headers.forEach((value, key) => res.setHeader(key, value))
        res.end(Buffer.from(await response.arrayBuffer()))
      },
      (err: unknown) => next(err),
    )
  }
  return {
    name: 'papertrail-api-functions',
    configureServer: (server) => void server.middlewares.use(middleware),
    configurePreviewServer: (server) => void server.middlewares.use(middleware),
  }
}

/**
 * Publishes /client-metadata.json for the build's site URL: emitted into the
 * build, and served by the dev server so the document can be inspected locally
 * (local sign-in itself uses atproto's loopback client and never reads it).
 */
function oauthClientMetadata(site: ResolvedSiteUrl | null, strict: boolean): Plugin {
  return {
    name: 'papertrail-oauth-client-metadata',
    configureServer(server) {
      server.middlewares.use((req: { url?: string }, res: ServerResponse, next: () => void) => {
        if ((req.url ?? '').split('?')[0] !== '/client-metadata.json') return next()
        if (!site) {
          res.statusCode = 404
          res.end('No site URL configured; local sign-in uses the loopback OAuth client.')
          return
        }
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(clientMetadata(site.url), null, 2))
      })
    },
    generateBundle() {
      if (!site) {
        const message =
          'No site URL: client-metadata.json was not generated, so this build can only sign in on 127.0.0.1. ' +
          'On Vercel the URL comes from its system environment variables; elsewhere set VITE_SITE_URL ' +
          '(e.g. https://papertrail.renderg.host/). See docs/deployment.md.'
        // A deployed build without metadata would fail every sign-in, so refuse on Vercel and in CI.
        if (strict) this.error(message)
        else this.warn(message)
        return
      }
      this.info?.(`OAuth client_id: ${site.url}client-metadata.json (site URL from ${site.source})`)
      this.emitFile({
        type: 'asset',
        fileName: 'client-metadata.json',
        source: `${JSON.stringify(clientMetadata(site.url), null, 2)}\n`,
      })
    },
  }
}

/**
 * Stamps index.html with the commit it was built from, so a deployment check
 * can tell when the domain serves that commit (see verify-deployment.yml).
 */
function buildStamp(commit: string | undefined): Plugin {
  return {
    name: 'papertrail-build-stamp',
    apply: 'build',
    transformIndexHtml: () =>
      commit && /^[0-9a-f]{7,40}$/i.test(commit)
        ? [{ tag: 'meta', attrs: { name: 'papertrail-build', content: commit }, injectTo: 'head' }]
        : [],
  }
}

export default defineConfig(({ command, mode, isPreview }) => {
  // With an empty prefix, loadEnv returns .env files plus every process variable, VERCEL_* included.
  const env = loadEnv(mode, process.cwd(), '')
  const site = resolveSiteUrl(env)
  const strict = env.VERCEL === '1' || env.CI === 'true'
  const commit = env.VERCEL_GIT_COMMIT_SHA || env.GITHUB_SHA
  return {
    // The built app (and `vite preview` of it) lives under the site URL's path: "/" on Vercel.
    base: (command === 'build' || isPreview) && site ? new URL(site.url).pathname : '/',
    define: {
      // The URL this build's OAuth metadata describes; the app refuses to start sign-in anywhere else.
      __SITE_URL__: JSON.stringify(site?.url ?? ''),
    },
    plugins: [react(), oauthClientMetadata(site, strict), buildStamp(commit), apiFunctions()],
    // Serve dev over the loopback IP, which atproto's loopback OAuth client requires.
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
    preview: { host: '127.0.0.1' },
    test: { environment: 'node' },
  }
})
