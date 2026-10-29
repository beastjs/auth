import type { FirebaseAdminCredential } from '../context'
import { describeHttpError, type HttpClient } from '../http'
import type { TokenProvider } from './credential'

const IAM = 'https://iam.googleapis.com/v1'
const RESOURCE_MANAGER = 'https://cloudresourcemanager.googleapis.com/v1'

export type ServiceAccount = {
  readonly email: string
  readonly displayName?: string
}

/** What `serviceAccounts.keys.create` answers with. */
type CreatedKey = {
  name?: string
  /** The whole service-account JSON file, base64 encoded. */
  privateKeyData?: string
}

type ServiceAccountJson = {
  project_id?: string
  client_email?: string
  private_key?: string
  private_key_id?: string
}

/**
 * The slice of the IAM API this needs: finding a service account and minting a
 * key for it.
 *
 * It runs on the same credential the Firebase API calls use, so `gcloud` is not
 * required for any of it.
 */
export class IamApi {
  constructor(
    private readonly http: HttpClient,
    private readonly tokens: TokenProvider
  ) {}

  private async call(url: string, init: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<unknown> {
    const response = await this.http.request({
      url,
      method: init.method ?? 'GET',
      body: init.body,
      bearer: await this.tokens.getAccessToken()
    })

    if (!response.ok) throw new Error(describeHttpError(response))

    return response.body
  }

  async listServiceAccounts(projectId: string): Promise<readonly ServiceAccount[]> {
    const body = (await this.call(`${IAM}/projects/${projectId}/serviceAccounts`)) as {
      accounts?: readonly ServiceAccount[]
    }

    return body.accounts ?? []
  }

  /**
   * The service account the Worker should run as.
   *
   * Firebase's own `firebase-adminsdk-*` is preferred when it exists: Firebase
   * created it with the roles the Admin SDK needs already granted, so reusing it
   * avoids a `setIamPolicy` call — the one step in this whole flow most likely
   * to be refused by an organization policy. A dedicated account is created only
   * when there is no Firebase one to use.
   */
  async resolveAdminServiceAccount(projectId: string, appSlug: string): Promise<ServiceAccount> {
    const accounts = await this.listServiceAccounts(projectId)

    const firebaseOwned = accounts.find((account) => account.email.startsWith('firebase-adminsdk'))
    if (firebaseOwned !== undefined) return firebaseOwned

    const accountId = `${appSlug}-admin`.replace(/[^a-z0-9-]/g, '-').slice(0, 30).replace(/-+$/, '')
    const expectedEmail = `${accountId}@${projectId}.iam.gserviceaccount.com`

    const existing = accounts.find((account) => account.email === expectedEmail)
    if (existing !== undefined) return existing

    const created = (await this.call(`${IAM}/projects/${projectId}/serviceAccounts`, {
      method: 'POST',
      body: { accountId, serviceAccount: { displayName: `${appSlug} server (firebase-admin)` } }
    })) as ServiceAccount

    if (created.email === undefined) throw new Error('The service account was created but its address was not returned.')

    await this.grantFirebaseAuthAdmin(projectId, created.email)

    return created
  }

  /**
   * Grants the one role the generated server code needs.
   *
   * `roles/firebaseauth.admin` covers verifying ID tokens and session cookies,
   * minting session cookies, listing users and setting custom claims. Signing a
   * custom token happens locally with the private key, so it needs no role.
   *
   * Read-modify-write: sending a policy without the existing bindings would
   * revoke everything else on the project.
   */
  private async grantFirebaseAuthAdmin(projectId: string, email: string): Promise<void> {
    const policy = (await this.call(`${RESOURCE_MANAGER}/projects/${projectId}:getIamPolicy`, {
      method: 'POST',
      body: {}
    })) as { bindings?: { role?: string; members?: string[] }[]; etag?: string }

    const member = `serviceAccount:${email}`
    const bindings = policy.bindings ?? []
    const existing = bindings.find((binding) => binding.role === 'roles/firebaseauth.admin')

    if (existing?.members?.includes(member) === true) return

    const nextBindings = existing
      ? bindings.map((binding) =>
          binding === existing ? { ...binding, members: [...(binding.members ?? []), member] } : binding
        )
      : [...bindings, { role: 'roles/firebaseauth.admin', members: [member] }]

    await this.call(`${RESOURCE_MANAGER}/projects/${projectId}:setIamPolicy`, {
      method: 'POST',
      body: { policy: { ...policy, bindings: nextBindings } }
    })
  }

  /**
   * Mints a new private key and returns it in memory.
   *
   * The key never reaches the filesystem: the API hands back the whole
   * service-account JSON base64 encoded, it is decoded here, and only the four
   * discrete environment variables are ever written. There is no `sa.json`.
   */
  async createKey(projectId: string, email: string): Promise<FirebaseAdminCredential> {
    const created = (await this.call(
      `${IAM}/projects/${projectId}/serviceAccounts/${encodeURIComponent(email)}/keys`,
      { method: 'POST', body: { privateKeyType: 'TYPE_GOOGLE_CREDENTIALS_FILE', keyAlgorithm: 'KEY_ALG_RSA_2048' } }
    )) as CreatedKey

    if (created.privateKeyData === undefined) {
      throw new Error('The key was created but its contents were not returned, so nothing can be written.')
    }

    let parsed: ServiceAccountJson
    try {
      parsed = JSON.parse(Buffer.from(created.privateKeyData, 'base64').toString('utf8')) as ServiceAccountJson
    } catch {
      throw new Error('The key came back in a form this CLI could not read.')
    }

    const missing = (['project_id', 'client_email', 'private_key', 'private_key_id'] as const).filter(
      (key) => typeof parsed[key] !== 'string' || parsed[key]?.length === 0
    )

    if (missing.length > 0) throw new Error(`The service-account key is missing ${missing.join(', ')}.`)

    // A value that is not a PEM cannot be recovered from, and it fails much
    // later inside `cert()` as an unhandled throw.
    if (!(parsed.private_key as string).includes('BEGIN PRIVATE KEY')) {
      throw new Error('The service-account key does not contain a private key in PEM form.')
    }

    return {
      projectId: parsed.project_id as string,
      clientEmail: parsed.client_email as string,
      privateKey: parsed.private_key as string,
      privateKeyId: parsed.private_key_id as string
    }
  }

  /** Existing user-managed keys, so a run can say how many are already out there. */
  async countUserManagedKeys(projectId: string, email: string): Promise<number> {
    const body = (await this.call(
      `${IAM}/projects/${projectId}/serviceAccounts/${encodeURIComponent(email)}/keys?keyTypes=USER_MANAGED`
    )) as { keys?: readonly unknown[] }

    return body.keys?.length ?? 0
  }
}
