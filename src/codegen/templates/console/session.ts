import { deriveAll } from '../../derive'
import type { TemplateOptions } from '../../options'

/** Cookie names and lifetimes — one cookie per console, named after the app. */
export const sessionModule = (options: TemplateOptions): string => {
  const consoles = deriveAll(options.consoles, options.appSlug)

  return `import { getSharedCookieDomain } from '@/lib/routing/console-host'

/**
 * One session cookie per console.
 *
 * They are separate on purpose: a session minted for one console must not admit
 * the holder to another, even when the same person could sign in to both.
 */
${consoles.map((c) => `export const ${c.camel}SessionCookieName = '${c.cookieName}'`).join('\n')}

export const consoleSessionCookieNames = {
${consoles.map((c) => `  ${c.camel}: ${c.camel}SessionCookieName`).join(',\n')}
} as const

export type ConsoleScope = keyof typeof consoleSessionCookieNames

/** Five days, matching the longest session cookie Firebase will mint. */
export const sessionCookieMaxAgeMs = 5 * 24 * 60 * 60 * 1000
export const sessionCookieMaxAgeSeconds = sessionCookieMaxAgeMs / 1000

/**
 * The \`Domain\` a session cookie carries, so one minted on a console's subdomain
 * is readable on the app. Unset where there is only one host.
 */
export function getSessionCookieDomain(hostname: string): string | undefined {
  return getSharedCookieDomain(hostname)
}
`
}

/** Cookie reading and per-console session verification, for the Worker. */
export const serverAuthModule = (options: TemplateOptions): string => {
  const consoles = deriveAll(options.consoles, options.appSlug)

  return `import type { DecodedIdToken } from 'firebase-admin/auth'
import { getFirebaseAdminAuth } from './admin'
import { getFirebaseCustomClaimsFromDecodedToken } from './custom-claims'
import { consoleSessionCookieNames, type ConsoleScope } from './session'
import { getAppRootHostname } from '@/lib/routing/console-host'

export type VerifiedSession = {
  customClaims: ReturnType<typeof getFirebaseCustomClaimsFromDecodedToken>
  decodedToken: DecodedIdToken
}

/** Reads one cookie out of a Cookie header, tolerating an unencoded value. */
function getCookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null

  for (const cookie of cookieHeader.split(';')) {
    const separatorIndex = cookie.indexOf('=')
    if (separatorIndex === -1) continue
    if (cookie.slice(0, separatorIndex).trim() !== name) continue

    const value = cookie.slice(separatorIndex + 1).trim()

    try {
      return decodeURIComponent(value)
    } catch {
      return value
    }
  }

  return null
}

/** Where to send someone whose session will not do: the app, not a dead end. */
function buildAppHomeUrl(request: Request): URL {
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')

  if (!host) return new URL('/', request.url)

  const protocol = request.headers.get('x-forwarded-proto') ?? new URL(request.url).protocol.slice(0, -1)
  const appUrl = new URL(\`\${protocol}://\${host}\`)

  appUrl.hostname = getAppRootHostname(appUrl.hostname)
  appUrl.pathname = '/'
  appUrl.search = ''
  appUrl.hash = ''

  return appUrl
}

/**
 * Verifies a console's session cookie.
 *
 * \`checkRevoked\` is on: a session cookie outlives a revoked account otherwise,
 * and revoking access is the whole point of being able to revoke it.
 */
export async function getVerifiedSession(request: Request, scope: ConsoleScope): Promise<VerifiedSession | null> {
  const auth = getFirebaseAdminAuth()
  if (!auth) return null

  const sessionCookie = getCookieValue(request.headers.get('cookie'), consoleSessionCookieNames[scope])
  if (!sessionCookie) return null

  try {
    const decodedToken = await auth.verifySessionCookie(sessionCookie, true)

    return { customClaims: getFirebaseCustomClaimsFromDecodedToken(decodedToken), decodedToken }
  } catch {
    return null
  }
}

${consoles
  .map(
    (c) => `/** A ${c.label} session, and only if it carries the \`${c.claim}\` claim. */
export async function getVerified${c.pascal}Session(request: Request): Promise<VerifiedSession | null> {
  const session = await getVerifiedSession(request, '${c.camel}')

  return session?.customClaims.${c.claim} === true ? session : null
}

/** The same, but answering a page request with a redirect to the app. */
export async function require${c.pascal}Session(request: Request): Promise<VerifiedSession | Response> {
  return (await getVerified${c.pascal}Session(request)) ?? Response.redirect(buildAppHomeUrl(request), 302)
}`
  )
  .join('\n\n')}
`
}

/** Resolves the cookie domain from the request's own Host header. */
export const serverSessionModule = (): string => `import { getHostnameFromHostHeader } from '@/lib/routing/console-host'
import { getSessionCookieDomain } from './session'

/**
 * The \`Domain\` to set on a session cookie for this request.
 *
 * Read from the Host header rather than the URL, because behind a proxy the URL
 * is the internal one and the cookie has to match the host the browser used.
 */
export function resolveSessionCookieDomain(request: Request): string | undefined {
  const requestHostname =
    getHostnameFromHostHeader(request.headers.get('x-forwarded-host') ?? request.headers.get('host')) ??
    new URL(request.url).hostname

  return getSessionCookieDomain(requestHostname)
}
`
