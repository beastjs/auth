import type { TemplateOptions } from '../../options'

/** Lifted from the reference app's `src/lib/firebase-admin/custom-claims.ts`. Re-extract with `tools/extract-reference.ts`. */
export const customClaimsModule = (options: TemplateOptions): string =>
  `// @beast-auth:convex-start
import type { UserIdentity } from 'convex/server'
// @beast-auth:convex-end
import type { IdTokenResult } from 'firebase/auth'
import type { DecodedIdToken } from 'firebase-admin/auth'

export type FirebaseCustomClaimValue =
  | null
  | boolean
  | number
  | string
  | FirebaseCustomClaimValue[]
  | { [key: string]: FirebaseCustomClaimValue }

export type FirebaseCustomClaims = Record<string, FirebaseCustomClaimValue>
export type FirebaseManagedAccessClaimName = 'admin' | 'god'
export type FirebasePrivilegedCustomClaimName = FirebaseManagedAccessClaimName | 'topg'

export const FIREBASE_CUSTOM_CLAIMS_MAX_BYTES = 1000

const firebaseStandardClaimKeys = new Set([
  'acr',
  'amr',
  'at_hash',
  'aud',
  'auth_time',
  'azp',
  'email',
  'email_verified',
  'exp',
  'family_name',
  'firebase',
  'given_name',
  'iat',
  'iss',
  'jti',
  'locale',
  'middle_name',
  'name',
  'nbf',
  'nonce',
  'phone_number',
  'picture',
  'profile',
  'sub',
  'tenant_id',
  'uid',
  'updated_at',
  'user_id',
  'website',
  'zoneinfo'
])

const unsafeCustomClaimKeys = new Set(['__proto__', 'constructor', 'prototype'])
const managedAccessClaimKeys = new Set<FirebaseManagedAccessClaimName>(['admin', 'god'])
const privilegedCustomClaimKeys = new Set<FirebasePrivilegedCustomClaimName>(['admin', 'god', 'topg'])
const customClaimNamePattern = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/

// @beast-auth:convex-start
const convexIdentityStandardClaimKeys = new Set([
  'address',
  'birthday',
  'email',
  'emailVerified',
  'familyName',
  'gender',
  'givenName',
  'issuer',
  'language',
  'name',
  'nickname',
  'phoneNumber',
  'pictureUrl',
  'preferredUsername',
  'profileUrl',
  'subject',
  'timezone',
  'tokenIdentifier',
  'updatedAt'
])
// @beast-auth:convex-end

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isFirebaseCustomClaimValue(value: unknown): value is FirebaseCustomClaimValue {
  if (value === null) {
    return true
  }

  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return true
  }

  if (Array.isArray(value)) {
    return value.every(isFirebaseCustomClaimValue)
  }

  if (!isPlainObject(value)) {
    return false
  }

  return Object.values(value).every(isFirebaseCustomClaimValue)
}

export function isFirebaseCustomClaimName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value === value.trim() &&
    customClaimNamePattern.test(value) &&
    !firebaseStandardClaimKeys.has(value) &&
    !unsafeCustomClaimKeys.has(value) &&
    !isPrivilegedFirebaseCustomClaimName(value)
  )
}

export function isPrivilegedFirebaseCustomClaimName(value: unknown): value is FirebasePrivilegedCustomClaimName {
  return typeof value === 'string' && privilegedCustomClaimKeys.has(value as FirebasePrivilegedCustomClaimName)
}

export function isFirebaseManagedAccessClaimName(value: unknown): value is FirebaseManagedAccessClaimName {
  return typeof value === 'string' && managedAccessClaimKeys.has(value as FirebaseManagedAccessClaimName)
}

export function canReceiveFirebaseClaimGrant(recipient: { email?: string | null; emailVerified: boolean }): boolean {
  return recipient.emailVerified === true && typeof recipient.email === 'string' && recipient.email.trim().length > 0
}

export function updateFirebaseAdminClaim(claims: FirebaseCustomClaims, enabled: boolean): FirebaseCustomClaims {
  return updateFirebaseManagedAccessClaim(claims, 'admin', enabled)
}

export function updateFirebaseManagedAccessClaim(
  claims: FirebaseCustomClaims,
  claim: FirebaseManagedAccessClaimName,
  enabled: boolean
): FirebaseCustomClaims {
  const nextClaims = { ...claims }

  if (enabled) {
    nextClaims[claim] = true
  } else {
    delete nextClaims[claim]
  }

  return nextClaims
}

export function canManageFirebaseAccessClaim(
  actorClaims: FirebaseCustomClaims,
  claim: FirebaseManagedAccessClaimName
): boolean {
  if (claim === 'admin' || claim === 'god') {
    return actorClaims.topg === true
  }

  return false
}

export function canViewTopgFirebaseUser(
  actorClaims: FirebaseCustomClaims,
  targetClaims: FirebaseCustomClaims
): boolean {
  return targetClaims.topg !== true || actorClaims.topg === true
}

export function hasFirebaseGodAccess(claims: FirebaseCustomClaims): boolean {
  return claims.god === true
}

export function hasFirebaseAdminAccess(claims: FirebaseCustomClaims): boolean {
  return claims.admin === true
}
export function getFirebaseCustomClaimsByteLength(claims: FirebaseCustomClaims): number {
  return new TextEncoder().encode(JSON.stringify(claims)).byteLength
}

export function isFirebaseCustomClaims(value: unknown): value is FirebaseCustomClaims {
  if (!isPlainObject(value)) {
    return false
  }

  return Object.values(value).every(isFirebaseCustomClaimValue)
}

function collectCustomClaims(
  source: Record<string, unknown> | null | undefined,
  reservedKeys: ReadonlySet<string>
): FirebaseCustomClaims {
  if (!source) {
    return {}
  }

  const customClaims: FirebaseCustomClaims = {}

  for (const [key, value] of Object.entries(source)) {
    if (reservedKeys.has(key) || !isFirebaseCustomClaimValue(value)) {
      continue
    }

    customClaims[key] = value
  }

  return customClaims
}

export function getFirebaseCustomClaimsFromTokenClaims(
  claims: Record<string, unknown> | null | undefined
): FirebaseCustomClaims {
  return collectCustomClaims(claims, firebaseStandardClaimKeys)
}

export function getFirebaseCustomClaimsFromIdTokenResult(
  tokenResult: Pick<IdTokenResult, 'claims'> | null | undefined
): FirebaseCustomClaims {
  return getFirebaseCustomClaimsFromTokenClaims((tokenResult?.claims as Record<string, unknown> | undefined) ?? null)
}

export function getFirebaseCustomClaimsFromDecodedToken(
  decodedToken: DecodedIdToken | null | undefined
): FirebaseCustomClaims {
  return getFirebaseCustomClaimsFromTokenClaims((decodedToken as Record<string, unknown> | undefined) ?? null)
}

// @beast-auth:convex-start
export function getFirebaseCustomClaimsFromConvexIdentity(
  identity: UserIdentity | null | undefined
): FirebaseCustomClaims {
  return collectCustomClaims((identity as Record<string, unknown> | undefined) ?? null, convexIdentityStandardClaimKeys)
}
// @beast-auth:convex-end
`
