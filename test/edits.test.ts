import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { TemplateOptions } from '../src/codegen/options'
import {
  assertDispatchPrecedesAssets,
  editEnvTypes,
  editPackageJson,
  editRouter,
  editWorker,
  editWranglerConfig
} from '../src/edits/app-edits'
import type { EditOutcome } from '../src/edits/anchored'

const FIXTURES = join(import.meta.dirname, 'fixtures', 'edits')

const FALLBACK = '...createConsoleFallbackRoutes(rootRoute)'

const read = (name: string) => readFile(join(FIXTURES, name), 'utf8')

const OPTIONS: TemplateOptions = {
  appSlug: 'lucky-pick',
  hasConvex: true,
  rootDomain: 'luckypick.com',
  consoles: [
    { label: 'asgard', claim: 'god', routePrefix: '/asgard' },
    { label: 'admin', claim: 'admin', routePrefix: '/admin' }
  ]
}

const written = (outcome: EditOutcome): string => {
  if (outcome.kind !== 'written') throw new Error(`expected a write, got ${outcome.kind}`)
  return outcome.contents
}

describe('the Worker edit', () => {
  test('adds the import, the dispatch and the env fields', async () => {
    const result = written(editWorker(await read('worker.reference.ts'), OPTIONS))

    expect(result).toInclude("import { dispatchConsoleRequest } from './server/console-routes'")
    expect(result).toInclude('const consoleResponse = await dispatchConsoleRequest(request)')
    expect(result).toInclude('FIREBASE_PRIVATE_KEY?: string')
    expect(result).toInclude('PUBLIC_FIREBASE_API_KEY?: string')
  })

  test('puts the dispatch before the asset fallback', async () => {
    const result = written(editWorker(await read('worker.reference.ts'), OPTIONS))

    expect(result.indexOf('dispatchConsoleRequest(request)')).toBeLessThan(result.search(/ASSETS\s*\.\s*fetch/))
  })

  test('is idempotent: a second pass changes nothing', async () => {
    const once = written(editWorker(await read('worker.reference.ts'), OPTIONS))

    expect(editWorker(once, OPTIONS).kind).toBe('unchanged')
  })

  test('keeps the original comments, which are the house style', async () => {
    const source = await read('worker.reference.ts')
    const result = written(editWorker(source, OPTIONS))

    expect(result).toInclude('Anything that is not an API route is the built client')
  })

  test('does nothing when no console was chosen', async () => {
    const outcome = editWorker(await read('worker.reference.ts'), { ...OPTIONS, consoles: [] })

    expect(outcome.kind).toBe('unchanged')
  })

  test('still lands before the asset fetch in a Worker that starts with one', async () => {
    const result = written(editWorker(await read('worker.assets-first.ts'), OPTIONS))

    expect(result.indexOf('dispatchConsoleRequest(request)')).toBeLessThan(result.search(/env\.ASSETS/))
  })
})

describe('assertDispatchPrecedesAssets', () => {
  test('says nothing when the order is right', () => {
    expect(
      assertDispatchPrecedesAssets('await dispatchConsoleRequest(request)\nreturn env.ASSETS.fetch(request)')
    ).toBeNull()
  })

  test('complains when the order is wrong', () => {
    expect(
      assertDispatchPrecedesAssets('return env.ASSETS.fetch(request)\nawait dispatchConsoleRequest(request)')
    ).toInclude('shadow')
  })

  test('says nothing about a Worker that has neither', () => {
    expect(assertDispatchPrecedesAssets('export default {}')).toBeNull()
  })
})

