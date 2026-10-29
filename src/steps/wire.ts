import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { buildFirebaseManifest } from '../codegen/manifest'
import { detectWrites, emitAll, toDisplayPath } from '../codegen/emit'
import type { RunContext } from '../context'
import { buildEnvWrites } from '../env-file'
import { runOrThrow } from '../exec'
import * as ui from '../prompts'
import { emptyPlan, type Step, type StepPlan } from '../step'

const templateOptions = (context: RunContext) => ({
  appSlug: context.app.appSlug,
  hasConvex: context.app.hasConvex,
  consoles: context.consoles
})

async function envWrites(context: RunContext) {
  if (context.webConfig === null) return []
  return await buildEnvWrites(context.app.root, context.webConfig, context.adminCredential)
}

/**
 * Writes the client config and, when there is one, the admin credential across
 * the env surfaces this stack actually reads.
 *
 * `detect` compares against what the files would become rather than whether they
 * exist, so a re-run that changes nothing reports `satisfied` and writes nothing.
 */
export const envStep: Step = {
  id: 'env.files',
  title: 'Environment files',

  async detect(context) {
    return await detectWrites(await envWrites(context))
  },

  async plan(context): Promise<StepPlan> {
    const writes = await envWrites(context)
    return {
      summary: `Write Firebase values into ${writes.map((write) => toDisplayPath(context.app.root, write.path)).join(', ')}.`,
      writes,
      // Values are never echoed; the names are what the user needs to see.
      notes: []
    }
  },

  async apply(_context, plan) {
    await emitAll(plan.writes)
  }
}

/** Installs the two runtime packages the generated code imports. */
export const installStep: Step = {
  id: 'deps.install',
  title: 'firebase and firebase-admin',

  skip: (context) => context.mode === 'check',

  async detect(context) {
    const client = existsSync(join(context.app.root, 'node_modules', 'firebase', 'package.json'))
    const admin = existsSync(join(context.app.root, 'node_modules', 'firebase-admin', 'package.json'))
    if (client && admin) return 'satisfied'
    return client || admin ? 'partial' : 'absent'
  },

  async plan() {
    return emptyPlan('Run `bun add firebase firebase-admin`.')
  },

  async apply(context) {
    const installing = ui.spinner()
    installing.start('Installing firebase and firebase-admin')
    // Through the package manager rather than by editing package.json, so the
    // lockfile stays truthful.
    await runOrThrow(context.runner, 'bun', ['add', 'firebase', 'firebase-admin'], { cwd: context.app.root })
    installing.stop('Installed firebase and firebase-admin')
  }
}

/** Emits the firebase and firebase-admin libraries, plus their tests. */
export const codegenStep: Step = {
  id: 'codegen.firebase',
  title: 'lib/firebase and lib/firebase-admin',

  async detect(context) {
    return await detectWrites(buildFirebaseManifest(context.app.root, templateOptions(context)))
  },

  async plan(context): Promise<StepPlan> {
    const writes = buildFirebaseManifest(context.app.root, templateOptions(context))
    return {
      summary: `Generate ${writes.length} files under src/lib and scripts.`,
      writes,
      notes: []
    }
  },

  async apply(context, plan) {
    const outcomes = await emitAll(plan.writes)
    const created = [...outcomes.values()].filter((outcome) => outcome === 'created').length
    const replaced = [...outcomes.values()].filter((outcome) => outcome === 'replaced').length
    ui.log.success(`${created} file${created === 1 ? '' : 's'} created, ${replaced} replaced.`)
  }
}

/**
 * Proves the generated code compiles against the app it was written into.
 *
 * A failure is reported rather than thrown: everything is already on disk, and a
 * type error is a local thing the user can see and fix, so the run finishes and
 * says so instead of unwinding.
 */
export const verifyStep: Step = {
  id: 'verify.typecheck',
  title: 'Typecheck',

  // Nothing was written in a dry run or a check, so there is nothing to prove.
  skip: (context) => context.mode !== 'apply',

  async detect() {
    return 'absent'
  },

  async plan() {
    return emptyPlan('Run the app’s typecheck over the generated code.')
  },

  async apply(context) {
    const checking = ui.spinner()
    checking.start('Typechecking')
    const result = await context.runner.run('bun', ['run', 'typecheck'], { cwd: context.app.root })

    if (result.code === 0) {
      checking.stop('Typecheck passed')
      return
    }

    checking.stop('Typecheck failed')
    ui.log.warn('The generated files are written, but the app does not typecheck yet.')
    ui.note(result.stdout.trim().split('\n').slice(-20).join('\n') || result.stderr.trim(), 'typecheck output')
  }
}
