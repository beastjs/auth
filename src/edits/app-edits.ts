import {
  applyBlock,
  endMarker,
  findBracedBody,
  hasBlock,
  insertAfterLastImport,
  insertAtEndOfBody,
  insertAtTopOfBody,
  startMarker,
  type EditOutcome
} from './anchored'
import { deriveAll } from '../codegen/derive'
import type { TemplateOptions } from '../codegen/options'

const blocked = (reason: string, snippet: readonly string[]): EditOutcome => ({ kind: 'blocked', reason, snippet })

/**
 * Drops any line declaring a name the file already declares outside our block.
 *
 * A duplicate member of an interface is a type error, and the reference app
 * already declares several of these by hand.
 */
function withoutAlreadyDeclared(source: string, lines: readonly string[], blockId: string): readonly string[] {
  const ownBlock = new RegExp(`${startMarker(blockId)}[\\s\\S]*?${endMarker(blockId)}`)
  const outside = source.replace(ownBlock, '')

  return lines.filter((line) => {
    const name = /\b([A-Z][A-Z0-9_]*)\s*\?*\s*:/.exec(line)?.[1]
    if (name === undefined) return true

    return !new RegExp(`\\b${name}\\s*\\?*\\s*:`).test(outside)
  })
}

/**
 * Adds the console API dispatch to the app's Worker.
 *
 * Three small blocks rather than a dispatch table, because the table itself is
 * generated into `src/server/console-routes.ts` — so this edit does not grow
 * when a console is added.
 */
