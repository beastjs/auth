/**
 * Lifts the reference implementation's modules into template modules under
 * `src/codegen/templates/`, run once against a known-good beast app.
 *
 * The templates are committed, so the reference app is a build-time input and
 * never a runtime dependency of the published CLI. Re-run this only to pull a
 * deliberate upstream change forward:
 *
 *   bun run tools/extract-reference.ts ~/Code/lucky-pick
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

type Replacement = { readonly find: string; readonly put: string }

type Entry = {
  /** Path inside the reference app. */
  readonly from: string
  /** Template module written under src/codegen/templates/. */
  readonly to: string
  /** The exported renderer's name. */
  readonly name: string
  /** Applied to the raw source before escaping. */
  readonly replace?: readonly Replacement[]
  /** Text wrapped in strippable region markers, so a renderer can drop it. */
  readonly region?: readonly { readonly tag: string; readonly text: string }[]
}

const CONVEX_IMPORT = "import type { UserIdentity } from 'convex/server'"

const CONVEX_KEYS = `const convexIdentityStandardClaimKeys = new Set([
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
])`

const CONVEX_EXTRACTOR = `export function getFirebaseCustomClaimsFromConvexIdentity(
  identity: UserIdentity | null | undefined
): FirebaseCustomClaims {
  return collectCustomClaims((identity as Record<string, unknown> | undefined) ?? null, convexIdentityStandardClaimKeys)
}`

const entries: readonly Entry[] = [
  { from: 'src/lib/firebase/index.ts', to: 'firebase/index.ts', name: 'firebaseIndexModule' },
  { from: 'src/lib/firebase/auth.ts', to: 'firebase/auth.ts', name: 'firebaseAuthModule' },
  {
    from: 'src/lib/firebase/accounts.ts',
    to: 'firebase/accounts.ts',
    name: 'firebaseAccountsModule',
    replace: [{ find: "'lucky-pick:accounts'", put: '@@APP_SLUG_KEY@@' }]
  },
  {
    from: 'src/lib/firebase-admin/custom-claims.ts',
    to: 'firebase-admin/custom-claims.ts',
    name: 'customClaimsModule',
    region: [
      { tag: 'convex', text: CONVEX_IMPORT },
      { tag: 'convex', text: CONVEX_KEYS },
      { tag: 'convex', text: CONVEX_EXTRACTOR }
    ]
  },
  { from: 'src/lib/firebase-admin/admin-core.ts', to: 'firebase-admin/admin-core.ts', name: 'adminCoreModule' },
  { from: 'src/lib/firebase-admin/admin.ts', to: 'firebase-admin/admin.ts', name: 'adminBarrelModule' },
  { from: 'src/lib/firebase-admin/admin-users.ts', to: 'firebase-admin/admin-users.ts', name: 'adminUsersModule' },
  {
    from: 'src/lib/firebase-admin/admin-id-token.ts',
    to: 'firebase-admin/admin-id-token.ts',
    name: 'adminIdTokenModule'
  },
  {
    from: 'src/lib/firebase-admin/god-directory.ts',
    to: 'firebase-admin/god-directory.ts',
    name: 'godDirectoryModule'
  },
  {
    from: 'src/lib/firebase-admin/account-admin-access.ts',
    to: 'firebase-admin/account-admin-access.ts',
    name: 'accountAdminAccessModule'
  },
  {
    from: 'src/lib/firebase-admin/custom-claims.test.ts',
    to: 'firebase-admin/custom-claims-test.ts',
    name: 'customClaimsTestModule'
  },
  {
    from: 'src/lib/firebase-admin/admin-core.test.ts',
    to: 'firebase-admin/admin-core-test.ts',
    name: 'adminCoreTestModule'
  },
  {
    from: 'src/lib/firebase-admin/admin-users.test.ts',
    to: 'firebase-admin/admin-users-test.ts',
    name: 'adminUsersTestModule'
  },
  { from: 'scripts/firebase/seed-claims.ts', to: 'scripts/seed-claims.ts', name: 'seedClaimsScript' }
]

/** Makes a source safe to sit inside a template literal. Order matters: backslashes first. */
const escapeForTemplate = (source: string) =>
  source.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')

const toIdentifier = (path: string) => path.replace(/[^a-zA-Z0-9]/g, '_')

async function extract(referenceRoot: string, templatesRoot: string, entry: Entry) {
  let source = await readFile(join(referenceRoot, entry.from), 'utf8')

  for (const { find, put } of entry.replace ?? []) {
    if (!source.includes(find)) throw new Error(`${entry.from}: expected to find ${find}`)
    source = source.replaceAll(find, put)
  }

  for (const { tag, text } of entry.region ?? []) {
    if (!source.includes(text)) throw new Error(`${entry.from}: expected a ${tag} region matching its reference text`)
    source = source.replace(text, `// @beast-auth:${tag}-start\n${text}\n// @beast-auth:${tag}-end`)
  }

  const escaped = escapeForTemplate(source)
    .replaceAll('@@APP_SLUG_KEY@@', "'\${options.appSlug}:accounts'")

  const upToCodegen = '../'.repeat(entry.to.split('/').length)
  const body = `import type { TemplateOptions } from '${upToCodegen}options'

/** Lifted from the reference app's \`${entry.from}\`. Re-extract with \`tools/extract-reference.ts\`. */
export const ${entry.name} = (options: TemplateOptions): string =>
  \`${escaped}\`
`

  const target = join(templatesRoot, entry.to)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, body, 'utf8')

  return { to: entry.to, name: entry.name, lines: source.split('\n').length }
}

const referenceRoot = resolve(process.argv[2] ?? '')
if (process.argv[2] === undefined) {
  console.error('Usage: bun run tools/extract-reference.ts <path-to-reference-beast-app>')
  process.exit(1)
}

const templatesRoot = resolve(import.meta.dirname, '..', 'src', 'codegen', 'templates')
const results = []
for (const entry of entries) {
  results.push(await extract(referenceRoot, templatesRoot, entry))
}

console.log(`Extracted ${results.length} templates from ${referenceRoot}:`)
for (const result of results) {
  console.log(`  ${result.to.padEnd(44)} ${String(result.lines).padStart(4)} lines  ->  ${result.name}`)
}
