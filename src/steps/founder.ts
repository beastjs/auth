import { startFounderSignIn } from '../founder/server'
import * as ui from '../prompts'
import { emptyPlan, type Step } from '../step'
import type { FirebaseAdminCredential, RunContext } from '../context'

/** Everything the founder gets, and why each one is needed. */
const FOUNDER_CLAIMS = {
  /**
   * The grant-making claim. Without it the founder could never promote a second
   * person from inside a console — `canManageFirebaseAccessClaim` lets only
   * `topg` hand out `admin` or `god` — so the app would be a one-person system
   * with no way to grow.
   */
  topg: true,
  god: true,
  admin: true
} as const

/**
 * Opens a browser, waits for a Google sign-in, and grants the founder claims.
 *
 * The sign-in happens in the person's own browser and this CLI only ever sees
 * the resulting ID token: no password is typed into it and no credential is
 * stored. The token is then verified with the Admin SDK before anything is
 * granted, so the uid being promoted is one Google vouched for.
 */
export const founderStep: Step = {
  id: 'founder.signIn',
  title: 'Founder account',

  skip: (context) => context.mode !== 'apply',

  async detect(context) {
    if (context.founderUid !== null) return 'satisfied'
    // Nothing can be granted without a credential to sign the call.
    return context.adminCredential === null ? 'satisfied' : 'absent'
  },

  async plan() {
    return emptyPlan('Sign in with Google and grant yourself the founder claims.')
  },

  async apply(context) {
    const { adminCredential, webConfig, projectId } = context

    if (adminCredential === null || webConfig === null || projectId === null) {
      ui.log.warn('Skipped: the founder claims need a project, a client config and an Admin credential.')
      return
    }

    const signIn = await startFounderSignIn({ config: webConfig, projectId, appSlug: context.app.appSlug })

    ui.note(
      [
        'A browser window will open. Sign in with the Google account that should',
        'own this app — it becomes the founder.',
        '',
        signIn.url
      ].join('\n'),
      'Founder sign-in'
    )

    if (context.openBrowser) await openUrl(context, signIn.url)

    const waiting = ui.spinner()
    waiting.start('Waiting for the sign-in')

    let idToken: string
    try {
      idToken = await signIn.idToken
    } catch (error) {
      waiting.stop('No sign-in arrived')
      signIn.close()
      ui.log.warn(error instanceof Error ? error.message : 'The sign-in did not complete.')
      context.manual.push({ title: 'Founder claims', outcome: 'skipped' })
      ui.note(claimsByHand(), 'Grant them by hand instead')
      return
    }

    waiting.stop('Signed in')

    const granting = ui.spinner()
    granting.start('Granting the founder claims')

    try {
      const founder = await grantFounderClaims(adminCredential, idToken)
      granting.stop(`${founder.email ?? founder.uid} is the founder`)

      context.founderUid = founder.uid
      context.manual.push({ title: 'Founder claims', outcome: 'verified' })

      ui.note(
        [
          `uid     ${founder.uid}`,
          `email   ${founder.email ?? '(none)'}`,
          `claims  ${JSON.stringify(founder.claims)}`,
          '',
          'A browser already signed in keeps its old token until it is refreshed,',
          'so call getIdToken(true) or sign out and back in to see these.'
        ].join('\n'),
        'Founder'
      )
    } catch (error) {
      granting.stop('Could not grant the claims')
      ui.log.error(error instanceof Error ? error.message : 'The claims were not granted.')
      context.manual.push({ title: 'Founder claims', outcome: 'skipped' })
      ui.note(claimsByHand(), 'Grant them by hand instead')
    }
  }
}

const claimsByHand = () =>
  [
    'bun run fb:claims -- --email you@example.com \\',
    `  --claims '${JSON.stringify(FOUNDER_CLAIMS)}' --merge`
  ].join('\n')

async function openUrl(context: RunContext, url: string): Promise<void> {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]]

  try {
    await context.runner.run(command as string, args as string[])
  } catch {
    // The URL is printed either way, so this is not worth stopping for.
  }
}

export type Founder = {
  readonly uid: string
  readonly email: string | null
  readonly claims: Record<string, unknown>
}

/**
 * Verifies the ID token and merges the founder claims onto that account.
 *
 * Merged rather than replaced: an account may already carry claims this tool
 * knows nothing about, and replacing them would silently revoke whatever they
 * granted. Refresh tokens are deliberately **not** revoked — that would
 * invalidate the very token just used.
 */
export async function grantFounderClaims(
  credential: FirebaseAdminCredential,
  idToken: string
): Promise<Founder> {
  // Imported here rather than at the top: `firebase-admin` is large, and a
  // `--check` run must never pay for it.
  const { cert, deleteApp, getApps, initializeApp } = await import('firebase-admin/app')
  const { getAuth } = await import('firebase-admin/auth')

  const name = 'beast-auth-founder'
  const existing = getApps().find((app) => app.name === name)
  const app =
    existing ??
    initializeApp(
      {
        credential: cert({
          projectId: credential.projectId,
          clientEmail: credential.clientEmail,
          privateKey: credential.privateKey
        })
      },
      // Named, so it cannot collide with a default app in the same process.
      name
    )

  try {
    const auth = getAuth(app)
    const decoded = await auth.verifyIdToken(idToken, true)

    // The generated `canReceiveFirebaseClaimGrant` enforces this for every later
    // grant, so the founder has to satisfy it too.
    if (decoded.email_verified !== true) {
      throw new Error('The founder account needs a verified email address.')
    }

    const before = await auth.getUser(decoded.uid)
    const merged = { ...(before.customClaims ?? {}), ...FOUNDER_CLAIMS }

    const size = new TextEncoder().encode(JSON.stringify(merged)).byteLength
    if (size > 1000) {
      throw new Error(`These claims come to ${size} bytes, and Firebase allows 1000.`)
    }

    await auth.setCustomUserClaims(decoded.uid, merged)

    // Read back rather than reporting what was sent.
    const after = await auth.getUser(decoded.uid)

    return { uid: after.uid, email: after.email ?? null, claims: after.customClaims ?? {} }
  } finally {
    if (existing === undefined) await deleteApp(app)
  }
}
