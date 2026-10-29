import { describe, expect, test } from 'bun:test'
import { createRunContext, type RunContext } from '../src/context'
import type { CommandRunner } from '../src/exec'
import { FirebaseApi } from '../src/google/firebase-api'
import { IamApi } from '../src/google/iam'
import type { TokenProvider } from '../src/google/credential'
import type { HttpClient, HttpResponse } from '../src/http'
import { getAuthorizedDomains, isGoogleProviderEnabled } from '../src/google/identity-probe'
import { runManualTask } from '../src/manual'

const noopRunner: CommandRunner = {
  async run() {
    return { code: 0, stdout: '', stderr: '' }
  },
  async which() {
    return null
  }
}

function fakeHttp(replies: HttpResponse[]): HttpClient & { urls: string[] } {
  const urls: string[] = []
  let index = 0

  return {
    urls,
    async request({ url }) {
      urls.push(url)
      return replies[Math.min(index++, replies.length - 1)] as HttpResponse
    }
  }
}

const ok = (body: unknown): HttpResponse => ({ status: 200, ok: true, body })
const bad = (message: string): HttpResponse => ({ status: 400, ok: false, body: { error: { message } } })

/** Captured from the live endpoint: an enabled provider answers with an authUri. */
const ENABLED = ok({ kind: 'identitytoolkit#CreateAuthUriResponse', authUri: 'https://accounts.google.com/o/oauth2/auth?x=1' })
/** Also captured live: this is the exact wording for a provider that is not configured. */
const NOT_CONFIGURED = bad('OPERATION_NOT_ALLOWED : The identity provider configuration is not found.')

const unusedTokens: TokenProvider = {
  async getAccessToken() {
    throw new Error('no token should be needed in this test')
  },
  async describe() {
    return 'test'
  }
}

function contextWith(http: HttpClient): RunContext {
  return createRunContext({
    mode: 'apply',
    runner: noopRunner,
    http,
    tokens: unusedTokens,
    api: new FirebaseApi(http, unusedTokens),
    iam: new IamApi(http, unusedTokens),
    openBrowser: false,
    app: {
      root: '/app',
      appSlug: 'my-app',
      hasRsbuildConfig: true,
      hasBeastTsrx: true,
      hasConvex: false,
      hasWranglerConfig: false,
      hasResizablePanels: false,
      hasIconLibrary: false,
      routerPath: null,
      workerPath: null,
      envTypesPath: null,
      packageManager: 'bun'
    },
    tools: { firebase: null, gcloud: null, bun: null, wrangler: null },
    flags: { noConsoles: true }
  })
}

describe('isGoogleProviderEnabled', () => {
  test('an authUri means a real sign-in would work', async () => {
    const http = fakeHttp([ENABLED])
    const { enabled } = await isGoogleProviderEnabled(http, 'AIzaKEY')

    expect(enabled).toBe(true)
    expect(http.urls[0]).toInclude('accounts:createAuthUri')
    expect(http.urls[0]).toInclude('key=AIzaKEY')
  })

  test('OPERATION_NOT_ALLOWED means the provider is off, and says so plainly', async () => {
    const { enabled, detail } = await isGoogleProviderEnabled(fakeHttp([NOT_CONFIGURED]), 'AIzaKEY')

    expect(enabled).toBe(false)
    expect(detail).toBe('Google sign-in is not enabled on this project yet.')
  })

  test('any other refusal is reported as uncertainty, not as "off"', async () => {
    const { enabled, detail } = await isGoogleProviderEnabled(
      fakeHttp([bad('API key not valid. Please pass a valid API key.')]),
      'AIzaKEY'
    )

    expect(enabled).toBe(false)
    // Telling the user to go enable something already enabled is worse than
    // admitting the check could not be made.
    expect(detail).toStartWith('Could not tell:')
  })
})

describe('getAuthorizedDomains', () => {
  test('reads the list with only the public API key', async () => {
    const domains = await getAuthorizedDomains(
      fakeHttp([ok({ projectId: '661095477862', authorizedDomains: ['localhost', 'my-app.web.app'] })]),
      'AIzaKEY'
    )

    expect(domains).toEqual(['localhost', 'my-app.web.app'])
  })

  test('null when the project config cannot be read, so callers do not see an empty list', async () => {
    expect(await getAuthorizedDomains(fakeHttp([bad('PERMISSION_DENIED')]), 'AIzaKEY')).toBeNull()
  })
})

describe('the manual gate', () => {
  test('verifies the user’s click rather than trusting it', async () => {
    const context = contextWith(fakeHttp([ENABLED]))

    const outcome = await runManualTask(context, {
      title: 'Enable Google sign-in',
      steps: ['Flip the toggle.'],
      verify: () => isGoogleProviderEnabled(context.http, 'AIzaKEY')
    })

    expect(outcome).toBe('verified')
  })

  test('reports skipped when the work still has not been done', async () => {
    const context = contextWith(fakeHttp([NOT_CONFIGURED]))

    const outcome = await runManualTask(context, {
      title: 'Enable Google sign-in',
      steps: ['Flip the toggle.'],
      verify: () => isGoogleProviderEnabled(context.http, 'AIzaKEY')
    })

    // Not "verified" and not a crash: the run continues and the report says so.
    expect(outcome).toBe('skipped')
  })

  test('a task with nothing to check is recorded as assumed, never as verified', async () => {
    const context = contextWith(fakeHttp([ENABLED]))

    const outcome = await runManualTask(context, {
      title: 'Add a DNS record',
      steps: ['Add a CNAME.']
    })

    expect(outcome).toBe('assumed')
  })
})
