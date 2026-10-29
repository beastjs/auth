import { describe, expect, test } from 'bun:test'
import type { TokenProvider } from '../src/google/credential'
import { FirebaseApi } from '../src/google/firebase-api'
import type { HttpClient, HttpRequest, HttpResponse } from '../src/http'

const tokens: TokenProvider = {
  async getAccessToken() {
    return 'ya29.fake'
  },
  async describe() {
    return 'test@example.com'
  }
}

function fakeHttp(replies: readonly HttpResponse[]) {
  const seen: HttpRequest[] = []
  let index = 0

  const client: HttpClient = {
    async request(request) {
      seen.push(request)
      return replies[Math.min(index++, replies.length - 1)] as HttpResponse
    }
  }

  return { client, seen }
}

const ok = (body: unknown): HttpResponse => ({ status: 200, ok: true, body })
const denied = (message: string, status = 403): HttpResponse => ({
  status,
  ok: false,
  body: { error: { message, status: 'PERMISSION_DENIED' } }
})

/** The shapes below were captured from the live API, not invented. */
const PROJECTS = ok({
  results: [
    { projectId: 'zeta-app', displayName: 'Zeta' },
    { projectId: 'abridge-global', displayName: 'Abridge' }
  ]
})

const WEB_APPS = ok({
  apps: [
    {
      appId: '1:661095477862:web:35298595e904a475abf3a7',
      displayName: 'LuckPick',
      name: 'projects/lucky-pick-345/webApps/1:661095477862:web:35298595e904a475abf3a7'
    }
  ]
})

const WEB_CONFIG = ok({
  projectId: 'lucky-pick-345',
  appId: '1:661095477862:web:35298595e904a475abf3a7',
  storageBucket: 'lucky-pick-345.firebasestorage.app',
  apiKey: 'AIzaSyFAKE',
  authDomain: 'lucky-pick-345.firebaseapp.com',
  messagingSenderId: '661095477862',
  measurementId: 'G-FAKE',
  projectNumber: '661095477862',
  version: '1'
})

describe('listProjects', () => {
  test('sends the token as a bearer header, never in the URL', async () => {
    const { client, seen } = fakeHttp([PROJECTS])
    await new FirebaseApi(client, tokens).listProjects()

    expect(seen[0]?.bearer).toBe('ya29.fake')
    expect(seen[0]?.url).not.toInclude('ya29')
    expect(seen[0]?.url).toInclude('firebase.googleapis.com/v1beta1/projects')
  })

  test('sorts by project id, so a long list is navigable', async () => {
    const { client } = fakeHttp([PROJECTS])
    const projects = await new FirebaseApi(client, tokens).listProjects()

    expect(projects.map((project) => project.projectId)).toEqual(['abridge-global', 'zeta-app'])
  })

  test('an empty project list is not an error', async () => {
    const { client } = fakeHttp([ok({})])
    expect(await new FirebaseApi(client, tokens).listProjects()).toEqual([])
  })

  test("surfaces the API's own wording rather than a bare status", async () => {
    const { client } = fakeHttp([denied('Request had insufficient authentication scopes.')])

    await expect(new FirebaseApi(client, tokens).listProjects()).rejects.toThrow(
      'Request had insufficient authentication scopes.'
    )
  })
})

describe('isUsable', () => {
  test('true when the cheapest authenticated call works', async () => {
    const { client } = fakeHttp([PROJECTS])
    expect(await new FirebaseApi(client, tokens).isUsable()).toBe(true)
  })

  test('false, not a throw, when the credential is refused', async () => {
    const { client } = fakeHttp([denied('Invalid Credentials', 401)])
    expect(await new FirebaseApi(client, tokens).isUsable()).toBe(false)
  })
})

describe('listWebApps', () => {
  test('reads the apps array', async () => {
    const { client } = fakeHttp([WEB_APPS])
    const apps = await new FirebaseApi(client, tokens).listWebApps('lucky-pick-345')

    expect(apps).toHaveLength(1)
    expect(apps[0]?.displayName).toBe('LuckPick')
  })

  test('a project with no web app returns empty rather than undefined', async () => {
    const { client } = fakeHttp([ok({})])
    expect(await new FirebaseApi(client, tokens).listWebApps('empty-project')).toEqual([])
  })
})

describe('getWebConfig', () => {
  test('maps exactly the values the generated client reads', async () => {
    const { client } = fakeHttp([WEB_CONFIG])
    const config = await new FirebaseApi(client, tokens).getWebConfig('lucky-pick-345', '1:661:web:abc')

    expect(config).toEqual({
      apiKey: 'AIzaSyFAKE',
      authDomain: 'lucky-pick-345.firebaseapp.com',
      projectId: 'lucky-pick-345',
      storageBucket: 'lucky-pick-345.firebasestorage.app',
      messagingSenderId: '661095477862',
      appId: '1:661095477862:web:35298595e904a475abf3a7',
      measurementId: 'G-FAKE'
    })
  })

  test('percent-encodes the app id, which contains colons', async () => {
    const { client, seen } = fakeHttp([WEB_CONFIG])
    await new FirebaseApi(client, tokens).getWebConfig('lucky-pick-345', '1:661:web:abc')

    expect(seen[0]?.url).toInclude('1%3A661%3Aweb%3Aabc')
  })

  test('names the missing keys instead of handing back a half-config', async () => {
    const { client } = fakeHttp([ok({ projectId: 'p', authDomain: 'a', storageBucket: 's', messagingSenderId: 'm' })])

    await expect(new FirebaseApi(client, tokens).getWebConfig('p', 'a')).rejects.toThrow(/apiKey, appId/)
  })
})

describe('createWebApp', () => {
  test('waits for the operation and returns the new app id', async () => {
    const { client } = fakeHttp([
      ok({ name: 'operations/abc' }),
      ok({ done: true, response: { appId: '1:1:web:new', displayName: 'my-app' } })
    ])

    const app = await new FirebaseApi(client, tokens).createWebApp('my-app-345', 'my-app')
    expect(app.appId).toBe('1:1:web:new')
  })

  test("reports the operation's own failure", async () => {
    const { client } = fakeHttp([
      ok({ name: 'operations/abc' }),
      ok({ done: true, error: { message: 'Quota exceeded for apps per project.' } })
    ])

    await expect(new FirebaseApi(client, tokens).createWebApp('my-app-345', 'my-app')).rejects.toThrow(
      'Quota exceeded for apps per project.'
    )
  })
})
