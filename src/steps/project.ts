import type { RunContext } from '../context'
import { NoGoogleCredentialError } from '../google/credential'
import { reauthenticate } from '../google/firebase-cli'
import * as ui from '../prompts'
import { emptyPlan, type Step } from '../step'

const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/

const suggestProjectId = (appSlug: string) => `${appSlug}-${Math.floor(Math.random() * 9000 + 1000)}`.slice(0, 30)

/**
 * Checks a typed project id, or accepts nothing at all.
 *
 * Empty passes deliberately: the prompt carries a suggested id as its
 * `defaultValue`, and rejecting empty would make that suggestion impossible to
 * accept — the person would have to type it out by hand to use it.
 */
export function validateProjectId(value: string, taken: ReadonlySet<string>): string | undefined {
  const candidate = value.trim()

  if (candidate.length === 0) return undefined
  if (taken.has(candidate)) return 'You already have a project with that id.'

  return PROJECT_ID_PATTERN.test(candidate)
    ? undefined
    : 'Six to thirty characters: lowercase letters, digits and hyphens, starting with a letter.'
}

/**
 * Makes sure there is a working Google credential before anything leans on it.
 *
 * The credential comes from `firebase login`, which owns that flow. This only
 * checks it is present, unexpired and scoped, and hands the terminal back to the
 * CLI when it is not — one clear step instead of four confusing failures later.
 */
export const googleAuthStep: Step = {
  id: 'google.auth',
  title: 'Google credential',

  skip: (context) => context.mode === 'check',

  async detect(context) {
    try {
      await context.tokens.getAccessToken()
    } catch {
      return 'absent'
    }

    return (await context.api.isUsable()) ? 'satisfied' : 'absent'
  },

  async plan() {
    return emptyPlan('Sign in to Firebase, so the Google APIs can be reached.')
  },

  async apply(context) {
    try {
      await context.tokens.getAccessToken()
      ui.log.warn('The credential is present but the Firebase API refused it.')
    } catch (error) {
      ui.log.warn(error instanceof NoGoogleCredentialError ? error.message : 'No usable Google credential.')
    }

    if (!(await ui.confirm('Run `firebase login --reauth` now?'))) throw new ui.UserAbort()

    await reauthenticate(context.runner)

    if (!(await context.api.isUsable())) {
      throw new Error('The Google APIs still refuse this credential, so nothing was changed.')
    }
  }
}

/** Picks the Firebase project, offering the existing ones before creating anything. */
export const projectStep: Step = {
  id: 'firebase.project',
  title: 'Firebase project',

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
    const projects = await context.api.listProjects()
    loading.stop(`Found ${projects.length} project${projects.length === 1 ? '' : 's'}`)

    const CREATE = '\u0000create'
    const choice = await ui.select<string>('Which Firebase project?', [
      { value: CREATE, label: 'Create a new project…' },
      ...projects.map((project) => ({
        value: project.projectId,
        label: project.projectId,
        hint: project.displayName
      }))
    ])

    if (choice !== CREATE) {
      context.projectId = choice
      return
    }

    const taken = new Set(projects.map((project) => project.projectId))

    // Suggested once: `suggestProjectId` is random, so calling it for both the
    // default and the placeholder would show one id and submit another.
    const suggestion = suggestProjectId(context.app.appSlug)

    const projectId = await ui.text('Project id', {
      defaultValue: suggestion,
      placeholder: suggestion,
      validate: (value) => validateProjectId(value, taken)
    })

    const displayName = await ui.text('Display name', { defaultValue: context.app.appSlug })

    if (projectId.trim().length === 0 || displayName.trim().length === 0) {
      throw new Error('A project needs an id and a display name.')
    }

    const creating = ui.spinner()
    creating.start(`Creating ${projectId.trim()} — this takes a minute`)
    const created = await context.api.createProject(projectId.trim(), displayName.trim())
    creating.stop(`Created ${created.projectId}`)

    context.projectId = created.projectId
  }
}

/**
 * Resolves the web app whose config the client reads.
 *
 * An existing web app is reused rather than duplicated: a project accumulates
 * them quietly, and two apps for one site means two configs that can drift.
 */
export const webAppStep: Step = {
  id: 'firebase.webApp',
  title: 'Web app and client config',

  skip: (context) => context.mode === 'check',

  async detect(context) {
    return context.webConfig === null ? 'absent' : 'satisfied'
  },

  async plan() {
    return emptyPlan('Register a web app (or reuse one) and read its client config.')
  },

  async apply(context) {
    const projectId = context.projectId
    if (projectId === null) throw new Error('No Firebase project was chosen, so there is nothing to configure.')

    const loading = ui.spinner()
    loading.start('Reading web apps')
    const apps = await context.api.listWebApps(projectId)
    loading.stop(`Found ${apps.length} web app${apps.length === 1 ? '' : 's'}`)

    let appId: string

    if (apps.length === 0) {
      const creating = ui.spinner()
      creating.start('Registering a web app')
      const created = await context.api.createWebApp(projectId, context.app.appSlug)
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
    context.webConfig = await context.api.getWebConfig(projectId, appId)
    context.webAppId = appId
    reading.stop('Client config read')
  }
}
