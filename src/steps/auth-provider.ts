import { getAuthorizedDomains, isGoogleProviderEnabled } from '../google/identity-probe'
import { runManualTask } from '../manual'
import * as ui from '../prompts'
import { emptyPlan, type Step } from '../step'
import type { RunContext } from '../context'

const providersUrl = (projectId: string) =>
  `https://console.firebase.google.com/project/${projectId}/authentication/providers`

const settingsUrl = (projectId: string) =>
  `https://console.firebase.google.com/project/${projectId}/authentication/settings`

function requireProject(context: RunContext): { projectId: string; apiKey: string } {
  if (context.projectId === null || context.webConfig === null) {
    throw new Error('The Firebase project and its web config are needed before this step.')
  }
  return { projectId: context.projectId, apiKey: context.webConfig.apiKey }
}

/**
 * Enabling the Google sign-in provider, which no CLI can do.
 *
 * `firebase auth` exposes only `auth:export` and `auth:import`, and the Identity
 * Toolkit admin API wants an OAuth client that the console auto-provisions
 * behind the scenes — so this is a console visit by design, not by omission.
 *
 * What it is not is unverifiable: `accounts:createAuthUri` is the call the web
 * SDK makes to start a Google flow, it needs only the public web API key, and a
 * disabled provider answers `OPERATION_NOT_ALLOWED`. So the run waits for the
 * click and then proves it, rather than trusting it.
 */
export const googleProviderStep: Step = {
  id: 'auth.googleProvider',
  title: 'Google sign-in provider',

  skip: (context) => context.mode === 'check',

  async detect(context) {
    if (context.webConfig === null) return 'absent'
    const { enabled } = await isGoogleProviderEnabled(context.http, context.webConfig.apiKey)
    return enabled ? 'satisfied' : 'absent'
  },

  async plan() {
    return emptyPlan('Enable Google sign-in in the Firebase console, then confirm it here.')
  },

  async apply(context) {
    const { projectId, apiKey } = requireProject(context)

    const outcome = await runManualTask(context, {
      title: 'Enable Google sign-in',
      steps: [
        'Open the Authentication providers page.',
        'Click Google, then turn Enable on.',
        'Pick a support email if it asks, and Save.'
      ],
      url: providersUrl(projectId),
      prompt: 'Press Enter once Google sign-in is enabled',
      verify: () => isGoogleProviderEnabled(context.http, apiKey)
    })

    context.manual.push({ title: 'Google sign-in provider', outcome, url: providersUrl(projectId) })
  }
}

/** The hosts Firebase will accept a sign-in from. */
function requiredDomains(context: RunContext): readonly string[] {
  const hosts = ['localhost']

  if (context.rootDomain !== null) {
    hosts.push(context.rootDomain, ...context.consoles.map((console_) => `${console_.label}.${context.rootDomain}`))
  }

  return [...new Set(hosts)]
}

/**
 * The authorized-domain list, which decides where a sign-in is allowed to begin.
 *
 * Each console subdomain is a separate host to Firebase, so a missing one fails
 * on that console only — the kind of thing that looks like a routing bug for an
 * afternoon. The list is read back with the public API key rather than assumed.
 */
export const authorizedDomainsStep: Step = {
  id: 'auth.authorizedDomains',
  title: 'Authorized domains',

  skip: (context) => context.mode === 'check',

  async detect(context) {
    if (context.webConfig === null) return 'absent'

    const current = await getAuthorizedDomains(context.http, context.webConfig.apiKey)
    if (current === null) return 'absent'

    const missing = requiredDomains(context).filter((domain) => !current.includes(domain))
    return missing.length === 0 ? 'satisfied' : 'partial'
  },

  async plan() {
    return emptyPlan('Check which sign-in hosts Firebase will accept, and add any that are missing.')
  },

  async apply(context) {
    const { projectId, apiKey } = requireProject(context)

    const current = (await getAuthorizedDomains(context.http, apiKey)) ?? []
    const missing = requiredDomains(context).filter((domain) => !current.includes(domain))

    if (missing.length === 0) {
      ui.log.success(`Firebase already accepts sign-in from ${current.join(', ')}.`)
      return
    }

    const outcome = await runManualTask(context, {
      title: `Add ${missing.length} authorized domain${missing.length === 1 ? '' : 's'}`,
      steps: [
        'Open the Authentication settings page.',
        'Under Authorized domains, choose Add domain.',
        `Add: ${missing.join(', ')}`
      ],
      url: settingsUrl(projectId),
      prompt: 'Press Enter once the domains are added',
      verify: async () => {
        const updated = (await getAuthorizedDomains(context.http, apiKey)) ?? []
        const stillMissing = missing.filter((domain) => !updated.includes(domain))

        return stillMissing.length === 0
          ? { enabled: true, detail: 'All the hosts are authorized.' }
          : { enabled: false, detail: `Still missing: ${stillMissing.join(', ')}.` }
      }
    })

    context.manual.push({ title: 'Authorized domains', outcome, url: settingsUrl(projectId) })
  }
}
