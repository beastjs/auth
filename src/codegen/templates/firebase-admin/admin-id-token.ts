import type { TemplateOptions } from '../../options'

/** Lifted from the reference app's `src/lib/firebase-admin/admin-id-token.ts`. Re-extract with `tools/extract-reference.ts`. */
export const adminIdTokenModule = (options: TemplateOptions): string =>
  `import { getFirebaseAdminAuth } from './admin'

/**
 * Convex validates JWTs against \`securetoken.google.com\` (see
 * \`convex/auth.config.ts\`), so an admin session cookie cannot be replayed to it
 * — \`verifySessionCookie\` returns a decoded token, not a re-usable one.
 *
 * The Worker instead re-mints a real ID token for the already-verified admin.
 * A custom token minted for a uid carries that user's own custom claims, so the
 * \`admin\` claim Convex's \`requireAdmin\` checks is the user's genuine claim; no
 * identity is forged and Convex's authorization model is untouched.
 */

// ID tokens live an hour; refresh a little early so an in-flight request never
// hands Convex a token that expires mid-call.
const TOKEN_TTL_MS = 55 * 60 * 1000
const IDENTITY_TOOLKIT_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken'

interface CachedIdToken {
  expiresAt: number
  idToken: string
}

const idTokenCache = new Map<string, CachedIdToken>()

const getWebApiKey = () => process.env.FIREBASE_API_KEY?.trim() || process.env.PUBLIC_FIREBASE_API_KEY?.trim() || null

export class AdminIdTokenError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AdminIdTokenError'
  }
}

async function exchangeCustomToken(customToken: string, apiKey: string): Promise<string> {
  const response = await fetch(\`\${IDENTITY_TOOLKIT_URL}?key=\${encodeURIComponent(apiKey)}\`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true })
  })

  const payload: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    const message =
      typeof payload === 'object' && payload !== null
        ? ((payload as { error?: { message?: unknown } }).error?.message ?? null)
        : null

    throw new AdminIdTokenError(
      typeof message === 'string' ? \`Token exchange failed: \${message}\` : 'Token exchange failed.'
    )
  }

  const idToken =
    typeof payload === 'object' && payload !== null ? (payload as { idToken?: unknown }).idToken : undefined

  if (typeof idToken !== 'string' || !idToken) {
    throw new AdminIdTokenError('Token exchange returned no ID token.')
  }

  return idToken
}

/**
 * Mint a Convex-usable Firebase ID token for an admin whose session cookie the
 * caller has ALREADY verified. Never call this with an unverified uid.
 */
export async function mintAdminIdToken(uid: string): Promise<string> {
  const cached = idTokenCache.get(uid)
  if (cached && cached.expiresAt > Date.now()) return cached.idToken

  const auth = getFirebaseAdminAuth()
  if (!auth) throw new AdminIdTokenError('Firebase Admin credentials are not configured.')

  const apiKey = getWebApiKey()
  if (!apiKey) throw new AdminIdTokenError('FIREBASE_API_KEY is not configured.')

  const customToken = await auth.createCustomToken(uid)
  const idToken = await exchangeCustomToken(customToken, apiKey)

  idTokenCache.set(uid, { expiresAt: Date.now() + TOKEN_TTL_MS, idToken })

  return idToken
}

export function clearAdminIdTokenCache(uid?: string) {
  if (uid) idTokenCache.delete(uid)
  else idTokenCache.clear()
}
`
