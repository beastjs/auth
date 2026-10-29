import type { CommandRunner } from '../exec'

/**
 * What the `firebase` CLI is still for.
 *
 * Exactly one thing: the browser sign-in. It owns the OAuth client and the
 * redirect dance, and this tool should never ask for a Google password or keep a
 * refresh token of its own. Every other call it could make is done over REST
 * instead, because its HTTP layer fails outright on current Node.
 */
export async function reauthenticate(runner: CommandRunner): Promise<void> {
  const result = await runner.run('firebase', ['login', '--reauth'], { interactive: true })

  if (result.code !== 0) {
    throw new Error('`firebase login --reauth` did not complete, so nothing was changed.')
  }
}
