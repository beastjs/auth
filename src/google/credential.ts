import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { CommandRunner } from '../exec'

/** Where `firebase login` keeps the credential it just obtained. */
const CONFIGSTORE = join(homedir(), '.config', 'configstore', 'firebase-tools.json')

/** Refreshed a little early, so a long step cannot expire mid-run. */
const EXPIRY_MARGIN_MS = 2 * 60 * 1000

type ConfigStore = {
  tokens?: {
    access_token?: string
    expires_at?: number
    scopes?: readonly string[]
    scope?: string
  }
  user?: { email?: string }
}

export class NoGoogleCredentialError extends Error {
  constructor(reason: string) {
    super(`${reason} Run \`firebase login --reauth\` and try again.`)
    this.name = 'NoGoogleCredentialError'
  }
}

/**
 * Supplies an OAuth access token for the Google APIs.
 *
 * Credential *acquisition* stays with the `firebase` CLI — it owns the browser
 * flow, and this tool should never ask for a Google password or hold a refresh
 * token of its own. This only reads the token that flow already produced, and
 * refuses when it is missing or stale rather than trying to refresh it, which
 * would mean embedding another project's OAuth client secret.
 */
export type TokenProvider = {
  getAccessToken(): Promise<string>
  describe(): Promise<string>
}

async function readConfigStore(): Promise<ConfigStore | null> {
  try {
    return JSON.parse(await readFile(CONFIGSTORE, 'utf8')) as ConfigStore
  } catch {
    return null
  }
}

const hasCloudPlatformScope = (tokens: NonNullable<ConfigStore['tokens']>) =>
  [...(tokens.scopes ?? []), tokens.scope ?? ''].join(' ').includes('cloud-platform')

export function createTokenProvider(runner: CommandRunner): TokenProvider {
  let cached: string | null = null

  const read = async () => {
    const store = await readConfigStore()
    if (store?.tokens?.access_token === undefined) {
      throw new NoGoogleCredentialError('No Firebase credential was found on this machine.')
    }

    const { tokens } = store

    if (typeof tokens.expires_at !== 'number' || tokens.expires_at - EXPIRY_MARGIN_MS <= Date.now()) {
      throw new NoGoogleCredentialError('Your Firebase credential has expired.')
    }

    if (!hasCloudPlatformScope(tokens)) {
      throw new NoGoogleCredentialError('Your Firebase credential is missing the cloud-platform scope.')
    }

    return tokens.access_token as string
  }

  return {
    async getAccessToken() {
      // `gcloud` would also do, but it is not required: the `firebase` CLI is
      // already a prerequisite and its credential carries the same scope.
      if (cached === null) cached = await read()
      return cached
    },

    async describe() {
      const store = await readConfigStore()
      const email = store?.user?.email
      const gcloud = await runner.which('gcloud')

      return email === undefined
        ? 'no Firebase credential'
        : `${email}${gcloud === null ? '' : ' (gcloud also available)'}`
    }
  }
}
