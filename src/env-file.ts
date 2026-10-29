import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { FirebaseAdminCredential, FirebaseWebConfig } from './context'
import type { FileWrite } from './step'

export type EnvEntry = {
  readonly key: string
  readonly value: string
}

const NEEDS_QUOTES = /[\s#'"]/

/**
 * Renders one `KEY=value` line.
 *
 * A PEM arrives with real newlines, which cannot survive in a dotenv file, so it
 * is written double-quoted with `\n` escapes — exactly the shape the reference's
 * `admin-core.ts` already un-escapes in `normalizePrivateKey`, and the shape
 * `wrangler secret put` round-trips.
 */
export function formatEnvLine({ key, value }: EnvEntry): string {
  if (value.length === 0) return `${key}=`

  const escaped = value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"')

  return NEEDS_QUOTES.test(value) || escaped !== value ? `${key}="${escaped}"` : `${key}=${value}`
}

const keyPattern = (key: string) => new RegExp(`^[ \\t]*(?:export[ \\t]+)?${key}[ \\t]*=.*$`, 'm')

/**
 * Sets each key in an existing dotenv file, leaving everything else alone.
 *
 * A key already present is replaced in place rather than appended, so re-running
 * cannot leave two definitions of the same variable — the last one wins silently
 * and that is a very hard bug to see. Unrelated lines, comments included, are
 * never touched.
 */
export function upsertEnvContents(existing: string, entries: readonly EnvEntry[]): string {
  let contents = existing
  const appended: string[] = []

  for (const entry of entries) {
    const line = formatEnvLine(entry)
    const pattern = keyPattern(entry.key)

    if (pattern.test(contents)) {
      contents = contents.replace(pattern, line)
    } else {
      appended.push(line)
    }
  }

  if (appended.length === 0) return contents

  const base = contents.length === 0 || contents.endsWith('\n') ? contents : `${contents}\n`
  const separator = base.length > 0 && !base.endsWith('\n\n') ? '\n' : ''

  return `${base}${separator}# Firebase — written by @beastjs/auth.\n${appended.join('\n')}\n`
}

export const webConfigEntries = (config: FirebaseWebConfig): readonly EnvEntry[] =>
  [
    { key: 'PUBLIC_FIREBASE_API_KEY', value: config.apiKey },
    { key: 'PUBLIC_FIREBASE_AUTH_DOMAIN', value: config.authDomain },
    { key: 'PUBLIC_FIREBASE_PROJECT_ID', value: config.projectId },
    { key: 'PUBLIC_FIREBASE_STORAGE_BUCKET', value: config.storageBucket },
    { key: 'PUBLIC_FIREBASE_MESSAGING_SENDER_ID', value: config.messagingSenderId },
    { key: 'PUBLIC_FIREBASE_APP_ID', value: config.appId },
    ...(config.measurementId ? [{ key: 'PUBLIC_FIREBASE_MEASUREMENT_ID', value: config.measurementId }] : [])
  ] as const

export const adminCredentialEntries = (credential: FirebaseAdminCredential): readonly EnvEntry[] =>
  [
    { key: 'FIREBASE_PROJECT_ID', value: credential.projectId },
    { key: 'FIREBASE_CLIENT_EMAIL', value: credential.clientEmail },
    { key: 'FIREBASE_PRIVATE_KEY', value: credential.privateKey },
    { key: 'FIREBASE_PRIVATE_KEY_ID', value: credential.privateKeyId }
  ] as const

/** `.env.example` is committed, so it carries every key and not one value. */
const toExampleEntries = (entries: readonly EnvEntry[]): readonly EnvEntry[] =>
  entries.map(({ key }) => ({ key, value: '' }))

async function readOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return ''
  }
}

/**
 * The three env surfaces a beast app actually has, and who reads each one.
 *
 * `.env` feeds rsbuild (which inlines only `PUBLIC_*`) and the Bun scripts;
 * `.dev.vars` feeds the Worker under Wrangler, which never reads `.env`; and
 * `.env.example` is the committed record of which keys exist. The admin
 * credential goes in two of them because the scripts and the Worker are
 * different processes with different loaders.
 */
export async function buildEnvWrites(
  root: string,
  config: FirebaseWebConfig,
  credential: FirebaseAdminCredential | null
): Promise<readonly FileWrite[]> {
  const web = webConfigEntries(config)
  const admin = credential ? adminCredentialEntries(credential) : []

  // The Worker needs the web API key as well as the admin credential:
  // `admin-id-token.ts` reads `FIREBASE_API_KEY ?? PUBLIC_FIREBASE_API_KEY`
  // server-side to trade a custom token for a real ID token. Without it the
  // exchange fails only in the Worker, long after the client looks fine.
  const workerEntries = admin.length > 0 ? [...admin, { key: 'PUBLIC_FIREBASE_API_KEY', value: config.apiKey }] : []

  const surfaces = [
    { file: '.env', entries: [...web, ...admin] },
    { file: '.dev.vars', entries: workerEntries },
    { file: '.env.example', entries: toExampleEntries([...web, ...admin]) }
  ] as const

  const writes: FileWrite[] = []

  for (const surface of surfaces) {
    if (surface.entries.length === 0) continue
    const path = join(root, surface.file)
    writes.push({ path, contents: upsertEnvContents(await readOrEmpty(path), surface.entries) })
  }

  return writes
}
