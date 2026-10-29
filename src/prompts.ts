import * as clack from '@clack/prompts'

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

export const intro = (message: string) => clack.intro(message)
export const outro = (message: string) => clack.outro(message)
export const note = (body: string, title?: string) => clack.note(body, title)
export const log = clack.log
export const spinner = clack.spinner

export async function select<T>(message: string, options: readonly SelectOption<T>[]): Promise<T> {
  return unwrap(await clack.select({ message, options: [...options] as clack.Option<T>[] }))
}

export async function multiselect<T>(
  message: string,
  options: readonly SelectOption<T>[],
  initialValues: readonly T[]
): Promise<T[]> {
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
  return unwrap(await clack.confirm({ message, initialValue }))
}
