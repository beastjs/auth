import { join } from 'node:path'
import type { FileWrite } from '../step'
import { withHeader } from './emit'
import { resolveRegions, type TemplateOptions } from './options'
import { firebaseAccountsModule } from './templates/firebase/accounts'
import { firebaseAuthModule } from './templates/firebase/auth'
import { firebaseIndexModule } from './templates/firebase/index'
import { accountAdminAccessModule } from './templates/firebase-admin/account-admin-access'
import { adminBarrelModule } from './templates/firebase-admin/admin'
import { adminCoreModule } from './templates/firebase-admin/admin-core'
import { adminCoreTestModule } from './templates/firebase-admin/admin-core-test'
import { adminIdTokenModule } from './templates/firebase-admin/admin-id-token'
import { adminUsersModule } from './templates/firebase-admin/admin-users'
import { adminUsersTestModule } from './templates/firebase-admin/admin-users-test'
import { customClaimsModule } from './templates/firebase-admin/custom-claims'
import { customClaimsTestModule } from './templates/firebase-admin/custom-claims-test'
import { godDirectoryModule } from './templates/firebase-admin/god-directory'
import { seedClaimsScript } from './templates/scripts/seed-claims'

type Template = (options: TemplateOptions) => string

/**
 * A generated file: where it goes, what renders it, and whether a test file
 * carries the "do not edit" header.
 *
 * Tests are emitted with the header too — they are regenerated like everything
 * else, and a test the user has quietly edited would be silently replaced on the
 * next run, which the header is there to warn about.
 */
type Emission = {
  readonly path: string
  readonly render: Template
}

const CORE: readonly Emission[] = [
  { path: 'src/lib/firebase/index.ts', render: firebaseIndexModule },
  { path: 'src/lib/firebase/auth.ts', render: firebaseAuthModule },
  { path: 'src/lib/firebase/accounts.ts', render: firebaseAccountsModule },
  { path: 'src/lib/firebase-admin/custom-claims.ts', render: customClaimsModule },
  { path: 'src/lib/firebase-admin/custom-claims.test.ts', render: customClaimsTestModule },
  { path: 'src/lib/firebase-admin/admin-core.ts', render: adminCoreModule },
  { path: 'src/lib/firebase-admin/admin-core.test.ts', render: adminCoreTestModule },
  { path: 'src/lib/firebase-admin/admin.ts', render: adminBarrelModule },
  { path: 'src/lib/firebase-admin/admin-users.ts', render: adminUsersModule },
  { path: 'src/lib/firebase-admin/admin-users.test.ts', render: adminUsersTestModule },
  { path: 'scripts/firebase/seed-claims.ts', render: seedClaimsScript }
]

/**
 * The god-tier toolkit: re-minting an ID token, scanning the roster by claim, and
 * revoking admin access.
 *
 * Only a console uses any of it, so an app that chose no console does not get it
 * — generating a roster scanner nothing calls is dead code on day one.
 */
const CONSOLE_ADMIN: readonly Emission[] = [
  { path: 'src/lib/firebase-admin/admin-id-token.ts', render: adminIdTokenModule },
  { path: 'src/lib/firebase-admin/god-directory.ts', render: godDirectoryModule },
  { path: 'src/lib/firebase-admin/account-admin-access.ts', render: accountAdminAccessModule }
]

/**
 * Every file the Firebase integration owns, for this app and these consoles.
 *
 * Rendering is pure: nothing here touches the filesystem, so the same call backs
 * `--dry-run`, `--check`, and the real write, and a test can assert the bytes
 * without a temp directory.
 */
export function buildFirebaseManifest(root: string, options: TemplateOptions): readonly FileWrite[] {
  const emissions = options.consoles.length > 0 ? [...CORE, ...CONSOLE_ADMIN] : CORE

  return emissions.map((emission) => ({
    path: join(root, emission.path),
    contents: withHeader(resolveRegions(emission.render(options), options))
  }))
}
