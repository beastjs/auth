import { derive, deriveAll } from '../../derive'
import type { ConsoleSpec } from '../../../context'
import type { TemplateOptions } from '../../options'

/** Whether to offer a console to the account in front of us. */
export const consoleAccessModule = (spec: ConsoleSpec, options: TemplateOptions): string => {
  const c = derive(spec, options.appSlug)

  return `import type { FirebaseCustomClaims } from '@/lib/firebase-admin/custom-claims'

/**
 * Whether the app should offer ${c.title} to the account in front of it.
 *
 * Visibility is not access: the Worker verifies the \`${c.claim}\` claim again on
 * every \`${c.apiPrefix}/*\` request, and the console's shell refuses a session
 * without it. This only decides whether an account is shown a door it can open,
 * so it answers false for a signed-out visitor, for an account whose claims have
 * not loaded yet, and for one whose claims came back without \`${c.claim}\`.
 */
export function canOpen${c.pascal}(isSignedIn: boolean, claims: FirebaseCustomClaims): boolean {
  return isSignedIn && claims.${c.claim} === true
}
`
}

/** The dev-only gate that lets a console be worked on without a session. */
export const consoleDevGateModule = (spec: ConsoleSpec, options: TemplateOptions): string => {
  const c = derive(spec, options.appSlug)

  return `/**
 * Opens ${c.title}'s client-side gate so the console can be worked on without a
 * \`${c.claim}\` session.
 *
 * This is a view of the console, not access to it: every \`${c.apiPrefix}/*\` route
 * still verifies the session cookie and the claim, so an open gate shows the
 * chrome and whatever the page can read without the server — it cannot read
 * anything privileged.
 *
 * Both conditions are build-time constants, so a production bundle folds this to
 * \`false\` and drops the branch entirely. Setting the variable in a deployed
 * environment therefore does nothing: it is only honoured by a dev build.
 */
export const is${c.pascal}GateOpen =
  import.meta.env.DEV === true && import.meta.env.PUBLIC_${c.upper}_OPEN === 'true'
`
}

/**
 * Trading a console's session cookie for a client sign-in on its own origin.
 *
 * Firebase auth state is per-origin, so arriving on a console's subdomain with a
 * valid session cookie still leaves the client SDK signed out there. The custom
 * token is what closes that gap.
 */
export const consoleSessionModule = (options: TemplateOptions): string => {
  const consoles = deriveAll(options.consoles, options.appSlug)

  return `import { signInWithCustomToken } from 'firebase/auth'
import { auth } from './'

export type ConsoleScope = ${consoles.map((c) => `'${c.camel}'`).join(' | ')}

const tokenPaths: Readonly<Record<ConsoleScope, string>> = {
${consoles.map((c) => `  ${c.camel}: '${c.apiPrefix}/session/token'`).join(',\n')}
}

/**
 * Signs the client SDK in on this origin using the console's own session.
 *
 * Returns false when there is nothing to trade — no session, no credentials
 * configured — which is a signed-out console rather than an error: the shell
 * decides what to show.
 */
export async function signInFromConsoleSession(scope: ConsoleScope): Promise<boolean> {
  // Narrowed here rather than asserted: \`auth\` is null whenever the client
  // config is missing, and a missing \`.env\` should degrade, not throw.
  if (!auth) return false

  if (auth.currentUser) return true

  const response = await fetch(tokenPaths[scope], {
    method: 'POST',
    cache: 'no-store',
    credentials: 'same-origin'
  })

  if (!response.ok) return false

  let customToken: unknown
  try {
    const body: unknown = await response.json()
    customToken = typeof body === 'object' && body !== null ? (body as { customToken?: unknown }).customToken : undefined
  } catch {
    return false
  }

  if (typeof customToken !== 'string' || customToken.length === 0) return false

  await signInWithCustomToken(auth, customToken)

  return true
}
`
}
