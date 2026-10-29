import type { FirebaseWebConfig } from '../context'
import { describeHttpError, type HttpClient, type HttpResponse } from '../http'
import type { TokenProvider } from './credential'

const FIREBASE = 'https://firebase.googleapis.com/v1beta1'
const RESOURCE_MANAGER = 'https://cloudresourcemanager.googleapis.com/v1'

export type FirebaseProject = {
  readonly projectId: string
  readonly displayName?: string
  readonly projectNumber?: string
}

export type FirebaseWebApp = {
  readonly appId: string
  readonly displayName?: string
}

type Operation = { name?: string; done?: boolean; error?: { message?: string }; response?: unknown }

/**
 * The Firebase Management API, spoken directly.
 *
 * The `firebase` CLI would be the obvious way to do this, and it owns the one
 * thing that stays with it — the browser sign-in. But its HTTP layer breaks on
 * current Node (`InvalidArgumentError: invalid onError method` from undici), so
 * every project, app and config call it makes fails on a machine that has only
 * Node 26. Talking to the API with the token that CLI already obtained removes
 * a whole class of version-skew failure and needs no extra credential.
 */
export class FirebaseApi {
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

  /**
   * Waits for a long-running operation.
   *
   * Project and app creation both answer with an operation rather than a
   * result, and polling too eagerly is how a brand-new project earns a quota
   * complaint, so the interval backs off.
   */
  private async awaitOperation(operationUrl: string, label: string): Promise<unknown> {
    const deadline = Date.now() + 3 * 60 * 1000
    let waitMs = 1_000

    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, waitMs))
      waitMs = Math.min(waitMs * 1.5, 8_000)

      const operation = (await this.call(operationUrl)) as Operation

      if (operation.error?.message !== undefined) throw new Error(`${label} failed: ${operation.error.message}`)
      if (operation.done === true) return operation.response
    }

    throw new Error(`${label} is still running after three minutes. Check the Firebase console before retrying.`)
  }

  async listProjects(): Promise<readonly FirebaseProject[]> {
    const body = (await this.call(`${FIREBASE}/projects?pageSize=1000`)) as { results?: readonly FirebaseProject[] }
    return [...(body.results ?? [])].sort((left, right) => left.projectId.localeCompare(right.projectId))
  }

  /**
   * Creates a project and adds Firebase to it — two operations, in that order.
   *
   * A Google Cloud project is the thing that exists; Firebase is a service
   * added onto one. The console hides the seam, so this says which half is
   * running when something goes wrong.
   */
  async createProject(projectId: string, displayName: string): Promise<FirebaseProject> {
    const created = (await this.call(`${RESOURCE_MANAGER}/projects`, {
      method: 'POST',
      body: { projectId, name: displayName }
    })) as Operation

    if (created.name === undefined) throw new Error('Google Cloud accepted the project but named no operation.')
    await this.awaitOperation(`${RESOURCE_MANAGER}/${created.name}`, `Creating ${projectId}`)

    const added = (await this.call(`${FIREBASE}/projects/${projectId}:addFirebase`, {
      method: 'POST',
      body: {}
    })) as Operation

    if (added.name !== undefined) {
      await this.awaitOperation(`${FIREBASE}/${added.name}`, `Adding Firebase to ${projectId}`)
    }

    return { projectId, displayName }
  }

  async listWebApps(projectId: string): Promise<readonly FirebaseWebApp[]> {
    const body = (await this.call(`${FIREBASE}/projects/${projectId}/webApps`)) as {
      apps?: readonly FirebaseWebApp[]
    }
    return body.apps ?? []
  }

  async createWebApp(projectId: string, displayName: string): Promise<FirebaseWebApp> {
    const created = (await this.call(`${FIREBASE}/projects/${projectId}/webApps`, {
      method: 'POST',
      body: { displayName }
    })) as Operation

    if (created.name === undefined) throw new Error('Firebase accepted the web app but named no operation.')

    const result = (await this.awaitOperation(
      `${FIREBASE}/${created.name}`,
      `Registering a web app in ${projectId}`
    )) as FirebaseWebApp | undefined

    if (result?.appId === undefined) throw new Error('The web app was created but its app id was not returned.')

    return result
  }

  /**
   * The client config, which is exactly the six `PUBLIC_FIREBASE_*` values the
   * generated client reads, plus `measurementId` when analytics is on.
   */
  async getWebConfig(projectId: string, appId: string): Promise<FirebaseWebConfig> {
    const config = (await this.call(
      `${FIREBASE}/projects/${projectId}/webApps/${encodeURIComponent(appId)}/config`
    )) as Partial<FirebaseWebConfig>

    const required = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'] as const
    const missing = required.filter((key) => !config[key])

    if (missing.length > 0) {
      throw new Error(`The web app config came back without ${missing.join(', ')}.`)
    }

    return {
      apiKey: config.apiKey as string,
      authDomain: config.authDomain as string,
      projectId: config.projectId as string,
      storageBucket: config.storageBucket as string,
      messagingSenderId: config.messagingSenderId as string,
      appId: config.appId as string,
      measurementId: config.measurementId
    }
  }

  /** Proves the credential works, with the cheapest authenticated call there is. */
  async isUsable(): Promise<boolean> {
    try {
      await this.listProjects()
      return true
    } catch {
      return false
    }
  }
}

/** Kept so a caller can tell an empty result from a failed one. */
export type { HttpResponse }
