import * as clack from '@clack/prompts'
import pc from 'picocolors'

export class UserAbort extends Error {
  constructor() {
    super('Nothing was changed.')
    this.name = 'UserAbort'
  }
}

/** Ctrl-C is an answer, not a crash: every prompt funnels through here. */
function unwrap<T>(value: T | symbol): T {
  if (clack.isCancel(value)) throw new UserAbort()
  return value as T
}

export type SelectOption<T> = { readonly value: T; readonly label: string; readonly hint?: string }

let interactiveOverride: boolean | null = null

/**
 * Whether there is somebody who can answer a question.
 *
 * Read through here rather than from `process.stdin.isTTY` at each call site, so
 * it is one property of the run instead of ambient state consulted in several
 * places — and so a test can pin it. A test that reads the real terminal passes
 * or hangs depending on where it runs, which is not a test.
 */
export function isInteractive(): boolean {
  return interactiveOverride ?? process.stdin.isTTY === true
}

/** Pins interactivity. `null` restores the real terminal. Tests and `--yes` use this. */
export function setInteractive(value: boolean | null): void {
  interactiveOverride = value
}

/**
 * Refuses to ask a question nobody can answer.
 *
 * In a non-interactive shell a prompt does not fail — it waits, forever, which
 * wedges a CI job with no output to explain itself. Every question this CLI asks
 * has a flag that answers it, so the refusal names the question and stops.
 */
function requireInteractive(message: string): void {
  if (isInteractive()) return

  throw new Error(
    `Cannot ask "${message}" — this is not an interactive terminal. Pass the matching flag (see --help) instead.`
  )
}

export const intro = (message: string) => clack.intro(message)
export const outro = (message: string) => clack.outro(message)
export const note = (body: string, title?: string) => clack.note(body, title)
export const log = clack.log
export const spinner = clack.spinner

export async function select<T>(message: string, options: readonly SelectOption<T>[]): Promise<T> {
  requireInteractive(message)
  return unwrap(await clack.select({ message, options: [...options] as clack.Option<T>[] }))
}

export async function multiselect<T>(
  message: string,
  options: readonly SelectOption<T>[],
  initialValues: readonly T[]
): Promise<T[]> {
  requireInteractive(message)
  return unwrap(
    await clack.multiselect({
      message,
      options: [...options] as clack.Option<T>[],
      initialValues: [...initialValues],
      required: false
    })
  )
}

export async function text(
  message: string,
  options: { placeholder?: string; defaultValue?: string; validate?: (value: string) => string | undefined } = {}
): Promise<string> {
  requireInteractive(message)
  return unwrap(
    await clack.text({
      message,
      placeholder: options.placeholder,
      defaultValue: options.defaultValue,
      validate: (value) => options.validate?.(value ?? '')
    })
  )
}

export async function confirm(message: string, initialValue = true): Promise<boolean> {
  requireInteractive(message)
  return unwrap(await clack.confirm({ message, initialValue }))
}

/**
 * Blocks until the user presses Enter.
 *
 * The manual steps are things only the user can do — clicking a toggle in a
 * console, adding a DNS record — and the steps after them depend on the result,
 * so the run waits rather than racing ahead and failing further down.
 *
 * In a non-interactive shell there is nobody to press anything. Blocking there
 * would hang a CI job forever, so it says what it would have waited for and
 * carries on.
 */
export async function pause(message = 'Press Enter to continue'): Promise<void> {
  if (!isInteractive()) {
    log.warn(`${message} — skipped, nothing here can answer.`)
    return
  }

  const readline = await import('node:readline/promises')
  const io = readline.createInterface({ input: process.stdin, output: process.stdout })

  try {
    await io.question(`${pc.cyan("│")}  ${message} `)
  } finally {
    io.close()
  }
}