export function editWorker(source: string, options: TemplateOptions): EditOutcome {
  const consoles = deriveAll(options.consoles, options.appSlug)
  if (consoles.length === 0) return { kind: 'unchanged' }

  let contents = source

  const importOutcome = applyBlock(
    contents,
    {
      id: 'worker-import',
      lines: ["import { dispatchConsoleRequest } from './server/console-routes'"]
    },
    insertAfterLastImport,
    'This Worker has no top-level imports to add to.'
  )

  if (importOutcome.kind === 'blocked') return importOutcome
  if (importOutcome.kind === 'written') contents = importOutcome.contents

  const dispatchOutcome = applyBlock(
    contents,
    {
      id: 'worker-dispatch',
      lines: [
        '// Console API routes answer before the asset fallback. An asset handler',
        '// that answers first turns every one of them into the SPA shell, and a',
        '// console given a page where it expects a session fails in a way that',
        '// looks nothing like its cause.',
        'const consoleResponse = await dispatchConsoleRequest(request)',
        'if (consoleResponse) return consoleResponse'
      ]
    },
    (current, block) => insertAtTopOfBody(current, /async\s+fetch\s*\(/, block),
    'Could not find an `async fetch(` handler in this Worker.'
  )

  if (dispatchOutcome.kind === 'blocked') return dispatchOutcome
  if (dispatchOutcome.kind === 'written') contents = dispatchOutcome.contents

  const envLines = withoutAlreadyDeclared(
    contents,
    [
      'FIREBASE_PROJECT_ID?: string',
      'FIREBASE_CLIENT_EMAIL?: string',
      'FIREBASE_PRIVATE_KEY?: string',
      'FIREBASE_PRIVATE_KEY_ID?: string',
      'FIREBASE_SERVICE_ACCOUNT_KEY?: string',
      '// Read server-side to trade a custom token for a real ID token.',
      'PUBLIC_FIREBASE_API_KEY?: string'
    ],
    'worker-env'
  )

  const envOutcome = envLines.length === 0 ? ({ kind: 'unchanged' } as const) : applyBlock(
    contents,
    { id: 'worker-env', lines: envLines },
    (current, block) => insertAtEndOfBody(current, /(?:interface|type)\s+\w*Env\w*\s*(?:=\s*)?\{/, block),
    'Could not find the Worker environment interface to add the Firebase variables to.'
  )

  if (envOutcome.kind === 'blocked') return envOutcome
  if (envOutcome.kind === 'written') contents = envOutcome.contents

  const ordering = assertDispatchPrecedesAssets(contents)
  if (ordering !== null) return blocked(ordering, [])

  return contents === source ? { kind: 'unchanged' } : { kind: 'written', contents }
}

/**
 * The one assertion worth more than all the others here.
 *
 * A Worker whose console routes sit after `ASSETS.fetch` serves the SPA shell
 * from every console endpoint, and the symptom — a console that cannot read its
 * own session — points nowhere near the cause.
 */
export function assertDispatchPrecedesAssets(source: string): string | null {
  const dispatch = source.indexOf('dispatchConsoleRequest(request)')
  const assets = source.search(/ASSETS\s*\.\s*fetch|env\.ASSETS/)

  if (dispatch === -1 || assets === -1) return null
  if (dispatch < assets) return null

  return 'The console dispatch would run after the static asset fallback, which would shadow every console API route.'
}

const FALLBACK_SPREAD = '...createConsoleFallbackRoutes(rootRoute)'
const TREE_SELECTION = 'selectConsoleRouteTree() ?? routeTree'

/**
 * Wires the console route trees into the app's own router.
 *
 * Two narrow textual changes, not a rewrite: the host check and every tree
 * factory live in the generated `route-trees.ts`, so what the app's router needs
 * is an import, one `??`, and one spread.
 */
export function editRouter(source: string, options: TemplateOptions): EditOutcome {
  if (options.consoles.length === 0) return { kind: 'unchanged' }

  let contents = source

  if (!hasBlock(contents, 'router-import') && !contents.includes('selectConsoleRouteTree')) {
    const withImport = insertAfterLastImport(contents, {
      id: 'router-import',
      lines: ["import { createConsoleFallbackRoutes, selectConsoleRouteTree } from '@/lib/consoles/route-trees'"]
    })

    if (withImport === null) {
      return blocked('This router has no top-level imports to add to.', [
        "import { createConsoleFallbackRoutes, selectConsoleRouteTree } from '@/lib/consoles/route-trees'"
      ])
    }

    contents = withImport
  }

  // The host picks a console tree, or the app's own tree stands.
  if (!contents.includes(TREE_SELECTION)) {
    const createRouterCalls = contents.match(/createRouter\(\s*\{\s*routeTree\b/g) ?? []

    if (createRouterCalls.length !== 1) {
      return blocked(
        createRouterCalls.length === 0
          ? 'Could not find a `createRouter({ routeTree ... })` call in this router.'
          : 'This router creates more than one router, so which one owns the consoles is not clear.',
        [`createRouter({ routeTree: ${TREE_SELECTION}, ... })`]
      )
    }

    contents = contents.replace(/createRouter\(\s*\{\s*routeTree\b/, `createRouter({ routeTree: ${TREE_SELECTION}`)
  }

  // Each console also mounted as a path, for hosts that cannot carry a subdomain.
  if (!contents.includes(FALLBACK_SPREAD)) {
    const addChildrenCalls = contents.match(/rootRoute\s*\.\s*addChildren\s*\(\s*\[/g) ?? []

    if (addChildrenCalls.length !== 1) {
      return blocked(
        addChildrenCalls.length === 0
          ? 'Could not find a `rootRoute.addChildren([ ... ])` call to mount the console fallback paths in.'
          : 'This router calls `rootRoute.addChildren` more than once, so where the fallback paths belong is not clear.',
        [`rootRoute.addChildren([..., ${FALLBACK_SPREAD}])`]
      )
    }

    const array = findBracedBody(contents, /rootRoute\s*\.\s*addChildren\s*\(\s*\[/, '[', ']')

    if (array === null) {
      return blocked('Could not read the route array to mount the console fallback paths in.', [
        `rootRoute.addChildren([..., ${FALLBACK_SPREAD}])`
      ])
    }

    // Appended last, so the app's own routes still read first.
    const existing = contents.slice(array.open + 1, array.close)
    const multiline = existing.includes('\n')
    const indent = multiline ? (/\n([ \t]*)/.exec(existing)?.[1] ?? '    ') : ''
    const separator = existing.trim().length === 0 ? '' : ','
    const addition = multiline
      ? `${separator}\n${indent}${FALLBACK_SPREAD}\n`
      : `${separator} ${FALLBACK_SPREAD}`

    contents = `${contents.slice(0, array.close)}${addition}${contents.slice(array.close)}`
  }

  return contents === source ? { kind: 'unchanged' } : { kind: 'written', contents }
}

/** Declares the env keys the generated client reads through `import.meta.env`. */
export function editEnvTypes(source: string, options: TemplateOptions): EditOutcome {
  const consoles = deriveAll(options.consoles, options.appSlug)

  const lines = [
    'readonly PUBLIC_FIREBASE_API_KEY?: string',
    'readonly PUBLIC_FIREBASE_AUTH_DOMAIN?: string',
    'readonly PUBLIC_FIREBASE_PROJECT_ID?: string',
    'readonly PUBLIC_FIREBASE_STORAGE_BUCKET?: string',
    'readonly PUBLIC_FIREBASE_MESSAGING_SENDER_ID?: string',
    'readonly PUBLIC_FIREBASE_APP_ID?: string',
    'readonly PUBLIC_FIREBASE_MEASUREMENT_ID?: string',
    ...consoles.map((console_) => `readonly PUBLIC_${console_.upper}_OPEN?: string`)
  ]

  const wanted = withoutAlreadyDeclared(source, lines, 'env-types')

  if (wanted.length === 0) return { kind: 'unchanged' }

  return applyBlock(
    source,
    { id: 'env-types', lines: wanted },
    (current, block) => insertAtEndOfBody(current, /interface\s+ImportMetaEnv\s*\{/, block),
    'Could not find an `interface ImportMetaEnv` to declare the Firebase variables in.'
  )
}

/**
 * Ensures the Worker runs with the Node built-ins `firebase-admin` needs.
 *
 * Edited as text so the file's comments survive — in a JSONC file those are the
 * house style's most load-bearing feature, and `JSON.parse` would strip them.
 */
export function editWranglerConfig(source: string): EditOutcome {
  if (source.includes('nodejs_compat')) return { kind: 'unchanged' }

  const flagsMatch = /"compatibility_flags"\s*:\s*\[/.exec(source)

  if (flagsMatch !== null) {
    const insertAt = flagsMatch.index + flagsMatch[0].length
    const rest = source.slice(insertAt).trimStart()
    const separator = rest.startsWith(']') ? '' : ','

    return {
      kind: 'written',
      contents: `${source.slice(0, insertAt)}"nodejs_compat"${separator}${source.slice(insertAt)}`
    }
  }

  const dateMatch = /"compatibility_date"\s*:\s*"[^"]*",?/.exec(source)

  if (dateMatch === null) {
    return blocked('Could not find where to add `nodejs_compat` in the Wrangler config.', [
      '"compatibility_flags": ["nodejs_compat"]'
    ])
  }

  const insertAt = dateMatch.index + dateMatch[0].length
  const comma = dateMatch[0].endsWith(',') ? '' : ','

  return {
    kind: 'written',
    contents: `${source.slice(0, insertAt)}${comma}
  // \`firebase-admin\` runs in the Worker, which needs the Node built-ins.
  "compatibility_flags": ["nodejs_compat"],${source.slice(insertAt)}`
  }
}

/** Adds the claims script, without touching dependencies — Bun owns those. */
export function editPackageJson(source: string): EditOutcome {
  let parsed: { scripts?: Record<string, string> }

  try {
    parsed = JSON.parse(source) as { scripts?: Record<string, string> }
  } catch {
    return blocked('This package.json could not be parsed.', [])
  }

  const wanted = {
    'fb:claims': 'bun run scripts/firebase/seed-claims.ts',
    'fb:check': 'bunx @beastjs/auth --check'
  }

  const scripts = parsed.scripts ?? {}
  const missing = Object.entries(wanted).filter(([name]) => scripts[name] === undefined)

  if (missing.length === 0) return { kind: 'unchanged' }

  parsed.scripts = { ...scripts, ...Object.fromEntries(missing) }

  // Keep the file's own indentation rather than imposing two spaces.
  const indent = /\n(\s+)"/.exec(source)?.[1] ?? '  '

  return { kind: 'written', contents: `${JSON.stringify(parsed, null, indent)}\n` }
}
