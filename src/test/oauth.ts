import type { Session } from '@atcute/oauth-browser-client'
import { generateDpopKey } from '@atcute/oauth-crypto'
import { vi } from 'vitest'

export const TEST_DID = 'did:plc:testuser1234567890abcdef'
export const TEST_PDS = 'https://pds.example.com'

export async function oauthSessionFixture(sub: Session['info']['sub'] = TEST_DID): Promise<Session> {
  return {
    dpopKey: await generateDpopKey(['ES256']),
    info: {
      sub,
      aud: TEST_PDS,
      server: {
        issuer: TEST_PDS,
        authorization_endpoint: `${TEST_PDS}/oauth/authorize`,
        token_endpoint: `${TEST_PDS}/oauth/token`,
        revocation_endpoint: `${TEST_PDS}/oauth/revoke`,
      },
    },
    token: {
      scope: 'atproto repo:buzz.bookhive.book',
      type: 'DPoP',
      access: 'oauth-access',
      refresh: 'oauth-refresh',
      expires_at: Date.now() + 15 * 60_000,
    },
  }
}

/** A loopback origin plus the browser APIs atcute's store expects, minus cross-tab machinery. */
export function stubOAuthRuntime(href = 'http://127.0.0.1:5173/'): void {
  vi.stubGlobal('location', Object.assign(new URL(href), { assign: vi.fn() }))
  vi.stubGlobal(
    'BroadcastChannel',
    class extends EventTarget {
      postMessage() {}
      close() {}
    },
  )
  vi.stubGlobal('navigator', {
    locks: {
      request: (
        name: string,
        options: LockOptions | LockGrantedCallback<unknown>,
        callback?: LockGrantedCallback<unknown>,
      ) =>
        typeof options === 'function'
          ? Promise.resolve(options({ name, mode: 'exclusive' }))
          : Promise.resolve(callback?.(null)),
    },
  })
}
