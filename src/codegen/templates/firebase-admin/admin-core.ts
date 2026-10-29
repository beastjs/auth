import type { TemplateOptions } from '../../options'

/** Lifted from the reference app's `src/lib/firebase-admin/admin-core.ts`. Re-extract with `tools/extract-reference.ts`. */
export const adminCoreModule = (options: TemplateOptions): string =>
  `import { cert, getApp, getApps, initializeApp, type ServiceAccount } from 'firebase-admin/app'
import { type Auth, getAuth, type ListUsersResult, type UserRecord } from 'firebase-admin/auth'
import { type FirebaseCustomClaims, isFirebaseCustomClaims } from './custom-claims'

type FirebaseServiceAccountInput = {
  project_id?: string
  projectId?: string
  client_email?: string
  clientEmail?: string
  private_key?: string
  privateKey?: string
}

let cachedAuth: Auth | null | undefined

const PRIVATE_KEY_PEM_MARKER = 'BEGIN PRIVATE KEY'
const SURROUNDING_QUOTES = /^(['"])([\\s\\S]*)\\1$/

/**
 * A secret copied out of a \`.env\` line keeps the quotes that made it one line,
 * and \`wrangler secret put\` stores whatever it is handed — so on the Worker the
 * value arrives as \`"{...}"\` or \`"-----BEGIN PRIVATE KEY-----\\n..."\`, quotes and
 * all. Both the JSON parser and the PEM parser reject that, so strip the wrapper
 * before anything else looks at the value.
 */
function readEnvSecret(name: string): string | undefined {
  const value = process.env[name]?.trim()

  if (!value) {
    return undefined
  }

  const unquoted = value.replace(SURROUNDING_QUOTES, '$2').trim()

  return unquoted.length > 0 ? unquoted : undefined
}

function normalizePrivateKey(privateKey: string) {
  return privateKey.replace(/\\\\n/g, '\\n')
}

function buildServiceAccount(
  projectId: string | undefined,
  clientEmail: string | undefined,
  privateKey: string | undefined
) {
  if (!projectId || !clientEmail || !privateKey) {
    return null
  }

  const normalizedPrivateKey = normalizePrivateKey(privateKey)

  // \`FIREBASE_PRIVATE_KEY\` is easy to point at the service account's
  // \`private_key_id\` by mistake. A non-PEM value cannot be recovered from, and
  // left alone it fails much later inside \`cert()\` as an unhandled throw; a
  // missing credential is the honest description, and callers already render it.
  if (!normalizedPrivateKey.includes(PRIVATE_KEY_PEM_MARKER)) {
    return null
  }

  return {
    projectId,
    clientEmail,
    privateKey: normalizedPrivateKey
  }
}

function readServiceAccountFromJson(): ServiceAccount | null {
  const rawServiceAccount = readEnvSecret('FIREBASE_SERVICE_ACCOUNT_KEY')

  if (!rawServiceAccount?.startsWith('{')) {
    return null
  }

  try {
    const parsed = JSON.parse(rawServiceAccount) as FirebaseServiceAccountInput
    return (
      buildServiceAccount(
        parsed.project_id ?? parsed.projectId ?? readEnvSecret('FIREBASE_PROJECT_ID'),
        parsed.client_email ?? parsed.clientEmail ?? readEnvSecret('FIREBASE_CLIENT_EMAIL'),
        parsed.private_key ?? parsed.privateKey ?? readEnvSecret('FIREBASE_PRIVATE_KEY')
      ) ?? null
    )
  } catch {
    return null
  }
}

function readServiceAccountFromEnv(): ServiceAccount | null {
  const projectId = readEnvSecret('FIREBASE_PROJECT_ID')
  const clientEmail = readEnvSecret('FIREBASE_CLIENT_EMAIL')
  const rawServiceAccountKey = readEnvSecret('FIREBASE_SERVICE_ACCOUNT_KEY')
  const privateKey = rawServiceAccountKey?.includes(PRIVATE_KEY_PEM_MARKER)
    ? rawServiceAccountKey
    : readEnvSecret('FIREBASE_PRIVATE_KEY')

  const serviceAccount = buildServiceAccount(projectId, clientEmail, privateKey)

  if (serviceAccount) {
    return serviceAccount
  }

  return null
}

function readServiceAccount(): ServiceAccount | null {
  return readServiceAccountFromJson() ?? readServiceAccountFromEnv()
}

/**
 * The \`private_key_id\` of the service account the Worker is signing with.
 *
 * It names a key rather than being one — \`cert()\` signs with the PEM in
 * \`FIREBASE_PRIVATE_KEY\` and never reads this — so it exists to tell which key
 * a deployment is on, which is what a rotation needs to confirm. Read from
 * \`FIREBASE_PRIVATE_KEY_ID\`, falling back to the field inside a service account
 * JSON blob.
 */
export function getFirebaseServiceAccountKeyId(): string | null {
  const keyId = readEnvSecret('FIREBASE_PRIVATE_KEY_ID')
  if (keyId) return keyId

  const rawServiceAccount = readEnvSecret('FIREBASE_SERVICE_ACCOUNT_KEY')
  if (!rawServiceAccount?.startsWith('{')) return null

  try {
    const parsed = JSON.parse(rawServiceAccount) as { private_key_id?: unknown; privateKeyId?: unknown }
    const parsedKeyId = parsed.private_key_id ?? parsed.privateKeyId
    return typeof parsedKeyId === 'string' && parsedKeyId.length > 0 ? parsedKeyId : null
  } catch {
    return null
  }
}

function requireFirebaseAdminAuth(): Auth {
  const auth = getFirebaseAdminAuth()

  if (!auth) {
    throw new Error('Firebase Admin credentials are not configured.')
  }

  return auth
}

function normalizeRequiredString(value: string, label: string) {
  const normalized = value.trim()

  if (normalized.length === 0) {
    throw new Error(\`\${label} is required.\`)
  }

  return normalized
}

function normalizeExistingCustomClaims(customClaims: UserRecord['customClaims']): FirebaseCustomClaims {
  return isFirebaseCustomClaims(customClaims) ? { ...customClaims } : {}
}

export function getFirebaseAdminAuth(): Auth | null {
  if (cachedAuth !== undefined) {
    return cachedAuth
  }

  if (getApps().length > 0) {
    cachedAuth = getAuth(getApp())
    return cachedAuth
  }

  const serviceAccount = readServiceAccount()

  if (!serviceAccount) {
    cachedAuth = null
    return null
  }

  // \`cert()\` validates the key material and throws on anything it cannot parse.
  // Every caller is written against \`null\` — a 503 saying the credentials are
  // not configured — so let the throw become that instead of an unhandled
  // exception, which on Workers is an opaque 1101 with no response body at all.
  try {
    const app = initializeApp({
      credential: cert(serviceAccount)
    })

    cachedAuth = getAuth(app)
  } catch (error) {
    console.error('Firebase Admin initialization failed:', error)
    cachedAuth = null
  }

  return cachedAuth
}

export async function getFirebaseUserByUid(uid: string): Promise<UserRecord> {
  return await requireFirebaseAdminAuth().getUser(normalizeRequiredString(uid, 'Firebase uid'))
}

export async function getFirebaseUserByEmail(email: string): Promise<UserRecord> {
  return await requireFirebaseAdminAuth().getUserByEmail(normalizeRequiredString(email, 'Firebase email'))
}

export async function getFirebaseUser({
  uid,
  email
}: {
  uid?: string | null
  email?: string | null
}): Promise<UserRecord> {
  if (uid) {
    return await getFirebaseUserByUid(uid)
  }

  if (email) {
    return await getFirebaseUserByEmail(email)
  }

  throw new Error('Provide either a Firebase uid or email.')
}

export async function listFirebaseUsers(maxResults: number, pageToken?: string): Promise<ListUsersResult> {
  return await requireFirebaseAdminAuth().listUsers(maxResults, pageToken)
}

export async function setFirebaseCustomUserClaims(
  uid: string,
  customClaims: FirebaseCustomClaims | null
): Promise<FirebaseCustomClaims | null> {
  const normalizedUid = normalizeRequiredString(uid, 'Firebase uid')
  await requireFirebaseAdminAuth().setCustomUserClaims(normalizedUid, customClaims)
  return customClaims
}

export async function revokeFirebaseUserRefreshTokens(uid: string): Promise<void> {
  await requireFirebaseAdminAuth().revokeRefreshTokens(normalizeRequiredString(uid, 'Firebase uid'))
}

export async function mergeFirebaseCustomUserClaims(
  uid: string,
  customClaimsPatch: FirebaseCustomClaims
): Promise<FirebaseCustomClaims> {
  const normalizedUid = normalizeRequiredString(uid, 'Firebase uid')
  const auth = requireFirebaseAdminAuth()
  const existingUser = await auth.getUser(normalizedUid)
  const nextClaims = {
    ...normalizeExistingCustomClaims(existingUser.customClaims),
    ...customClaimsPatch
  }

  await auth.setCustomUserClaims(normalizedUid, nextClaims)
  return nextClaims
}
`
