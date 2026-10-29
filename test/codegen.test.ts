import { describe, expect, test } from 'bun:test'
import { buildFirebaseManifest } from '../src/codegen/manifest'
import { GENERATED_HEADER } from '../src/codegen/emit'
import type { ConsoleSpec } from '../src/context'

const ASGARD: ConsoleSpec = { label: 'asgard', claim: 'god', routePrefix: '/asgard' }

const render = (overrides: { hasConvex?: boolean; consoles?: readonly ConsoleSpec[] } = {}) =>
  buildFirebaseManifest('/app', {
    appSlug: 'my-app',
    hasConvex: overrides.hasConvex ?? true,
    consoles: overrides.consoles ?? []
  })

const find = (writes: ReturnType<typeof render>, suffix: string) => {
  const write = writes.find((candidate) => candidate.path.endsWith(suffix))
  if (!write) throw new Error(`nothing emitted at ${suffix}`)
  return write
}

describe('the manifest', () => {
  test('every emitted file carries the do-not-edit header', () => {
    for (const write of render()) {
      expect(write.contents).toStartWith(GENERATED_HEADER)
    }
  })

  test('renders the same bytes twice, which is what --check relies on', () => {
    expect(render().map((write) => write.contents)).toEqual(render().map((write) => write.contents))
  })

  test('withholds the god-tier toolkit when no console was chosen', () => {
    const paths = render({ consoles: [] }).map((write) => write.path)

    expect(paths).not.toContain('/app/src/lib/firebase-admin/god-directory.ts')
    expect(paths).not.toContain('/app/src/lib/firebase-admin/admin-id-token.ts')
  })

  test('emits the god-tier toolkit once a console exists', () => {
    const paths = render({ consoles: [ASGARD] }).map((write) => write.path)

    expect(paths).toContain('/app/src/lib/firebase-admin/god-directory.ts')
    expect(paths).toContain('/app/src/lib/firebase-admin/admin-id-token.ts')
  })

  test('always emits the client, the admin core and the claims model', () => {
    const paths = render().map((write) => write.path)

    expect(paths).toContain('/app/src/lib/firebase/index.ts')
    expect(paths).toContain('/app/src/lib/firebase/auth.ts')
    expect(paths).toContain('/app/src/lib/firebase-admin/admin-core.ts')
    expect(paths).toContain('/app/src/lib/firebase-admin/custom-claims.ts')
    expect(paths).toContain('/app/scripts/firebase/seed-claims.ts')
  })

  test('emits the co-located tests, so the app can prove the integration itself', () => {
    const paths = render().map((write) => write.path)

    expect(paths).toContain('/app/src/lib/firebase-admin/custom-claims.test.ts')
    expect(paths).toContain('/app/src/lib/firebase-admin/admin-core.test.ts')
  })
})

describe('the Convex region', () => {
  test('a Convex app keeps the identity extractor and its import', () => {
    const claims = find(render({ hasConvex: true }), 'custom-claims.ts').contents

    expect(claims).toInclude("from 'convex/server'")
    expect(claims).toInclude('getFirebaseCustomClaimsFromConvexIdentity')
  })

  test('an app without Convex gets neither, so the import cannot fail to resolve', () => {
    const claims = find(render({ hasConvex: false }), 'custom-claims.ts').contents

    expect(claims).not.toInclude("from 'convex/server'")
    expect(claims).not.toInclude('getFirebaseCustomClaimsFromConvexIdentity')
    expect(claims).not.toInclude('convexIdentityStandardClaimKeys')
  })

  test('no region marker survives into generated code either way', () => {
    for (const hasConvex of [true, false]) {
      for (const write of render({ hasConvex })) {
        expect(write.contents).not.toInclude('@beast-auth:')
      }
    }
  })
})

describe('app-specific values', () => {
  test('the remembered-accounts key is namespaced to this app, not the reference', () => {
    const accounts = find(render(), 'firebase/accounts.ts').contents

    expect(accounts).toInclude("'my-app:accounts'")
    expect(accounts).not.toInclude('lucky-pick')
  })

  test('no generated file mentions the reference app', () => {
    for (const write of render({ consoles: [ASGARD] })) {
      expect(write.contents).not.toInclude('lucky-pick')
    }
  })
})

describe('house style of the generated code', () => {
  const isCode = (path: string) => path.endsWith('.ts')

  test('no statement ends in a semicolon', () => {
    for (const write of render({ consoles: [ASGARD] })) {
      if (!isCode(write.path)) continue
      const offenders = write.contents
        .split('\n')
        .filter((line) => /;\s*$/.test(line) && !line.trimStart().startsWith('*'))

      expect(offenders).toEqual([])
    }
  })

  test('indentation is spaces, never tabs', () => {
    for (const write of render({ consoles: [ASGARD] })) {
      expect(write.contents).not.toInclude('\t')
    }
  })
})