describe('the router edit', () => {
  test('adds the import, the tree selection and the fallback routes', async () => {
    const result = written(editRouter(await read('router.fresh.ts'), OPTIONS))

    expect(result).toInclude("from '@/lib/consoles/route-trees'")
    expect(result).toInclude('createRouter({ routeTree: selectConsoleRouteTree() ?? routeTree')
    expect(result).toInclude('...createConsoleFallbackRoutes(rootRoute)')
  })

  test('is idempotent', async () => {
    const once = written(editRouter(await read('router.fresh.ts'), OPTIONS))

    expect(editRouter(once, OPTIONS).kind).toBe('unchanged')
  })

  test('leaves the app’s own routes alone, and mounts the consoles last', async () => {
    const result = written(editRouter(await read('router.fresh.ts'), OPTIONS))

    expect(result).toInclude('createAppRouteTree()')
    expect(result).toInclude('component: HomeRoute')
    // The app's own routes resolve before the console fallbacks.
    expect(result.indexOf('homeRoute')).toBeLessThan(result.indexOf(FALLBACK))
  })

  test('refuses a router that already builds several trees of its own', async () => {
    // The reference app already has both consoles, so three `addChildren` calls:
    // which one the fallback paths belong in is genuinely not knowable.
    const outcome = editRouter(await read('router.reference.ts'), OPTIONS)

    expect(outcome.kind).toBe('blocked')
    if (outcome.kind === 'blocked') expect(outcome.reason).toInclude('more than once')
  })

  test('refuses an ambiguous router rather than guessing', async () => {
    const outcome = editRouter(await read('router.two-routers.ts'), OPTIONS)

    expect(outcome.kind).toBe('blocked')
    if (outcome.kind === 'blocked') {
      expect(outcome.reason).toInclude('more than one router')
      // A refusal still hands over the line to paste.
      expect(outcome.snippet.join('')).toInclude('selectConsoleRouteTree')
    }
  })
})

describe('the env types edit', () => {
  test('declares every key the client reads, consoles included', async () => {
    const result = written(editEnvTypes(await read('env.reference.d.ts'), OPTIONS))

    expect(result).toInclude('readonly PUBLIC_FIREBASE_API_KEY?: string')
    expect(result).toInclude('readonly PUBLIC_ASGARD_OPEN?: string')
    expect(result).toInclude('readonly PUBLIC_ADMIN_OPEN?: string')
  })

  test('keeps the .btsx module declaration', async () => {
    const result = written(editEnvTypes(await read('env.reference.d.ts'), OPTIONS))

    expect(result).toInclude("declare module '*.btsx'")
  })

  test('is idempotent', async () => {
    const once = written(editEnvTypes(await read('env.reference.d.ts'), OPTIONS))

    expect(editEnvTypes(once, OPTIONS).kind).toBe('unchanged')
  })
})

describe('the wrangler edit', () => {
  test('leaves a config that already has nodejs_compat alone', async () => {
    expect(editWranglerConfig(await read('wrangler.reference.jsonc')).kind).toBe('unchanged')
  })

  test('adds the flag to an existing list, keeping the comments', () => {
    const source = `{
  // why this date
  "compatibility_date": "2026-09-20",
  "compatibility_flags": ["something_else"]
}`
    const result = written(editWranglerConfig(source))

    expect(result).toInclude('"nodejs_compat"')
    expect(result).toInclude('"something_else"')
    expect(result).toInclude('// why this date')
  })

  test('creates the list when there is none', () => {
    const result = written(editWranglerConfig('{\n  "compatibility_date": "2026-09-20"\n}'))

    expect(result).toInclude('"compatibility_flags": ["nodejs_compat"]')
  })
})

describe('the package.json edit', () => {
  test('adds the scripts and keeps the rest', () => {
    const result = written(editPackageJson('{\n  "name": "app",\n  "scripts": { "dev": "rsbuild dev" }\n}'))
    const parsed = JSON.parse(result) as { name: string; scripts: Record<string, string> }

    expect(parsed.name).toBe('app')
    expect(parsed.scripts.dev).toBe('rsbuild dev')
    expect(parsed.scripts['fb:claims']).toBe('bun run scripts/firebase/seed-claims.ts')
  })

  test('is idempotent', () => {
    const once = written(editPackageJson('{\n  "name": "app",\n  "scripts": {}\n}'))

    expect(editPackageJson(once).kind).toBe('unchanged')
  })

  test('never touches dependencies — the package manager owns those', () => {
    const source = '{\n  "name": "app",\n  "dependencies": { "firebase": "^12.0.0" },\n  "scripts": {}\n}'
    const parsed = JSON.parse(written(editPackageJson(source))) as { dependencies: Record<string, string> }

    expect(parsed.dependencies).toEqual({ firebase: '^12.0.0' })
  })
})
