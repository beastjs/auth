import type { ConsoleSpec, RunContext } from '../context'
import * as ui from '../prompts'
import { emptyPlan, type Step } from '../step'

/**
 * The console presets.
 *
 * A console is a staff surface with four things of its own: a subdomain label, a
 * route tree the host picks at load, a session cookie, and the custom claim that
 * admits a session. The claim names are part of the generated authorization
 * model and `isFirebaseCustomClaimName` refuses them for ordinary use, so these
 * are presets rather than free text.
 */
export const CONSOLE_PRESETS: readonly ConsoleSpec[] = [
  { label: 'asgard', claim: 'god', routePrefix: '/asgard' },
  { label: 'admin', claim: 'admin', routePrefix: '/admin' }
]

const describe = (preset: ConsoleSpec, rootDomain: string) =>
  `${preset.label}.${rootDomain} — gated on the \`${preset.claim}\` claim, ${preset.routePrefix} before DNS exists`

function fromFlag(flag: string): readonly ConsoleSpec[] {
  const wanted = flag
    .split(',')
    .map((label) => label.trim().toLowerCase())
    .filter(Boolean)

  const unknown = wanted.filter((label) => !CONSOLE_PRESETS.some((preset) => preset.label === label))
  if (unknown.length > 0) {
    throw new Error(`No preset for the console${unknown.length === 1 ? '' : 's'} ${unknown.join(', ')}.`)
  }

  return CONSOLE_PRESETS.filter((preset) => wanted.includes(preset.label))
}

const DOMAIN_PATTERN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/

/**
 * Asks which staff consoles the app should have, and on what domain.
 *
 * It runs after the project is settled rather than first, because "which
 * consoles" is the one question in this run that needs explaining — and nobody
 * should meet it before they have seen what the tool is doing.
 */
export const consolesStep: Step = {
  id: 'app.consoles',
  title: 'Staff consoles',

  // Nothing is generated in a check or a dry run, so there is nothing to choose.
  skip: (context) => context.mode !== 'apply',

  async detect(context) {
    return context.consoles.length > 0 || context.flags.noConsoles ? 'satisfied' : 'absent'
  },

  async plan() {
    return emptyPlan('Choose the staff consoles to generate.')
  },

  async apply(context) {
    context.consoles = await chooseConsoles(context)
    if (context.consoles.length === 0) return

    context.rootDomain = await chooseRootDomain(context)

    ui.note(
      context.consoles.map((preset) => describe(preset, context.rootDomain ?? 'your-domain.com')).join('\n'),
      'Consoles to generate'
    )
  }
}

async function chooseConsoles(context: RunContext): Promise<readonly ConsoleSpec[]> {
  if (context.flags.noConsoles) return []
  if (context.flags.consoles !== undefined) return fromFlag(context.flags.consoles)

  ui.note(
    [
      'A console is a staff area on its own subdomain, separate from the app.',
      'Each one gets its own route tree, its own session cookie, and a custom',
      'claim that admits a session — so a signed-in player cannot reach it.',
      '',
      'Pick none if you only want Firebase sign-in for now.'
    ].join('\n'),
    'What is a console?'
  )

  const labels = await ui.multiselect(
    'Which staff consoles? (space toggles, enter accepts)',
    CONSOLE_PRESETS.map((preset) => ({
      value: preset.label,
      label: `${preset.label}.<domain>`,
      hint: `gated on the \`${preset.claim}\` claim`
    })),
    CONSOLE_PRESETS.map((preset) => preset.label)
  )

  return CONSOLE_PRESETS.filter((preset) => labels.includes(preset.label))
}

async function chooseRootDomain(context: RunContext): Promise<string | null> {
  const answered =
    context.flags.rootDomain ??
    (await ui.text('What domain is the app served from? (Enter to skip)', {
      placeholder: 'example.com',
      validate: (value) =>
        value.length === 0 || DOMAIN_PATTERN.test(value.trim().toLowerCase())
          ? undefined
          : 'A bare domain, with no scheme and no path.'
    }))

  return answered.trim().toLowerCase() || null
}
