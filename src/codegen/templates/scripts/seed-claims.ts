import type { TemplateOptions } from '../../options'

/** Lifted from the reference app's `scripts/firebase/seed-claims.ts`. Re-extract with `tools/extract-reference.ts`. */
export const seedClaimsScript = (options: TemplateOptions): string =>
  `import {
  getFirebaseUser,
  mergeFirebaseCustomUserClaims,
  setFirebaseCustomUserClaims
} from '../../src/lib/firebase-admin/admin-core'
import { type FirebaseCustomClaims, isFirebaseCustomClaims } from '../../src/lib/firebase-admin/custom-claims'

type ParsedArgs = {
  uid: string | null
  email: string | null
  claims: FirebaseCustomClaims | null
  merge: boolean
}

const usage = [
  'Usage:',
  \`  bun run firebase:claims -- --uid <uid> --claims '{"admin":true}' --merge\`,
  \`  bun run firebase:claims -- --email <email> --claims '{"role":"staff"}' --merge\`,
  '',
  'Notes:',
  '  - Pass --claims null to clear all custom claims for the user.',
  '  - Omit --merge to replace the existing custom claims object.',
  '  - Use --merge to patch into the existing claims instead of overwriting them.'
].join('\\n')

function readFlagValue(args: string[], index: number, flag: string) {
  const value = args[index + 1]

  if (!value || value.startsWith('--')) {
    throw new Error(\`Missing value for \${flag}.\\n\\n\${usage}\`)
  }

  return value
}

function parseClaims(rawClaims: string): FirebaseCustomClaims | null {
  let parsedClaims: unknown

  try {
    parsedClaims = JSON.parse(rawClaims)
  } catch {
    throw new Error(\`Unable to parse --claims as JSON.\\n\\n\${usage}\`)
  }

  if (parsedClaims === null) {
    return null
  }

  if (!isFirebaseCustomClaims(parsedClaims)) {
    throw new Error('Custom claims must be a JSON object or null.')
  }

  return parsedClaims
}

function parseArgs(argv: string[]): ParsedArgs {
  let uid: string | null = null
  let email: string | null = null
  let claims: FirebaseCustomClaims | null = null
  let hasClaims = false
  let merge = false

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    switch (arg) {
      case '--uid':
        uid = readFlagValue(argv, index, '--uid')
        index += 1
        break
      case '--email':
        email = readFlagValue(argv, index, '--email')
        index += 1
        break
      case '--claims':
        claims = parseClaims(readFlagValue(argv, index, '--claims'))
        hasClaims = true
        index += 1
        break
      case '--merge':
        merge = true
        break
      case '--help':
      case '-h':
        console.log(usage)
        process.exit(0)
        break
      default:
        throw new Error(\`Unknown argument: \${arg}\\n\\n\${usage}\`)
    }
  }

  if ((uid ? 1 : 0) + (email ? 1 : 0) !== 1) {
    throw new Error(\`Provide exactly one of --uid or --email.\\n\\n\${usage}\`)
  }

  if (!hasClaims) {
    throw new Error(\`Missing required --claims argument.\\n\\n\${usage}\`)
  }

  if (claims === null && merge) {
    throw new Error('Cannot use --merge together with --claims null.')
  }

  return {
    uid,
    email,
    claims,
    merge
  }
}

async function main() {
  const { uid, email, claims, merge } = parseArgs(process.argv.slice(2))
  const user = await getFirebaseUser({ uid, email })
  const nextClaims =
    merge && claims !== null
      ? await mergeFirebaseCustomUserClaims(user.uid, claims)
      : await setFirebaseCustomUserClaims(user.uid, claims)

  console.log(
    JSON.stringify(
      {
        uid: user.uid,
        email: user.email ?? null,
        customClaims: nextClaims
      },
      null,
      2
    )
  )
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : 'Failed to update Firebase custom claims.'
  console.error(message)
  process.exitCode = 1
})
`
