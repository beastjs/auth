import type { CommandRunner } from './exec'
import type { HttpClient } from './http'

/** What `firebase apps:sdkconfig web` gives back, named as the client template wants it. */
export type FirebaseWebConfig = {
  readonly apiKey: string
  readonly authDomain: string
  readonly projectId: string
  readonly storageBucket: string
  readonly messagingSenderId: string
  readonly appId: string
  readonly measurementId?: string
}

/** The three values `admin-core.ts` needs to build a `ServiceAccount`, plus the key id. */
export type FirebaseAdminCredential = {
  readonly projectId: string
  readonly clientEmail: string
  /** A real PEM, with literal newlines. Escaping happens only at the env-writing edge. */
  readonly privateKey: string
  readonly privateKeyId: string
}

export type ConsoleSpec = {
  /** The subdomain label, e.g. `asgard`. Lowercase, DNS-safe. */
  readonly label: string
  /** The custom claim the Worker verifies for this console. */
  readonly claim: 'god' | 'admin'
  /** Where the console mounts on the main origin when the host cannot carry a subdomain. */
  readonly routePrefix: string
}

export type DetectedApp = {
  readonly root: string
  /** From the app's `package.json` name — cookie names and storage keys derive from it. */
  readonly appSlug: string
  readonly hasRsbuildConfig: boolean
  readonly hasBeastTsrx: boolean
  readonly hasConvex: boolean
  readonly hasWranglerConfig: boolean
  readonly hasResizablePanels: boolean
  readonly hasIconLibrary: boolean
  /** The router module that picks a route tree, if one was found. */
  readonly routerPath: string | null
  readonly workerPath: string | null
  readonly envTypesPath: string | null
  readonly packageManager: 'bun' | 'npm'
}

export type ExternalTools = {
  readonly firebase: string | null
  readonly gcloud: string | null
  readonly bun: string | null
  readonly wrangler: string | null
}

export type RunMode = 'apply' | 'dry-run' | 'check'

/** What a manual step ended up being, for the report at the end. */
export type ManualRecord = {
  readonly title: string
  readonly outcome: 'verified' | 'assumed' | 'skipped'
  readonly url?: string
}

export type RunContext = {
  readonly mode: RunMode
  readonly runner: CommandRunner
  readonly http: HttpClient
  /** Whether a manual step may open a browser. */
  readonly openBrowser: boolean
  readonly app: DetectedApp
  readonly tools: ExternalTools
  /** Consoles the user chose. Empty is valid: Firebase without a console is a complete outcome. */
  readonly consoles: readonly ConsoleSpec[]
  /** Filled in by the project and web-app steps. */
  projectId: string | null
  webAppId: string | null
  webConfig: FirebaseWebConfig | null
  adminCredential: FirebaseAdminCredential | null
  founderUid: string | null
  /** The domain the app is served from, needed to name each console's host. */
  rootDomain: string | null
  /** Appended by every manual step, printed as the run's honest tail. */
  readonly manual: ManualRecord[]
}

export function createRunContext(input: {
  mode: RunMode
  runner: CommandRunner
  http: HttpClient
  openBrowser: boolean
  app: DetectedApp
  tools: ExternalTools
  consoles: readonly ConsoleSpec[]
}): RunContext {
  return {
    ...input,
    projectId: null,
    webAppId: null,
    webConfig: null,
    adminCredential: null,
    founderUid: null,
    rootDomain: null,
    manual: []
  }
}
