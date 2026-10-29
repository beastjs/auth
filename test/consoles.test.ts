import { describe, expect, test } from 'bun:test'
import { createRunContext, type RunContext, type RunFlags } from '../src/context'
import type { CommandRunner } from '../src/exec'
import { FirebaseApi } from '../src/google/firebase-api'
import { IamApi } from '../src/google/iam'
import type { TokenProvider } from '../src/google/credential'
import type { HttpClient } from '../src/http'
import { CONSOLE_PRESETS, consolesStep } from '../src/steps/consoles'

const unusedRunner: CommandRunner = {
  async run() {
    throw new Error('no command should run')
  },
  async which() {
    return null
  }
}

const unusedHttp: HttpClient = {
  async request() {
    throw new Error('no request should be made')
  }
}

const unusedTokens: TokenProvider = {
  async getAccessToken() {
    throw new Error('no token should be needed in this test')
  },
  async describe() {
    return 'test'
  }
}

function contextWith(flags: RunFlags): RunContext {
  return createRunContext({
    mode: 'apply',
    runner: unusedRunner,
    http: unusedHttp,
    tokens: unusedTokens,
    api: new FirebaseApi(unusedHttp, unusedTokens),
    iam: new IamApi(unusedHttp, unusedTokens),
    openBrowser: false,
    app: {
      root: '/app',
      appSlug: 'my-app',
      hasRsbuildConfig: true,
      hasBeastTsrx: true,
      hasConvex: false,
      hasWranglerConfig: true,
      hasResizablePanels: false,
      hasIconLibrary: false,
      routerPath: null,
      workerPath: null,
      envTypesPath: null,
      packageManager: 'bun'
    },
    tools: { firebase: null, gcloud: null, bun: null, wrangler: null },
    flags
  })
}

describe('the console presets', () => {
  test('asgard is the god tier and admin is the staff tier, as the reference has it', () => {
    expect(CONSOLE_PRESETS.map((preset) => [preset.label, preset.claim])).toEqual([
      ['asgard', 'god'],
      ['admin', 'admin']
    ])
  })

  test('each console has a same-origin fallback path for hosts with no subdomain', () => {
    for (const preset of CONSOLE_PRESETS) {
      expect(preset.routePrefix).toBe(`/${preset.label}`)
    }
  })
})

describe('consolesStep', () => {
  test('--consoles answers the question, so nothing is prompted', async () => {
    const context = contextWith({ noConsoles: false, consoles: 'asgard', rootDomain: 'example.com' })
    await consolesStep.apply(context, await consolesStep.plan(context))

    expect(context.consoles.map((preset) => preset.label)).toEqual(['asgard'])
    expect(context.rootDomain).toBe('example.com')
  })

  test('--no-consoles is a complete answer and skips the domain question too', async () => {
    const context = contextWith({ noConsoles: true })
    await consolesStep.apply(context, await consolesStep.plan(context))

    expect(context.consoles).toEqual([])
    expect(context.rootDomain).toBeNull()
  })

  test('an unknown label is refused by name rather than silently dropped', async () => {
    const context = contextWith({ noConsoles: false, consoles: 'asgard,nope' })

    await expect(consolesStep.apply(context, await consolesStep.plan(context))).rejects.toThrow(
      'No preset for the console nope.'
    )
  })

  test('the domain is normalised, so ADMIN.Example.COM cannot become a second host', async () => {
    const context = contextWith({ noConsoles: false, consoles: 'admin', rootDomain: '  Example.COM  ' })
    await consolesStep.apply(context, await consolesStep.plan(context))

    expect(context.rootDomain).toBe('example.com')
  })

  test('nothing is asked twice: an answered step reports satisfied', async () => {
    const context = contextWith({ noConsoles: false, consoles: 'asgard', rootDomain: 'example.com' })
    expect(await consolesStep.detect(context)).toBe('absent')

    await consolesStep.apply(context, await consolesStep.plan(context))
    expect(await consolesStep.detect(context)).toBe('satisfied')
  })

  test('it is skipped outside an apply run, since nothing gets generated', () => {
    expect(consolesStep.skip?.(contextWith({ noConsoles: false }))).toBe(false)
    expect(consolesStep.skip?.({ ...contextWith({ noConsoles: false }), mode: 'check' })).toBe(true)
    expect(consolesStep.skip?.({ ...contextWith({ noConsoles: false }), mode: 'dry-run' })).toBe(true)
  })
})

describe('prompting without a terminal', () => {
  test('refuses rather than hanging, and points at --help', async () => {
    // No --root-domain, so the step would have to ask. In a non-interactive
    // shell that used to wait forever.
    const context = contextWith({ noConsoles: false, consoles: 'asgard' })

    await expect(consolesStep.apply(context, await consolesStep.plan(context))).rejects.toThrow(
      /not an interactive terminal/
    )
  })
})
