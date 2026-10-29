import { adminCredentialEntries } from '../env-file'
import * as ui from '../prompts'
import { emptyPlan, type Step } from '../step'

/**
 * Mints the service-account key the Worker runs on.
 *
 * The key never touches the filesystem as a file: the API returns the whole
 * service-account JSON, it is decoded in memory, and only the four discrete
 * environment variables are written. There is deliberately no `sa.json` — a
 * private key sitting in a repository root is the mistake this avoids, however
 * well gitignored it is.
 */
export const serviceAccountStep: Step = {
  id: 'firebase.serviceAccount',
  title: 'Service-account key',

  skip: (context) => context.mode === 'check',

  async detect(context) {
    return context.adminCredential === null ? 'absent' : 'satisfied'
  },

  async plan() {
    return emptyPlan('Mint a private key for the Admin SDK, and write it to the env files.')
  },

  async apply(context) {
    const projectId = context.projectId
    if (projectId === null) throw new Error('No Firebase project was chosen, so there is no key to mint.')

    const looking = ui.spinner()
    looking.start('Finding the service account')
    const account = await context.iam.resolveAdminServiceAccount(projectId, context.app.appSlug)
    const existingKeys = await context.iam.countUserManagedKeys(projectId, account.email)
    looking.stop(account.email)

    if (existingKeys > 0) {
      ui.log.info(
        `This account already has ${existingKeys} key${existingKeys === 1 ? '' : 's'}. A key cannot be read back after it is made, so a new one is the only way to fill in the env files.`
      )
    }

    if (!(await ui.confirm('Create a new private key?'))) {
      ui.log.warn('Skipped. The Worker will answer 503 until the Admin credentials are set.')
      context.manual.push({ title: 'Admin SDK private key', outcome: 'skipped' })
      return
    }

    const minting = ui.spinner()
    minting.start('Creating the key')
    context.adminCredential = await context.iam.createKey(projectId, account.email)
    minting.stop('Key created')

    // Names only. The values are written to gitignored files and printed nowhere.
    ui.log.success(
      `Will write ${adminCredentialEntries(context.adminCredential)
        .map((entry) => entry.key)
        .join(', ')}.`
    )
  }
}
