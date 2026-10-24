/// <reference types="vitest/config" />
import { copyFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { clientMetadata, DEFAULT_SITE_URL, normaliseSiteUrl } from './src/lib/oauthConfig.ts'

const siteUrl = normaliseSiteUrl(process.env.SITE_URL || DEFAULT_SITE_URL)

/**
 * Emits the OAuth client metadata document for the deployed URL, and a
 * `404.html` copy of the app so GitHub Pages serves deep links.
 */
function staticHosting(): Plugin {
  let outDir = 'dist'
  return {
    name: 'papertrail-static-hosting',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'client-metadata.json',
        source: `${JSON.stringify(clientMetadata(siteUrl), null, 2)}\n`,
      })
    },
    async closeBundle() {
      await copyFile(resolve(outDir, 'index.html'), resolve(outDir, '404.html'))
    },
  }
}

export default defineConfig(({ command }) => ({
  base: command === 'build' ? new URL(siteUrl).pathname : '/',
  define: {
    __SITE_URL__: JSON.stringify(siteUrl),
  },
  plugins: [react(), staticHosting()],
  server: { port: 5173, strictPort: true },
  test: { environment: 'node' },
}))
