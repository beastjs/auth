#!/usr/bin/env node
import { parseArgs } from 'node:util'
import pc from 'picocolors'
import { toDisplayPath } from './codegen/emit'
import { createRunContext, type RunContext, type RunMode } from './context'
import { detectApp, detectTools, findBlockingProblems } from './detect'
import { systemCommandRunner } from './exec'
import { createTokenProvider, NoGoogleCredentialError } from './google/credential'
import { FirebaseApi } from './google/firebase-api'
import { systemHttpClient } from './http'
import * as ui from './prompts'
import type { Step } from './step'
import { authorizedDomainsStep, googleProviderStep } from './steps/auth-provider'
import { consolesStep } from './steps/consoles'
import { editsStep } from './steps/edits'
import { googleAuthStep, projectStep, webAppStep } from './steps/project'
import { codegenStep, envStep, installStep, verifyStep } from './steps/wire'

const USAGE = `
${pc.bold('beast-auth')} — wire Firebase into a beast app

  ${pc.dim('bunx @beastjs/auth')} [options]

Options
  --consoles <a,b>   Console subdomains to generate (default: prompted)
  --no-consoles      Firebase only, no console subdomains
  --root-domain <d>  The domain the app is served from
  --no-browser       Never open a browser for a manual step
  --dry-run          Show every file that would change, write nothing
  --check            Exit 1 when the generated files are out of date
  -h, --help         Print this
`.trimStart()

/**
 * Order matters. The provider and the authorized domains come before anything
 * that signs a user in, because `auth/operation-not-allowed` and
 * `auth/unauthorized-domain` are exactly what a sign-in fails with when they are
 * not done — and both are manual steps the run has to wait for.
 */
const STEPS: readonly Step[] = [
  googleAuthStep,
  projectStep,
  webAppStep,
  consolesStep,
  googleProviderStep,
  authorizedDomainsStep,
  installStep,
  envStep,
  codegenStep,
  editsStep,
  verifyStep
]

/**
 * Runs the steps in order: detect, then plan, then apply.
 *
 * A step that reports `satisfied` is announced and skipped, which is what makes
 * a second run cheap and a resumed run safe. In `dry-run` and `check` the loop
 * stops after `plan`, so neither mode can reach a write.
 */
async function runSteps(context: RunContext): Promise<{ pendingWrites: number }> {
  let pendingWrites = 0

  for (const step of STEPS) {
    if (step.skip?.(context)) continue

    const state = await step.detect(context)

    if (state === 'satisfied') {
      ui.log.success(`${step.title} — already up to date`)
      continue
    }

    const plan = await step.plan(context)

    if (context.mode !== 'apply') {
      pendingWrites += plan.writes.length
      ui.log.step(`${step.title} — ${plan.summary}`)
      for (const write of plan.writes) {
        ui.log.message(pc.dim(`  ${toDisplayPath(context.app.root, write.path)}`))
      }
      continue
    }

    ui.log.step(step.title)
    await step.apply(context, plan)
  }

  return { pendingWrites }
}

function reportNextSteps(context: RunContext) {
  const unfinished = context.manual.filter((record) => record.outcome !== 'verified')

  const lines = [
    `Project      ${context.projectId ?? 'not set'}`,
    `Console      https://console.firebase.google.com/project/${context.projectId ?? ''}/overview`
  ]

  const verified = context.manual.filter((record) => record.outcome === 'verified')
  if (verified.length > 0) {
    lines.push('', pc.bold('Confirmed'), ...verified.map((record) => `  \u2713 ${record.title}`))
  }

  if (unfinished.length > 0) {
    lines.push(
      '',
      pc.bold('Not confirmed'),
      ...unfinished.flatMap((record) => [
        `  ${record.outcome === 'skipped' ? '\u2717' : '?'} ${record.title}`,
        ...(record.url ? [pc.dim(`     ${record.url}`)] : [])
      ])
    )
  }

  lines.push(
    '',
    pc.bold('Still yours to do'),
    '  Grant yourself the founder claims once you can sign in:',
    pc.dim('     bun run fb:claims -- --email you@example.com --claims \'{"topg":true,"god":true,"admin":true}\' --merge')
  )

  if (context.consoles.length > 0) {
    lines.push(
      '',
      pc.bold('Consoles chosen'),
      ...context.consoles.map(
        (console_) => `  ${console_.label} — verifies \`${console_.claim}\`, local fallback ${console_.routePrefix}`
      ),
      pc.dim('  Routing, Worker routes and pageholders are not generated yet.')
    )
  }

  ui.note(lines.join('\n'), 'Next')
}

async function main() {
  const { values } = parseArgs({
    options: {
      consoles: { type: 'string' },
      'no-consoles': { type: 'boolean', default: false },
      'root-domain': { type: 'string' },
      'no-browser': { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      check: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false }
    },
    allowPositionals: false
  })

  if (values.help) {
    process.stdout.write(USAGE)
    return
  }

  const mode: RunMode = values.check ? 'check' : values['dry-run'] ? 'dry-run' : 'apply'

  ui.intro(pc.bgCyan(pc.black(' beast-auth ')))

  const root = process.cwd()
  const [app, tools] = await Promise.all([detectApp(root), detectTools(systemCommandRunner)])
  const problems = findBlockingProblems(app, tools)

  if (problems.length > 0) {
    for (const problem of problems) {
      ui.log.error(problem.reason)
      ui.log.message(pc.dim(`  ${problem.remedy}`))
    }
    ui.outro(pc.red('Nothing was changed.'))
    process.exitCode = 1
    return
  }

  ui.log.info(
    `${app.appSlug} — rsbuild + beast-tsrx${app.hasConvex ? ', Convex' : ''}${app.hasWranglerConfig ? ', Cloudflare Worker' : ''}`
  )

  const tokens = createTokenProvider(systemCommandRunner)

  const context = createRunContext({
    mode,
    runner: systemCommandRunner,
    http: systemHttpClient,
    tokens,
    api: new FirebaseApi(systemHttpClient, tokens),
    openBrowser: !values['no-browser'],
    app,
    tools,
    flags: {
      consoles: values.consoles,
      noConsoles: values['no-consoles'] === true,
      rootDomain: values['root-domain']
    }
  })

  const { pendingWrites } = await runSteps(context)

  if (mode === 'check') {
    if (pendingWrites > 0) {
      ui.outro(pc.red(`${pendingWrites} generated file(s) are out of date. Run \`bunx @beastjs/auth\`.`))
      process.exitCode = 1
      return
    }
    ui.outro(pc.green('Everything is up to date.'))
    return
  }

  if (mode === 'dry-run') {
    ui.outro(pc.cyan(`${pendingWrites} file(s) would change. Nothing was written.`))
    return
  }

  reportNextSteps(context)
  ui.outro(pc.green('Firebase is wired in.'))
}

main().catch((error: unknown) => {
  if (error instanceof ui.UserAbort) {
    ui.outro(pc.yellow('Nothing was changed.'))
    return
  }

  if (error instanceof NoGoogleCredentialError) {
    ui.log.error(error.message)
    ui.outro(pc.red('Nothing was changed.'))
    process.exitCode = 1
    return
  }

  ui.log.error(error instanceof Error ? error.message : 'Something went wrong.')
  ui.outro(pc.red('Stopped.'))
  process.exitCode = 1
})
