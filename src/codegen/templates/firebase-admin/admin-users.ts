import type { TemplateOptions } from '../../options'

/** Lifted from the reference app's `src/lib/firebase-admin/admin-users.ts`. Re-extract with `tools/extract-reference.ts`. */
export const adminUsersModule = (options: TemplateOptions): string =>
  `import type { UserRecord } from 'firebase-admin/auth'
import { isFirebaseCustomClaims } from './custom-claims'

type FirebaseAdminUserRecord = Pick<
  UserRecord,
  | 'customClaims'
  | 'disabled'
  | 'displayName'
  | 'email'
  | 'emailVerified'
  | 'metadata'
  | 'photoURL'
  | 'providerData'
  | 'uid'
>

export type FirebaseAdminUserSummary = {
  admin: boolean
  createdAt: string
  customClaimNames: string[]
  disabled: boolean
  displayName: string | null
  email: string | null
  emailVerified: boolean
  lastSignInAt: string | null
  photoUrl: string | null
  providerIds: string[]
  god: boolean
  topg: boolean
  uid: string
}

export function toFirebaseAdminUserSummary(user: FirebaseAdminUserRecord): FirebaseAdminUserSummary {
  const customClaims = isFirebaseCustomClaims(user.customClaims) ? user.customClaims : {}

  return {
    admin: customClaims.admin === true,
    createdAt: user.metadata.creationTime,
    customClaimNames: Object.keys(customClaims).sort(),
    disabled: user.disabled,
    displayName: user.displayName ?? null,
    email: user.email ?? null,
    emailVerified: user.emailVerified,
    lastSignInAt: user.metadata.lastSignInTime ?? null,
    photoUrl: user.photoURL ?? null,
    providerIds: Array.from(new Set(user.providerData.map(({ providerId }) => providerId))).sort(),
    god: customClaims.god === true,
    topg: customClaims.topg === true,
    uid: user.uid
  }
}
`
