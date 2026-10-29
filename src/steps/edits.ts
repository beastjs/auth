import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { toDisplayPath } from '../codegen/emit'
import type { TemplateOptions } from '../codegen/options'
import type { RunContext } from '../context'
import { editEnvTypes, editPackageJson, editRouter, editWorker, editWranglerConfig } from '../edits/app-edits'
import type { EditOutcome } from '../edits/anchored'
import * as ui from '../prompts'
import { emptyPlan, type Step } from '../step'

type Edit = {
  readonly what: string
  /** Null when the app has no such file, which is not always a problem. */
  readonly path: string | null
  readonly apply: (source: string, options: TemplateOptions) => EditOutcome
}

const templateOptions = (context: RunContext): TemplateOptions => ({
  appSlug: context.app.appSlug,
  hasConvex: context.app.hasConvex,
  consoles: context.consoles,
  rootDomain: context.rootDomain
})

function resolveEdits(context: RunContext): readonly Edit[] {
  const { root } = context.app
  const wrangler = ['wrangler.jsonc', 'wrangler.json'].map((name) => join(root, name)).find((path) => existsSync(path))

  return [
    { what: 'the Worker dispatch', path: context.app.workerPath, apply: editWorker },
    { what: 'the router', path: context.app.routerPath, apply: editRouter },
    { what: 'the env types', path: context.app.envTypesPath, apply: editEnvTypes },
    { what: 'the Wrangler config', path: wrangler ?? null, apply: (source) => editWranglerConfig(source) },
    { what: 'the package scripts', path: join(root, 'package.json'), apply: (source) => editPackageJson(source) }
  ]
}

/**
 * Changes the five files the app already owns.
 *
 * Each change is a marker-wrapped block or one narrow textual replacement, and
 * each one refuses rather than guesses: a file whose anchor cannot be found is
 * reported with the lines to paste. Mangling a file the user wrote is worse than
 * asking them to add two lines.
 */
export const editsStep: Step = {
  id: 'edits.app',
  title: 'Wiring into the app',

  skip: (context) => context.mode === 'check' || context.consoles.length === 0,

  async detect(context) {
    const options = templateOptions(context)
    let changed = 0
    let total = 0

    for (const edit of resolveEdits(context)) {
      if (edit.path === null || !existsSync(edit.path)) continue
      total += 1
      if (edit.apply(await readFile(edit.path, 'utf8'), options).kind !== 'unchanged') changed += 1
    }

    if (total === 0 || changed === 0) return 'satisfied'

    return changed === total ? 'absent' : 'partial'
  },

  async plan(context) {
    return emptyPlan(`Wire the consoles into ${resolveEdits(context).filter((edit) => edit.path !== null).length} existing files.`)
  },

  async apply(context) {
    const options = templateOptions(context)

    for (const edit of resolveEdits(context)) {
      if (edit.path === null || !existsSync(edit.path)) {
        ui.log.warn(`Skipped ${edit.what}: this app has no such file.`)
        continue
      }

      const display = toDisplayPath(context.app.root, edit.path)
      const outcome = edit.apply(await readFile(edit.path, 'utf8'), options)

      if (outcome.kind === 'unchanged') {
        ui.log.success(`${display} — already wired`)
        continue
      }

      if (outcome.kind === 'blocked') {
        // Recorded as a manual task so the final report carries it, rather than
        // scrolling past in the middle of a run.
        context.manual.push({ title: `${edit.what} (${display})`, outcome: 'skipped' })
        ui.log.warn(`${display} — ${outcome.reason}`)
        if (outcome.snippet.length > 0) ui.note(outcome.snippet.join('\n'), `Add this to ${display}`)
        continue
      }

      await writeFile(edit.path, outcome.contents, 'utf8')
      ui.log.success(`${display} — wired`)
    }
  }
}
