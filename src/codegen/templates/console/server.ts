import { derive, deriveAll } from '../../derive'
import type { ConsoleSpec } from '../../../context'
import type { TemplateOptions } from '../../options'

/**
 * One console's Worker endpoints.
 *
 * The order of checks is load-bearing and matches the reference exactly: host,
 * then method, then Origin on anything mutating, then **credentials before the
 * session**, then the claim. Checking the session first would tell every caller
 * their access was refused on a deployment that is merely unconfigured.
 */
export const consoleRoutesModule = (spec: ConsoleSpec, options: TemplateOptions): string => {
  const c = derive(spec, options.appSlug)

  return `import { getFirebaseAdminAuth } from '@/lib/firebase-admin/admin'
import { getFirebaseCustomClaimsFromDecodedToken } from '@/lib/firebase-admin/custom-claims'
import { getVerified${c.pascal}Session } from '@/lib/firebase-admin/server-auth'
import {
  ${c.camel}SessionCookieName,
  sessionCookieMaxAgeMs,
  sessionCookieMaxAgeSeconds
} from '@/lib/firebase-admin/session'
import { resolveSessionCookieDomain } from '@/lib/firebase-admin/server-session'
import { getHostnameFromHostHeader } from '@/lib/routing/console-host'
import { is${c.pascal}ConsoleHostname } from '@/lib/routing/${c.label}-console'

const json = (body: unknown, status = 200, headers?: HeadersInit) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } })

/**
 * These endpoints answer on the console's own origin and nowhere else.
 *
 * The session cookie is scoped to that host, so serving the same routes on a
 * host that has its own ${c.label} subdomain would hand out a second, unscoped way
 * to mint it. Where no subdomain is possible, the main origin *is* the console's.
 */
function is${c.pascal}Request(request: Request): boolean {
  const hostname =
    getHostnameFromHostHeader(request.headers.get('x-forwarded-host') ?? request.headers.get('host')) ??
    new URL(request.url).hostname

  return is${c.pascal}ConsoleHostname(hostname)
}

/** A cross-origin POST cannot be the console's own form. */
function hasForeignOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  return origin !== null && origin !== new URL(request.url).origin
}

function serializeSessionCookie(value: string, request: Request, maxAge: number): string {
  const attributes = [
    \`\${${c.camel}SessionCookieName}=\${encodeURIComponent(value)}\`,
    'Path=/',
    \`Max-Age=\${maxAge}\`,
    'HttpOnly',
    'SameSite=Lax'
  ]

  const domain = resolveSessionCookieDomain(request)
  if (domain !== undefined) attributes.push(\`Domain=\${domain}\`)
  if (new URL(request.url).protocol === 'https:') attributes.push('Secure')

  return attributes.join('; ')
}

/**
 * \`GET ${c.apiPrefix}/session\` — who the current session belongs to.
 * \`POST ${c.apiPrefix}/session\` — trades a handoff ID token for the session cookie.
 * \`DELETE ${c.apiPrefix}/session\` — clears it.
 */
export async function handle${c.pascal}Session(request: Request): Promise<Response> {
  if (!is${c.pascal}Request(request)) return json({ error: 'Not found.' }, 404)

  if (request.method === 'GET') {
    if (!getFirebaseAdminAuth()) return json({ error: 'Firebase Admin credentials are not configured.' }, 503)

    const session = await getVerified${c.pascal}Session(request)
    if (!session) return json({ error: '\\u0060${c.claim}\\u0060 access is required.' }, 401)

    return json({
      email: typeof session.decodedToken.email === 'string' ? session.decodedToken.email : null,
      uid: session.decodedToken.uid
    })
  }

  if (request.method === 'DELETE') {
    return json({ ok: true }, 200, { 'set-cookie': serializeSessionCookie('', request, 0) })
  }

  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  if (hasForeignOrigin(request)) return json({ error: 'Invalid request origin.' }, 403)

  let idToken: unknown
  try {
    const body: unknown = await request.json()
    idToken = typeof body === 'object' && body !== null ? (body as { idToken?: unknown }).idToken : undefined
  } catch {
    return json({ error: 'A valid JSON request body is required.' }, 400)
  }

  if (typeof idToken !== 'string' || idToken.trim().length === 0) {
    return json({ error: 'A Firebase ID token is required.' }, 400)
  }

  const auth = getFirebaseAdminAuth()
  if (!auth) return json({ error: 'Firebase Admin credentials are not configured.' }, 503)

  try {
    const decodedToken = await auth.verifyIdToken(idToken, true)

    if (getFirebaseCustomClaimsFromDecodedToken(decodedToken).${c.claim} !== true) {
      return json({ error: '\\u0060${c.claim}\\u0060 access is required.' }, 403)
    }

    const sessionCookie = await auth.createSessionCookie(idToken, { expiresIn: sessionCookieMaxAgeMs })

    return json({ ok: true }, 200, {
      'set-cookie': serializeSessionCookie(sessionCookie, request, sessionCookieMaxAgeSeconds)
    })
  } catch {
    return json({ error: 'Your sign-in session is invalid or expired.' }, 401)
  }
}

/**
 * \`POST ${c.apiPrefix}/session/token\` — the session cookie names the uid, and the
 * custom token re-establishes that person's own client session on this console's
 * origin, which Firebase auth state does not cross.
 */
export async function handle${c.pascal}SessionToken(request: Request): Promise<Response> {
  if (!is${c.pascal}Request(request)) return json({ error: 'Not found.' }, 404)
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  if (hasForeignOrigin(request)) return json({ error: 'Invalid request origin.' }, 403)

  const auth = getFirebaseAdminAuth()
  if (!auth) return json({ error: 'Firebase Admin credentials are not configured.' }, 503)

  const session = await getVerified${c.pascal}Session(request)
  if (!session) return json({ error: '\\u0060${c.claim}\\u0060 access is required.' }, 401)

  try {
    return json({ customToken: await auth.createCustomToken(session.decodedToken.uid) })
  } catch {
    return json({ error: 'Could not issue a sign-in token.' }, 500)
  }
}
`
}

