import type { RunContext } from './context'
import * as ui from './prompts'

/**
 * Something the CLI cannot do and the user can.
 *
 * `verify` is what separates a real gate from a polite suggestion: where it
 * exists, the run checks the result rather than trusting it, and keeps offering
 * to check again. Where it does not, the outcome is recorded as assumed and the
 * final report says so, because claiming a step succeeded on no evidence is
 * worse than admitting the gap.
 */
export type ManualTask = {
  readonly title: string
  /** Numbered for the user; one action each. */
  readonly steps: readonly string[]
  readonly url?: string
  /** What the pause asks. Defaults to a generic prompt. */
  readonly prompt?: string
  verify?: () => Promise<{ enabled: boolean; detail: string }>
}

export type ManualOutcome = 'verified' | 'assumed' | 'skipped'

const MAX_ATTEMPTS = 4

/** Opens a URL with the platform's own opener, through the command seam. */
async function openUrl(context: RunContext, url: string): Promise<boolean> {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]]

  try {
    const result = await context.runner.run(command as string, args as string[])
    return result.code === 0
  } catch {
    // A headless box, an SSH session, no handler registered. The URL is printed
    // either way, so this is not a failure worth stopping for.
    return false
  }
}

/**
 * Presents a manual task, waits for the user, then verifies where it can.
 *
 * The sequence matters: instructions first, then the browser, then the wait.
 * Opening a browser before the user has read what to do in it is how people end
 * up clicking the wrong toggle.
 */
export async function runManualTask(context: RunContext, task: ManualTask): Promise<ManualOutcome> {
  const body = [
    ...task.steps.map((step, index) => `${index + 1}. ${step}`),
    ...(task.url ? ['', task.url] : [])
  ].join('\n')

  ui.note(body, task.title)

  if (task.url && context.openBrowser) {
    const opened = await openUrl(context, task.url)
    if (!opened) ui.log.info('Could not open a browser here — the link above is the one to use.')
  }

  const prompt = task.prompt ?? 'Press Enter once you have done this'

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    await ui.pause(prompt)

    if (!task.verify) return 'assumed'

    const checking = ui.spinner()
    checking.start('Checking')
    const { enabled, detail } = await task.verify()
    checking.stop(detail)

    if (enabled) return 'verified'

    if (attempt === MAX_ATTEMPTS) break
    // Nobody is there to answer in a non-interactive shell, and asking would
    // hang the job. One check, then move on and report it.
    if (!ui.isInteractive()) return 'skipped'
    if (!(await ui.confirm('Check again?'))) return 'skipped'
  }

  ui.log.warn(`${task.title} could not be confirmed. The run will continue and say so at the end.`)
  return 'skipped'
}
