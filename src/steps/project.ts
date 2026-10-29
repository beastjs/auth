import type { RunContext } from '../context'
import {
  createProject,
  createWebApp,
  getWebConfig,
  isLoggedIn,
  listProjects,
  listWebApps,
  reauthenticate
} from '../google/firebase-cli'
import * as ui from '../prompts'
import { emptyPlan, type Step, type StepPlan, type StepState } from '../step'

const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/

const suggestProjectId = (appSlug: string) =>
  `${appSlug}-${Math.floor(Math.random() * 9000 + 1000)}`.slice(0, 30)

/**
 * Makes sure the stored Firebase credential still works before anything else
 * leans on it.
 *
 * The CLI's refresh token expires on its own schedule, and every authenticated
 * command then fails with the same unhelpful shape. Catching it once, here,
 * turns four confusing failures later into one `firebase login --reauth`.
 */
export const googleAuthStep: Step = {
  id: 'google.auth',
  title: 'Firebase sign-in',

  // `--check` is an offline drift check, usable as a package script and a CI
  // gate, so it never probes a credential or reaches Google.
  skip: (context) => context.mode === 'check',

  async detect(context) {
    return (await isLoggedIn(context.runner)) ? 'satisfied' : 'absent'
  },

  async plan() {
    return emptyPlan('Sign in to Firebase again — the stored credential has expired.')
  },

  async apply(context) {
    ui.log.warn('Your Firebase credentials are no longer valid.')
    if (!(await ui.confirm('Run `firebase login --reauth` now?'))) throw new ui.UserAbort()

    await reauthenticate(context.runner)

    if (!(await isLoggedIn(context.runner))) {
      throw new Error('Firebase still reports an invalid credential, so nothing was changed.')
    }
  }
}

/** Picks the Firebase project, offering the existing ones before creating anything. */
export const projectStep: Step = {
  id: 'firebase.project',
  title: 'Firebase project',

  // `--check` is an offline drift check, usable as a package script and a CI
  // gate, so it never probes a credential or reaches Google.
  skip: (context) => context.mode === 'check',

  async detect(context) {
    return context.projectId === null ? 'absent' : 'satisfied'
  },

  async plan(context) {
    return emptyPlan(
      context.projectId === null
        ? 'Choose an existing Firebase project, or create a new one.'
        : `Use the Firebase project ${context.projectId}.`
    )
  },

  async apply(context) {
    const loading = ui.spinner()
    loading.start('Reading your Firebase projects')
    const projects = await listProjects(context.runner)
    loading.stop(`Found ${projects.length} project${projects.length === 1 ? '' : 's'}`)

    const CREATE = Symbol('create')
    const choice = await ui.select<string | typeof CREATE>('Which Firebase project?', [
      ...projects.map((project) => ({
        value: project.projectId,
        label: project.projectId,
        hint: project.displayName
      })),
      { value: CREATE, label: 'Create a new project…' }
    ])

    if (choice !== CREATE) {
      context.projectId = choice
      return
    }

    const projectId = await ui.text('Project id', {
      defaultValue: suggestProjectId(context.app.appSlug),
      placeholder: suggestProjectId(context.app.appSlug),
      validate: (value) =>
        PROJECT_ID_PATTERN.test(value)
          ? undefined
          : 'Six to thirty characters: lowercase letters, digits and hyphens, starting with a letter.'
    })
    const displayName = await ui.text('Display name', { defaultValue: context.app.appSlug })

    const creating = ui.spinner()
    creating.start(`Creating ${projectId}`)
    const created = await createProject(context.runner, projectId, displayName)
    creating.stop(`Created ${created.projectId}`)

    context.projectId = created.projectId
  }
}

/**
 * Resolves the web app whose config the client reads.
 *
 * An existing web app is reused rather than duplicated: a project accumulates
 * them silently, and two apps for one site means two configs that can drift.
 */
export const webAppStep: Step = {
  id: 'firebase.webApp',
  title: 'Web app and client config',

  // `--check` is an offline drift check, usable as a package script and a CI
  // gate, so it never probes a credential or reaches Google.
  skip: (context) => context.mode === 'check',

  async detect(context): Promise<StepState> {
    return context.webConfig === null ? 'absent' : 'satisfied'
  },

  async plan(): Promise<StepPlan> {
    return emptyPlan('Register a web app (or reuse one) and read its client config.')
  },

  async apply(context) {
    const projectId = context.projectId
    if (projectId === null) throw new Error('No Firebase project was chosen, so there is nothing to configure.')

    const loading = ui.spinner()
    loading.start('Reading web apps')
    const apps = await listWebApps(context.runner, projectId)
    loading.stop(`Found ${apps.length} web app${apps.length === 1 ? '' : 's'}`)

    let appId: string

    if (apps.length === 0) {
      const creating = ui.spinner()
      creating.start('Registering a web app')
      const created = await createWebApp(context.runner, projectId, context.app.appSlug)
      creating.stop(`Registered ${created.appId}`)
      appId = created.appId
    } else if (apps.length === 1 && apps[0] !== undefined) {
      appId = apps[0].appId
      ui.log.info(`Reusing the web app ${apps[0].displayName ?? appId}.`)
    } else {
      appId = await ui.select(
        'Which web app?',
        apps.map((app) => ({ value: app.appId, label: app.displayName ?? app.appId, hint: app.appId }))
      )
    }

    const reading = ui.spinner()
    reading.start('Reading the client config')
    context.webConfig = await getWebConfig(context.runner, projectId, appId)
    context.webAppId = appId
    reading.stop('Client config read')
  }
}