/**
 * The whole console dispatch table, in a generated file.
 *
 * This exists so the edit to the app's own `worker.ts` is one import and two
 * lines instead of a growing list of paths — and so the routing can be tested
 * on its own.
 */
export const consoleDispatchModule = (options: TemplateOptions): string => {
  const consoles = deriveAll(options.consoles, options.appSlug)

  return `${consoles
    .map(
      (c) =>
        `import { handle${c.pascal}Session, handle${c.pascal}SessionToken } from './${c.label}-auth-routes'`
    )
    .join('\n')}

/** What the Worker's env must carry for the consoles to work. */
export type ConsoleWorkerEnv = {
  FIREBASE_PROJECT_ID?: string
  FIREBASE_CLIENT_EMAIL?: string
  FIREBASE_PRIVATE_KEY?: string
  FIREBASE_PRIVATE_KEY_ID?: string
  FIREBASE_SERVICE_ACCOUNT_KEY?: string
  PUBLIC_FIREBASE_API_KEY?: string
}

const routes: Readonly<Record<string, (request: Request) => Promise<Response>>> = {
${consoles
  .map(
    (c) =>
      `  '${c.apiPrefix}/session': handle${c.pascal}Session,\n  '${c.apiPrefix}/session/token': handle${c.pascal}SessionToken`
  )
  .join(',\n')}
}

/**
 * Answers a console API request, or \`null\` when the path is not one.
 *
 * It must be consulted **before** the static asset fallback: an asset handler
 * that answers first turns every one of these endpoints into the SPA shell, and
 * a console that receives a page where it expects a session fails in a way that
 * looks nothing like its cause.
 */
export async function dispatchConsoleRequest(request: Request): Promise<Response | null> {
  const handler = routes[new URL(request.url).pathname]

  return handler === undefined ? null : await handler(request)
}

/** Every console API path, for a test or a proxy configuration. */
export const consoleApiPaths = Object.keys(routes)
`
}
