import { describe, expect, test } from 'bun:test'
import type { TokenProvider } from '../src/google/credential'
import { IamApi } from '../src/google/iam'
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
const denied = (message: string): HttpResponse => ({ status: 403, ok: false, body: { error: { message } } })

const PEM = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END PRIVATE KEY-----\n'

const keyFile = (overrides: Record<string, unknown> = {}) =>
  ok({
    name: 'projects/p/serviceAccounts/sa/keys/abc123',
    privateKeyData: Buffer.from(
      JSON.stringify({
        project_id: 'my-app-345',
        client_email: 'firebase-adminsdk-x@my-app-345.iam.gserviceaccount.com',
        private_key: PEM,
        private_key_id: 'abc123',
        ...overrides
      })
    ).toString('base64')
  })

/** Captured from the live API. */
const ACCOUNTS = ok({
  accounts: [
    {
      email: 'firebase-adminsdk-fbsvc@my-app-345.iam.gserviceaccount.com',
      displayName: 'firebase-adminsdk'
    }
  ]
})

describe('resolveAdminServiceAccount', () => {
  test('prefers the account Firebase already created and granted', async () => {
    const { client, seen } = fakeHttp([ACCOUNTS])
    const account = await new IamApi(client, tokens).resolveAdminServiceAccount('my-app-345', 'my-app')

    expect(account.email).toStartWith('firebase-adminsdk-fbsvc@')
    // One read, and crucially no setIamPolicy — the call most likely to be
    // refused by an organization policy.
    expect(seen).toHaveLength(1)
    expect(seen[0]?.method ?? 'GET').toBe('GET')
  })

  test('creates a dedicated account when Firebase made none, and grants the role', async () => {
    const { client, seen } = fakeHttp([
      ok({ accounts: [] }),
      ok({ email: 'my-app-admin@my-app-345.iam.gserviceaccount.com' }),
      ok({ bindings: [{ role: 'roles/viewer', members: ['user:someone@example.com'] }], etag: 'E' }),
      ok({})
    ])

    const account = await new IamApi(client, tokens).resolveAdminServiceAccount('my-app-345', 'my-app')

    expect(account.email).toBe('my-app-admin@my-app-345.iam.gserviceaccount.com')

    const setPolicy = seen.find((request) => request.url.endsWith(':setIamPolicy'))
    const body = setPolicy?.body as { policy: { bindings: { role: string; members: string[] }[] } }

    expect(body.policy.bindings).toContainEqual({
      role: 'roles/firebaseauth.admin',
      members: ['serviceAccount:my-app-admin@my-app-345.iam.gserviceaccount.com']
    })
    // The existing binding survives: a policy without it would revoke everything else.
    expect(body.policy.bindings).toContainEqual({ role: 'roles/viewer', members: ['user:someone@example.com'] })
  })

  test('reuses a dedicated account it made on an earlier run', async () => {
    const { client, seen } = fakeHttp([
      ok({ accounts: [{ email: 'my-app-admin@my-app-345.iam.gserviceaccount.com' }] })
    ])

    const account = await new IamApi(client, tokens).resolveAdminServiceAccount('my-app-345', 'my-app')

    expect(account.email).toBe('my-app-admin@my-app-345.iam.gserviceaccount.com')
    expect(seen).toHaveLength(1)
  })
})

describe('createKey', () => {
  test('decodes the key in memory and returns only the four values', async () => {
    const { client } = fakeHttp([keyFile()])
    const credential = await new IamApi(client, tokens).createKey('my-app-345', 'sa@my-app-345.iam.gserviceaccount.com')

    expect(credential).toEqual({
      projectId: 'my-app-345',
      clientEmail: 'firebase-adminsdk-x@my-app-345.iam.gserviceaccount.com',
      privateKey: PEM,
      privateKeyId: 'abc123'
    })
  })

  test('asks for a credentials file, not a raw key', async () => {
    const { client, seen } = fakeHttp([keyFile()])
    await new IamApi(client, tokens).createKey('my-app-345', 'sa@my-app-345.iam.gserviceaccount.com')

    expect(seen[0]?.method).toBe('POST')
    expect(seen[0]?.body).toMatchObject({ privateKeyType: 'TYPE_GOOGLE_CREDENTIALS_FILE' })
  })

  test('percent-encodes the account address, which contains an @', async () => {
    const { client, seen } = fakeHttp([keyFile()])
    await new IamApi(client, tokens).createKey('my-app-345', 'sa@my-app-345.iam.gserviceaccount.com')

    expect(seen[0]?.url).toInclude('sa%40my-app-345.iam.gserviceaccount.com')
  })

  test('refuses a value that is not a PEM, rather than failing later inside cert()', async () => {
    const { client } = fakeHttp([keyFile({ private_key: 'abc123' })])

    await expect(
      new IamApi(client, tokens).createKey('my-app-345', 'sa@my-app-345.iam.gserviceaccount.com')
    ).rejects.toThrow('does not contain a private key in PEM form')
  })

  test('names what a partial key file is missing', async () => {
    const { client } = fakeHttp([keyFile({ private_key_id: '' })])

    await expect(
      new IamApi(client, tokens).createKey('my-app-345', 'sa@my-app-345.iam.gserviceaccount.com')
    ).rejects.toThrow(/private_key_id/)
  })

  test('says so when the key was made but not returned', async () => {
    const { client } = fakeHttp([ok({ name: 'projects/p/serviceAccounts/sa/keys/abc' })])

    await expect(
      new IamApi(client, tokens).createKey('my-app-345', 'sa@my-app-345.iam.gserviceaccount.com')
    ).rejects.toThrow('contents were not returned')
  })

  test('a refusal carries the API wording and no key material', async () => {
    const { client } = fakeHttp([denied('Key creation is not allowed on this project.')])

    await expect(
      new IamApi(client, tokens).createKey('my-app-345', 'sa@my-app-345.iam.gserviceaccount.com')
    ).rejects.toThrow('Key creation is not allowed on this project.')
  })
})

describe('countUserManagedKeys', () => {
  test('counts only user-managed keys', async () => {
    const { client, seen } = fakeHttp([ok({ keys: [{ name: 'a' }, { name: 'b' }] })])
    const count = await new IamApi(client, tokens).countUserManagedKeys('my-app-345', 'sa@x.com')

    expect(count).toBe(2)
    expect(seen[0]?.url).toInclude('keyTypes=USER_MANAGED')
  })

  test('zero when the account has none', async () => {
    const { client } = fakeHttp([ok({})])
    expect(await new IamApi(client, tokens).countUserManagedKeys('my-app-345', 'sa@x.com')).toBe(0)
  })
})
