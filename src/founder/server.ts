import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { FirebaseWebConfig } from '../context'
import { renderSignInPage } from './page'

export type FounderSignIn = {
  /** The URL to open. `localhost`, not `127.0.0.1` — see below. */
  readonly url: string
  /** Resolves with the ID token, or rejects on timeout. */
  readonly idToken: Promise<string>
  readonly close: () => void
}

const TIMEOUT_MS = 5 * 60 * 1000

/**
 * Serves one sign-in page and waits for one ID token.
 *
 * The sign-in happens in the person's own browser; the CLI only ever receives
 * the resulting token. Nothing is stored and the server closes the moment it has
 * what it came for.
 *
 * Bound to `127.0.0.1` so nothing off this machine can reach it, but the browser
 * is sent to `localhost`: `localhost` is in Firebase's default authorized-domain
 * list and `127.0.0.1` historically was not, and authorization is per-host, not
 * per-port — which is what lets an ephemeral port work with no configuration.
 */
export function startFounderSignIn(input: {
  readonly config: FirebaseWebConfig
  readonly projectId: string
  readonly appSlug: string
}): Promise<FounderSignIn> {
  const nonce = randomBytes(32).toString('base64url')
  let consumed = false

  return new Promise((ready, failed) => {
    let settle: (token: string) => void = () => {}
    let reject: (error: Error) => void = () => {}

    const idToken = new Promise<string>((resolve, rejectToken) => {
      settle = resolve
      reject = rejectToken
    })

    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', `http://localhost`)
      const origin = `http://localhost:${(server.address() as { port: number }).port}`

      const send = (status: number, body: string, type = 'text/plain; charset=utf-8') => {
        // No CORS headers, ever: another origin must not be able to read a reply.
        response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
        response.end(body)
      }

      if (request.method === 'GET' && url.pathname === '/favicon.ico') {
        send(204, '')
        return
      }

      if (request.method === 'GET' && url.pathname === '/') {
        // The nonce gates the page too, so a stray local process cannot even
        // read the config it embeds.
        if (url.searchParams.get('s') !== nonce) {
          send(404, 'Not found.')
          return
        }

        send(200, renderSignInPage({ ...input, nonce }), 'text/html; charset=utf-8')
        return
      }

      if (request.method !== 'POST' || url.pathname !== '/callback') {
        send(404, 'Not found.')
        return
      }

      if (request.headers.origin !== origin) {
        send(403, 'Wrong origin.')
        return
      }

      const sameSite = request.headers['sec-fetch-site']
      if (typeof sameSite === 'string' && sameSite !== 'same-origin') {
        send(403, 'Wrong site.')
        return
      }

      let body = ''
      request.on('data', (chunk: Buffer) => {
        body += chunk.toString()
        // A token is a few kilobytes; anything larger is not one.
        if (body.length > 64_000) request.destroy()
      })

      request.on('end', () => {
        let payload: { idToken?: unknown; nonce?: unknown }

        try {
          payload = JSON.parse(body) as { idToken?: unknown; nonce?: unknown }
        } catch {
          send(400, 'Expected JSON.')
          return
        }

        if (payload.nonce !== nonce) {
          send(403, 'Wrong nonce.')
          return
        }

        if (consumed) {
          send(409, 'That sign-in was already used.')
          return
        }

        if (typeof payload.idToken !== 'string' || payload.idToken.length === 0) {
          send(400, 'No ID token.')
          return
        }

        consumed = true
        send(200, 'ok')
        settle(payload.idToken)
      })
    })

    const timer = setTimeout(() => {
      reject(new Error('No sign-in arrived within five minutes.'))
      server.close()
    }, TIMEOUT_MS)

    timer.unref?.()

    server.on('error', failed)

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number }

      const close = () => {
        clearTimeout(timer)
        server.close()
      }

      void idToken.then(close, () => {})

      ready({ url: `http://localhost:${port}/?s=${nonce}`, idToken, close })
    })
  })
}
