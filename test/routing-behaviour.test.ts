import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'
import type { TemplateOptions } from '../src/codegen/options'
import { renderRoutingModules } from './support/render-modules'

const OPTIONS: TemplateOptions = {
  appSlug: 'lucky-pick',
  hasConvex: true,
  rootDomain: 'luckypick.com',
  consoles: [
    { label: 'asgard', claim: 'god', routePrefix: '/asgard' },
    { label: 'admin', claim: 'admin', routePrefix: '/admin' }
  ]
}

const WORKERS_DEV = 'lucky-pick.phtn458.workers.dev'

let rendered: Awaited<ReturnType<typeof renderRoutingModules>>
let asgard: Record<string, (...args: never[]) => unknown>
let admin: Record<string, (...args: never[]) => unknown>

const call = <T>(module: Record<string, (...args: never[]) => unknown>, name: string, ...args: unknown[]): T =>
  (module[name] as (...a: unknown[]) => T)(...args)

beforeAll(async () => {
  rendered = await renderRoutingModules(OPTIONS)
  asgard = await rendered.console('asgard')
  admin = await rendered.console('admin')
})

afterAll(async () => {
  await rm(rendered.root, { recursive: true, force: true })
})

describe('host detection', () => {
  test('each console recognises only its own subdomain', () => {
    expect(call(asgard, 'isAsgardSubdomainHostname', 'asgard.luckypick.com')).toBe(true)
    expect(call(admin, 'isAdminSubdomainHostname', 'asgard.luckypick.com')).toBe(false)
    expect(call(admin, 'isAdminSubdomainHostname', 'admin.luckypick.com')).toBe(true)
  })

  test('a trailing dot and odd casing do not make a different host', () => {
    expect(call(admin, 'isAdminSubdomainHostname', 'ADMIN.LuckyPick.com.')).toBe(true)
  })

  test('the app root is found from either console host', () => {
    expect(call(rendered.host, 'getAppRootHostname', 'asgard.luckypick.com')).toBe('luckypick.com')
    expect(call(rendered.host, 'getAppRootHostname', 'admin.luckypick.com')).toBe('luckypick.com')
  })
})

describe('where a console can have its own subdomain', () => {
  test('a real domain can', () => {
    expect(call(admin, 'supportsAdminSubdomain', 'luckypick.com')).toBe(true)
  })

  test('*.workers.dev cannot — the wildcard certificate is single-label', () => {
    expect(call(asgard, 'supportsAsgardSubdomain', WORKERS_DEV)).toBe(false)
  })

  test('and that holds for EVERY console, which the reference got wrong', () => {
    // `admin-subdomain.ts` in the reference never learned about workers.dev, so
    // it would hand out a TLS-failing `admin.<worker>.<account>.workers.dev`.
    expect(call(admin, 'supportsAdminSubdomain', WORKERS_DEV)).toBe(false)
  })

  test('a bare IP cannot', () => {
    expect(call(admin, 'supportsAdminSubdomain', '127.0.0.1')).toBe(false)
    expect(call(admin, 'supportsAdminSubdomain', '::1')).toBe(false)
  })

  test('where it cannot, the main origin stands in for the console', () => {
    expect(call(asgard, 'isAsgardConsoleHostname', WORKERS_DEV)).toBe(true)
  })
})

describe('the handoff URL', () => {
  test('puts the token in the fragment, never the query string', () => {
    const url = call<URL>(asgard, 'buildAsgardHandoffUrl', new URL('https://luckypick.com/play'), 'TOKEN')

    expect(url.search).toBe('')
    expect(url.hash).toBe('#idToken=TOKEN')
  })

  test('targets the console subdomain root on a real domain', () => {
    expect(
      call<URL>(asgard, 'buildAsgardHandoffUrl', new URL('https://luckypick.com/play'), 'TOKEN').toString()
    ).toBe('https://asgard.luckypick.com/#idToken=TOKEN')
  })

  test('stays on the origin path where no subdomain is possible', () => {
    expect(call<URL>(admin, 'buildAdminHandoffUrl', new URL(`https://${WORKERS_DEV}/`), 'TOKEN').toString()).toBe(
      `https://${WORKERS_DEV}/admin#idToken=TOKEN`
    )
  })
})

describe('paths', () => {
  test('external drops the prefix, internal adds it', () => {
    expect(call(admin, 'toAdminExternalPath', '/admin/accounts')).toBe('/accounts')
    expect(call(admin, 'toAdminInternalPath', '/accounts')).toBe('/admin/accounts')
    expect(call(admin, 'toAdminInternalPath', '/')).toBe('/admin')
    expect(call(admin, 'toAdminExternalPath', '/admin')).toBe('/')
  })

  test('adding the prefix twice is a no-op', () => {
    expect(call(admin, 'toAdminInternalPath', '/admin/accounts')).toBe('/admin/accounts')
  })

  test('a nav link resolves for whichever host it is rendered on', () => {
    expect(call(admin, 'resolveAdminNavigationPath', '/admin/accounts', '/')).toBe('/accounts')
    expect(call(admin, 'resolveAdminNavigationPath', '/accounts', '/admin')).toBe('/admin/accounts')
  })
})

describe('the shared session cookie domain', () => {
  test('is the app root, so a console session is readable on the app', () => {
    expect(call(rendered.host, 'getSharedCookieDomain', 'asgard.luckypick.com')).toBe('luckypick.com')
  })

  test('is unset where there is only one host, which is tighter', () => {
    expect(call(rendered.host, 'getSharedCookieDomain', 'localhost')).toBeUndefined()
    expect(call(rendered.host, 'getSharedCookieDomain', WORKERS_DEV)).toBeUndefined()
  })
})

describe('consoles are not tenants', () => {
  test('a console label never reports as a subdomain tenant', () => {
    for (const label of ['asgard', 'admin']) {
      expect(call<{ isSubdomain: boolean }>(rendered.subdomains, 'extractSubdomain', `${label}.luckypick.com`).isSubdomain).toBe(false)
    }
  })

  test('an actual tenant still does', () => {
    expect(call<{ subdomain: string | null }>(rendered.subdomains, 'extractSubdomain', 'acme.luckypick.com').subdomain).toBe('acme')
  })
})

describe('getting back to the app', () => {
  test('buildAppUrl drops the console label', () => {
    expect(call<URL>(rendered.appUrl, 'buildAppUrl', new URL('https://admin.luckypick.com/x'), '/').toString()).toBe(
      'https://luckypick.com/'
    )
  })
})
