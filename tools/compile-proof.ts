/**
 * Generates a full run into a throwaway directory and type-checks it against the
 * reference app's real dependencies.
 *
 * Snapshots prove the output has not changed; only a compiler proves it is valid
 * TypeScript against the actual `firebase`, `firebase-admin`, `octane` and
 * `convex` types. Nothing in the reference app is written to — its
 * `node_modules` is symlinked in read-only.
 *
 *   bun run tools/compile-proof.ts ~/Code/lucky-pick
 */
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { emitAll } from '../src/codegen/emit'
import { buildFirebaseManifest } from '../src/codegen/manifest'

const reference = resolve(process.argv[2] ?? '')
if (process.argv[2] === undefined) {
  console.error('Usage: bun run tools/compile-proof.ts <path-to-reference-beast-app>')
  process.exit(1)
}

const root = await mkdtemp(join(tmpdir(), 'beast-auth-compile-'))

await symlink(join(reference, 'node_modules'), join(root, 'node_modules'), 'dir')

await writeFile(
  join(root, 'tsconfig.json'),
  JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2023',
        lib: ['ES2023', 'DOM'],
        module: 'ESNext',
        moduleResolution: 'Bundler',
        types: ['node', 'bun'],
        strict: true,
        skipLibCheck: true,
        noEmit: true,
        jsx: 'preserve',
        baseUrl: '.',
        paths: { '@/*': ['./src/*'] }
      },
      include: ['src', 'scripts']
    },
    null,
    2
  )
)

// The env-types step is not built yet, so the keys the client reads are declared
// here. A real run will own this file.
const envTypes = `interface ImportMetaEnv {
  readonly DEV?: boolean
  readonly PUBLIC_FIREBASE_API_KEY?: string
  readonly PUBLIC_FIREBASE_AUTH_DOMAIN?: string
  readonly PUBLIC_FIREBASE_PROJECT_ID?: string
  readonly PUBLIC_FIREBASE_STORAGE_BUCKET?: string
  readonly PUBLIC_FIREBASE_MESSAGING_SENDER_ID?: string
  readonly PUBLIC_FIREBASE_APP_ID?: string
  readonly PUBLIC_FIREBASE_MEASUREMENT_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
`

const writes = [
  ...buildFirebaseManifest(root, {
    appSlug: 'compile-proof',
    hasConvex: !process.argv.includes('--no-convex'),
    consoles: process.argv.includes('--no-consoles')
      ? []
      : [{ label: 'asgard', claim: 'god', routePrefix: '/asgard' }]
  }),
  { path: join(root, 'src', 'env.d.ts'), contents: envTypes }
]

await emitAll(writes)
console.log(`Generated ${writes.length} files into ${root}`)

const result = Bun.spawnSync(['bunx', 'tsc', '--noEmit'], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
const output = `${result.stdout.toString()}${result.stderr.toString()}`.trim()

if (result.exitCode === 0) {
  console.log('\n✓ The generated code type-checks against the reference app’s real dependencies.')
  await rm(root, { recursive: true, force: true })
} else {
  console.log(`\n✗ tsc exited ${result.exitCode}:\n${output}`)
  console.log(`\nLeft in place for inspection: ${root}`)
}

process.exitCode = result.exitCode ?? 1
