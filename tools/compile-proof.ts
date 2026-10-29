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
import { editEnvTypes, editPackageJson, editRouter, editWorker, editWranglerConfig } from '../src/edits/app-edits'
import { buildConsoleManifest } from '../src/codegen/console-manifest'
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
      // `.btsx` is the beast compiler's business, not tsc's; it is reached
      // through the `*.btsx` module declaration instead.
      include: ['src/**/*.ts', 'src/env.d.ts', 'scripts']
    },
    null,
    2
  )
)

// The env-types step is not built yet, so the keys the client reads are declared
// here. A real run will own this file.
const consoles = process.argv.includes('--no-consoles')
  ? []
  : [
      { label: 'asgard', claim: 'god' as const, routePrefix: '/asgard' },
      { label: 'admin', claim: 'admin' as const, routePrefix: '/admin' }
    ]

const options = {
  appSlug: 'compile-proof',
  hasConvex: !process.argv.includes('--no-convex'),
  rootDomain: 'example.com',
  consoles
}

const envTypes = `declare module '*.btsx' {
  import type { ComponentBody } from 'octane'

  const component: ComponentBody
  export default component
}

interface ImportMetaEnv {
  readonly DEV?: boolean
  readonly PUBLIC_FIREBASE_API_KEY?: string
  readonly PUBLIC_FIREBASE_AUTH_DOMAIN?: string
  readonly PUBLIC_FIREBASE_PROJECT_ID?: string
  readonly PUBLIC_FIREBASE_STORAGE_BUCKET?: string
  readonly PUBLIC_FIREBASE_MESSAGING_SENDER_ID?: string
  readonly PUBLIC_FIREBASE_APP_ID?: string
  readonly PUBLIC_FIREBASE_MEASUREMENT_ID?: string
${consoles.map((console_) => `  readonly PUBLIC_${console_.label.toUpperCase()}_OPEN?: string`).join('\n')}
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
`

const writes = [
  ...buildFirebaseManifest(root, options),
  ...buildConsoleManifest(root, options),
  { path: join(root, 'src', 'env.d.ts'), contents: envTypes }
]

// A fresh beast app's own files, so the surgical edits have something real to
// change and the result can be compiled as a whole.
const appFiles = [
  {
    path: join(root, 'src', 'worker.ts'),
    contents: `interface WorkerEnvironment {
  ASSETS: {
    fetch(request: Request): Promise<Response>
  }
}

const isSpaNavigation = (request: Request) =>
  request.method === 'GET' && request.headers.get('accept')?.includes('text/html')

export default {
  async fetch(request: Request, env: WorkerEnvironment): Promise<Response> {
    const response = await env.ASSETS.fetch(request)
    if (response.status !== 404 || !isSpaNavigation(request)) return response

    return env.ASSETS.fetch(new Request(new URL('/', request.url).toString(), request))
  }
}
`
  },
  {
    path: join(root, 'src', 'lib', 'app-router.ts'),
    contents: `import { createRootRoute, createRoute, createRouter } from '@octanejs/tanstack-router'
import AppRoot from '@/pages/AppRoot.btsx'

function createAppRouteTree() {
  const rootRoute = createRootRoute({ component: AppRoot })

  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/'
  })

  return rootRoute.addChildren([homeRoute])
}

const routeTree = createAppRouteTree()

export const appRouter = createRouter({ routeTree, scrollRestoration: true })

declare module '@tanstack/router-core' {
  interface Register {
    router: typeof appRouter
  }
}
`
  },
  { path: join(root, 'src', 'pages', 'AppRoot.btsx'), contents: 'main\n  p Hello\n' },
  { path: join(root, 'wrangler.jsonc'), contents: '{\n  // the Worker\n  "compatibility_date": "2026-09-20"\n}\n' },
  { path: join(root, 'package.json'), contents: '{\n  "name": "compile-proof",\n  "type": "module",\n  "scripts": {}\n}\n' }
]

await emitAll([...writes, ...appFiles])

// Apply the surgical edits exactly as a real run would, twice, to prove both
// that they land and that the second pass is a no-op.
const editTargets = [
  { path: join(root, 'src', 'worker.ts'), apply: editWorker },
  { path: join(root, 'src', 'lib', 'app-router.ts'), apply: editRouter },
  { path: join(root, 'src', 'env.d.ts'), apply: editEnvTypes },
  { path: join(root, 'wrangler.jsonc'), apply: (source: string) => editWranglerConfig(source) },
  { path: join(root, 'package.json'), apply: (source: string) => editPackageJson(source) }
]

let editFailures = 0

for (const target of editTargets) {
  const first = target.apply(await Bun.file(target.path).text(), options)

  if (first.kind === 'blocked') {
    editFailures += 1
    console.log(`\u2717 edit blocked on ${target.path}: ${first.reason}`)
    continue
  }

  if (first.kind === 'written') await writeFile(target.path, first.contents)

  const second = target.apply(await Bun.file(target.path).text(), options)

  if (second.kind !== 'unchanged') {
    editFailures += 1
    console.log(`\u2717 edit is not idempotent on ${target.path} (second pass: ${second.kind})`)
  }
}

if (editFailures === 0) console.log(`\u2713 All ${editTargets.length} surgical edits applied and are idempotent.`)

const typescriptFiles = writes.filter((write) => write.path.endsWith('.ts')).length
console.log(`Generated ${writes.length} files into ${root} (${typescriptFiles} TypeScript)`)
const result = Bun.spawnSync(['bunx', 'tsc', '--noEmit'], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
const output = `${result.stdout.toString()}${result.stderr.toString()}`.trim()

if (result.exitCode === 0) {
  console.log('\u2713 TypeScript type-checks against the reference app\u2019s real dependencies.')
} else {
  console.log(`\u2717 tsc exited ${result.exitCode}:\n${output}`)
}

/**
 * `.btsx` is indentation-sensitive and emitted as text, so a template bug there
 * is a compiler error that tsc cannot see at all. The real beast compiler is the
 * only thing that can say these pages are valid.
 */
const pages = writes.filter((write) => write.path.endsWith('.btsx'))
let pageFailures = 0

for (const page of pages) {
  const compiled = Bun.spawnSync(['bunx', 'beast', 'compile', page.path, '--output', `${page.path}.tsrx`], {
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe'
  })

  if (compiled.exitCode !== 0) {
    pageFailures += 1
    console.log(`\u2717 beast compile failed for ${page.path}:`)
    console.log(`${compiled.stdout.toString()}${compiled.stderr.toString()}`.trim())
  }
}

if (pages.length > 0 && pageFailures === 0) {
  console.log(`\u2713 All ${pages.length} .btsx pages compile with the beast compiler.`)
}

const failed = result.exitCode !== 0 || pageFailures > 0 || editFailures > 0

if (failed) console.log(`\nLeft in place for inspection: ${root}`)
else await rm(root, { recursive: true, force: true })

process.exitCode = failed ? 1 : 0
