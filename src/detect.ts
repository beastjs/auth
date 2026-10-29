import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { DetectedApp, ExternalTools } from './context'
import type { CommandRunner } from './exec'

type PackageJson = {
  name?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

async function readPackageJson(root: string): Promise<PackageJson | null> {
  try {
    return JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as PackageJson
  } catch {
    return null
  }
}

const hasDependency = (pkg: PackageJson, name: string) =>
  Boolean(pkg.dependencies?.[name] ?? pkg.devDependencies?.[name])

const firstExisting = (root: string, candidates: readonly string[]) =>
  candidates.map((candidate) => join(root, candidate)).find((path) => existsSync(path)) ?? null

/**
 * Finds the module that chooses a route tree.
 *
 * There is no convention for its name — lucky-pick calls it
 * `analytics-router.ts` — so the file is identified by what it does: it builds a
 * router from `@octanejs/tanstack-router`. Guessing a filename would silently
 * edit the wrong file, so a miss returns null and the caller degrades to
 * printing the lines to paste.
 */
async function findRouterPath(root: string): Promise<string | null> {
  const libDirectory = join(root, 'src', 'lib')

  let entries: string[]
  try {
    entries = await readdir(libDirectory)
  } catch {
    return null
  }

  const candidates = entries.filter((entry) => entry.endsWith('.ts') && entry.includes('router'))

  for (const candidate of candidates) {
    const path = join(libDirectory, candidate)
    const source = await readFile(path, 'utf8')
    if (source.includes('@octanejs/tanstack-router') && source.includes('createRouter')) {
      return path
    }
  }

  return null
}

export async function detectApp(root: string): Promise<DetectedApp> {
  const pkg = (await readPackageJson(root)) ?? {}
  const iconLibrary = firstExisting(root, ['src/lib/icons/index.ts', 'src/lib/icons/icons.ts'])

  return {
    root,
    // The slug seeds cookie names and the localStorage key, so it has to be
    // stable and DNS/cookie-safe rather than the raw package name.
    appSlug: toAppSlug(pkg.name ?? 'app'),
    hasRsbuildConfig: Boolean(firstExisting(root, ['rsbuild.config.ts', 'rsbuild.config.js'])),
    hasBeastTsrx: hasDependency(pkg, 'beast-tsrx'),
    hasConvex: existsSync(join(root, 'convex')) && hasDependency(pkg, 'convex'),
    hasWranglerConfig: Boolean(firstExisting(root, ['wrangler.jsonc', 'wrangler.json', 'wrangler.toml'])),
    hasResizablePanels: hasDependency(pkg, '@octanejs/resizable-panels'),
    hasIconLibrary: iconLibrary !== null,
    routerPath: await findRouterPath(root),
    workerPath: firstExisting(root, ['src/worker.ts', 'src/worker.tsx']),
    envTypesPath: firstExisting(root, ['src/env.d.ts']),
    packageManager: existsSync(join(root, 'bun.lock')) || existsSync(join(root, 'bun.lockb')) ? 'bun' : 'npm'
  }
}

/**
 * Normalises a package name into a slug fit for a cookie name and a storage key.
 *
 * A scoped name (`@acme/web`) loses its scope rather than its leaf, because the
 * leaf is what distinguishes one app's cookie from another's on a shared domain.
 */
export function toAppSlug(packageName: string): string {
  const withoutScope = packageName.replace(/^@[^/]+\//, '')
  const slug = withoutScope
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug.length > 0 ? slug : 'app'
}

export async function detectTools(runner: CommandRunner): Promise<ExternalTools> {
  const [firebase, gcloud, bun, wrangler] = await Promise.all([
    runner.which('firebase'),
    runner.which('gcloud'),
    runner.which('bun'),
    runner.which('wrangler')
  ])

  return { firebase, gcloud, bun, wrangler }
}

export type BlockingProblem = {
  readonly reason: string
  readonly remedy: string
}

/**
 * The reasons this CLI will not touch a directory.
 *
 * It integrates into an app that already exists and never scaffolds one, so an
 * app that is not a beast app is a refusal rather than an invitation — and the
 * refusal names the one thing that was missing.
 */
export function findBlockingProblems(app: DetectedApp, tools: ExternalTools): readonly BlockingProblem[] {
  const problems: BlockingProblem[] = []

  if (!app.hasRsbuildConfig && !app.hasBeastTsrx) {
    problems.push({
      reason: 'This directory does not look like a beast app.',
      remedy: 'Run it from an app with an rsbuild.config.ts and beast-tsrx in its package.json.'
    })
  } else if (!app.hasBeastTsrx) {
    problems.push({
      reason: 'beast-tsrx is not a dependency of this app.',
      remedy: 'Add beast-tsrx, or run this from the app you meant.'
    })
  } else if (!app.hasRsbuildConfig) {
    problems.push({
      reason: 'No rsbuild.config.ts was found.',
      remedy: 'This generates rsbuild-flavoured env access (import.meta.env.PUBLIC_*); set up rsbuild first.'
    })
  }

  if (tools.firebase === null) {
    problems.push({
      reason: 'The firebase CLI is not on PATH.',
      remedy: 'Install it with `bun add -g firebase-tools`, then run `firebase login`.'
    })
  }

  return problems
}
