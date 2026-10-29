import type { FirebaseWebConfig } from '../context'
import type { CommandRunner } from '../exec'

/**
 * Every `firebase --json` command answers in this envelope, including failures:
 * `--json` also forces non-interactive mode, so a command that would have
 * prompted reports an error here instead of hanging.
 */
type FirebaseEnvelope<T> = {
  status: 'success' | 'error'
  result?: T
  error?: string
}

export type FirebaseProject = {
  readonly projectId: string
  readonly displayName?: string
  readonly projectNumber?: string
}

export type FirebaseWebApp = {
  readonly appId: string
  readonly displayName?: string
}

/** The shape `apps:sdkconfig web --json` nests the config under. */
type SdkConfigResult = {
  fileName?: string
  sdkConfig?: Partial<FirebaseWebConfig>
}

const AUTH_ERROR_MARKER = /credentials are no longer valid|Authentication Error|not logged in|run firebase login/i

export class FirebaseAuthExpiredError extends Error {
  constructor() {
    super('Your Firebase credentials are no longer valid. Run `firebase login --reauth`.')
    this.name = 'FirebaseAuthExpiredError'
  }
}

/**
 * Runs a `firebase` command and unwraps its envelope.
 *
 * A stale credential is separated from every other failure because it is the one
 * the user can fix in a single step, and it is common: the CLI's stored refresh
 * token expires and the next authenticated call fails with nothing else wrong.
 */
async function firebaseJson<T>(
  runner: CommandRunner,
  args: readonly string[],
  options: { cwd?: string } = {}
): Promise<T> {
  const result = await runner.run('firebase', [...args, '--json'], { cwd: options.cwd })
  const combined = `${result.stdout}\n${result.stderr}`

  if (AUTH_ERROR_MARKER.test(combined)) {
    throw new FirebaseAuthExpiredError()
  }

  // The CLI prints progress lines before the JSON body, so parse from the first
  // brace rather than the first byte.
  const start = result.stdout.indexOf('{')
  if (start === -1) {
    const complaint = (result.stderr.trim() || result.stdout.trim() || `exit code ${result.code}`).trim()
    throw new Error(`\`firebase ${args.join(' ')}\` produced no JSON: ${complaint}`)
  }

  let envelope: FirebaseEnvelope<T>
  try {
    envelope = JSON.parse(result.stdout.slice(start)) as FirebaseEnvelope<T>
  } catch {
    throw new Error(`\`firebase ${args.join(' ')}\` produced JSON this CLI could not read.`)
  }

  if (envelope.status === 'error' || envelope.result === undefined) {
    const complaint = envelope.error ?? 'the command reported an error without saying what it was'
    if (AUTH_ERROR_MARKER.test(complaint)) throw new FirebaseAuthExpiredError()
    throw new Error(`\`firebase ${args.join(' ')}\` failed: ${complaint}`)
  }

  return envelope.result
}

export async function listProjects(runner: CommandRunner): Promise<readonly FirebaseProject[]> {
  const result = await firebaseJson<readonly FirebaseProject[]>(runner, ['projects:list'])
  return [...result].sort((left, right) => left.projectId.localeCompare(right.projectId))
}

export async function createProject(
  runner: CommandRunner,
  projectId: string,
  displayName: string
): Promise<FirebaseProject> {
  return await firebaseJson<FirebaseProject>(runner, [
    'projects:create',
    projectId,
    '--display-name',
    displayName
  ])
}

export async function createWebApp(
  runner: CommandRunner,
  projectId: string,
  displayName: string
): Promise<FirebaseWebApp> {
  return await firebaseJson<FirebaseWebApp>(runner, [
    'apps:create',
    'web',
    displayName,
    '--project',
    projectId
  ])
}

export async function listWebApps(runner: CommandRunner, projectId: string): Promise<readonly FirebaseWebApp[]> {
  return await firebaseJson<readonly FirebaseWebApp[]>(runner, ['apps:list', 'web', '--project', projectId])
}

const REQUIRED_CONFIG_KEYS = [
  'apiKey',
  'authDomain',
  'projectId',
  'storageBucket',
  'messagingSenderId',
  'appId'
] as const satisfies readonly (keyof FirebaseWebConfig)[]

/**
 * Reads a web app's client config.
 *
 * The CLI nests the values under `sdkConfig` in some versions and returns them
 * flat in others, so both are accepted. A missing required key is an error here
 * rather than an `undefined` that only surfaces as a broken sign-in later.
 */
export async function getWebConfig(
  runner: CommandRunner,
  projectId: string,
  appId: string
): Promise<FirebaseWebConfig> {
  const result = await firebaseJson<SdkConfigResult & Partial<FirebaseWebConfig>>(runner, [
    'apps:sdkconfig',
    'web',
    appId,
    '--project',
    projectId
  ])

  const config = result.sdkConfig ?? result
  const missing = REQUIRED_CONFIG_KEYS.filter((key) => !config[key])

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

/**
 * Proves the stored credential still works, by making the cheapest authenticated
 * call there is. Returns false only for a stale credential; anything else throws,
 * because "cannot reach Google" and "must sign in again" need different answers.
 */
export async function isLoggedIn(runner: CommandRunner): Promise<boolean> {
  try {
    await listProjects(runner)
    return true
  } catch (error) {
    if (error instanceof FirebaseAuthExpiredError) return false
    throw error
  }
}

/** Hands the terminal to `firebase login --reauth`; its prompts are the user's to answer. */
export async function reauthenticate(runner: CommandRunner): Promise<void> {
  const result = await runner.run('firebase', ['login', '--reauth'], { interactive: true })
  if (result.code !== 0) {
    throw new Error('`firebase login --reauth` did not complete, so nothing was changed.')
  }
}
