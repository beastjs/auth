import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRunContext, type RunContext } from '../src/context'
import { detectApp } from '../src/detect'
import type { CommandRunner } from '../src/exec'
import { FirebaseApi } from '../src/google/firebase-api'
import { IamApi } from '../src/google/iam'
import type { TokenProvider } from '../src/google/credential'
import type { HttpClient } from '../src/http'
import { codegenStep, envStep } from '../src/steps/wire'

const WEB_CONFIG = {
  apiKey: 'AIzaTESTKEY',
  authDomain: 'temp-app-345.firebaseapp.com',
  projectId: 'temp-app-345',
  storageBucket: 'temp-app-345.appspot.com',
  messagingSenderId: '1234567890',
  appId: '1:1234567890:web:abcdef'
}

const ADMIN_CREDENTIAL = {
  projectId: 'temp-app-345',
  clientEmail: 'temp-app-admin@temp-app-345.iam.gserviceaccount.com',
  privateKey: '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END PRIVATE KEY-----\n',
  privateKeyId: 'keyid123'
}

const idleHttp: HttpClient = {
  async request() {
    throw new Error('no request should be made in this test')
  }
}

const idleRunner: CommandRunner = {
  async run() {
    throw new Error('no command should run in this test')
  },
  async which() {
    return null
  }
}

/** A directory that passes the beast-app check and nothing more. */
async function createFixtureApp(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'beast-auth-test-'))

  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ name: '@acme/temp-app', type: 'module', dependencies: { 'beast-tsrx': '0.7.1' } }, null, 2)
  )
  await writeFile(join(root, 'rsbuild.config.ts'), "import { beastOctane } from 'beast-tsrx/rsbuild'\n")
  await writeFile(join(root, '.env'), '# existing\nUNRELATED=keep\n')

  return root
}

const unusedTokens: TokenProvider = {
  async getAccessToken() {
    throw new Error('no token should be needed in this test')
  },
  async describe() {
    return 'test'
  }
}

async function contextFor(root: string): Promise<RunContext> {
  const app = await detectApp(root)
  const context = createRunContext({
    mode: 'apply',
    runner: idleRunner,
    http: idleHttp,
    tokens: unusedTokens,
    api: new FirebaseApi(idleHttp, unusedTokens),
    iam: new IamApi(idleHttp, unusedTokens),
    openBrowser: false,
    app,
    tools: { firebase: null, gcloud: null, bun: null, wrangler: null },
    flags: { noConsoles: true }
  })

  context.projectId = WEB_CONFIG.projectId
  context.webConfig = WEB_CONFIG
  context.adminCredential = ADMIN_CREDENTIAL

  return context
}

async function applyBoth(context: RunContext) {
  for (const step of [envStep, codegenStep]) {
    await step.apply(context, await step.plan(context))
  }
}

let root: string

beforeEach(async () => {
  root = await createFixtureApp()
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('wiring a fresh beast app', () => {
  test('detects the app and derives the slug from a scoped package name', async () => {
    const context = await contextFor(root)

    expect(context.app.hasBeastTsrx).toBe(true)
    expect(context.app.hasRsbuildConfig).toBe(true)
    expect(context.app.hasConvex).toBe(false)
    expect(context.app.appSlug).toBe('temp-app')
  })

  test('writes the client library and the claims model', async () => {
    await applyBoth(await contextFor(root))

    const client = await readFile(join(root, 'src/lib/firebase/index.ts'), 'utf8')
    expect(client).toInclude('import.meta.env.PUBLIC_FIREBASE_API_KEY')
    expect(client).toInclude('GoogleAuthProvider')

    const claims = await readFile(join(root, 'src/lib/firebase-admin/custom-claims.ts'), 'utf8')
    expect(claims).toInclude('FIREBASE_CUSTOM_CLAIMS_MAX_BYTES = 1000')
    // The fixture has no Convex, so the Convex-only extractor must not be here.
    expect(claims).not.toInclude("from 'convex/server'")
  })

  test('namespaces the remembered-accounts key to this app', async () => {
    await applyBoth(await contextFor(root))

    const accounts = await readFile(join(root, 'src/lib/firebase/accounts.ts'), 'utf8')
    expect(accounts).toInclude("'temp-app:accounts'")
  })

  test('writes the three env surfaces and preserves existing lines', async () => {
    await applyBoth(await contextFor(root))

    const env = await readFile(join(root, '.env'), 'utf8')
    expect(env).toInclude('UNRELATED=keep')
    expect(env).toInclude('PUBLIC_FIREBASE_API_KEY=AIzaTESTKEY')
    expect(env).toInclude('FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\n')

    const devVars = await readFile(join(root, '.dev.vars'), 'utf8')
    expect(devVars).toInclude('FIREBASE_CLIENT_EMAIL=')
    // The Worker mints ID tokens server-side, so it needs the web API key too.
    expect(devVars).toInclude('PUBLIC_FIREBASE_API_KEY=AIzaTESTKEY')

    const example = await readFile(join(root, '.env.example'), 'utf8')
    expect(example).toInclude('FIREBASE_PRIVATE_KEY=')
    expect(example).not.toInclude('AIzaTESTKEY')
    expect(example).not.toInclude('BEGIN PRIVATE KEY')
  })

  test('the private key never reaches .env.example', async () => {
    await applyBoth(await contextFor(root))

    const example = await readFile(join(root, '.env.example'), 'utf8')
    for (const line of example.split('\n').filter(Boolean)) {
      if (line.startsWith('#')) continue
      expect(line).toEndWith('=')
    }
  })

  test('a second run reports satisfied and changes nothing', async () => {
    const context = await contextFor(root)
    await applyBoth(context)

    const before = await readFile(join(root, '.env'), 'utf8')

    expect(await envStep.detect(context)).toBe('satisfied')
    expect(await codegenStep.detect(context)).toBe('satisfied')

    await applyBoth(context)
    expect(await readFile(join(root, '.env'), 'utf8')).toBe(before)
  })

  test('a half-written integration reports partial, not absent', async () => {
    const context = await contextFor(root)
    await applyBoth(context)
    await rm(join(root, 'src/lib/firebase/auth.ts'))

    expect(await codegenStep.detect(context)).toBe('partial')
  })
})
