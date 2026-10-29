import type { TemplateOptions } from '../../options'

/** Lifted from the reference app's `src/lib/firebase-admin/account-admin-access.ts`. Re-extract with `tools/extract-reference.ts`. */
export const accountAdminAccessModule = (options: TemplateOptions): string =>
  `import { getFirebaseUserByUid, revokeFirebaseUserRefreshTokens, setFirebaseCustomUserClaims } from './admin'
import { clearAdminIdTokenCache } from './admin-id-token'
import { updateFirebaseManagedAccessClaim } from './custom-claims'
import { readFirebaseCustomClaims } from './god-directory'

/** Remove only admin, preserving unrelated claims, and invalidate cached sessions. */
export async function revokeAccountAdminClaim(uid: string) {
  const target = await getFirebaseUserByUid(uid)
  const claims = readFirebaseCustomClaims(target.customClaims)
  if (claims.admin === true) {
    await setFirebaseCustomUserClaims(uid, updateFirebaseManagedAccessClaim(claims, 'admin', false))
  }
  clearAdminIdTokenCache(uid)
  await revokeFirebaseUserRefreshTokens(uid)
}
`
