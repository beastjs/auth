import { describe, expect, test } from 'bun:test'
import type { CommandResult, CommandRunner, RunOptions } from '../src/exec'
import {
  FirebaseAuthExpiredError,
  getWebConfig,
  isLoggedIn,
  listProjects
} from '../src/google/firebase-cli'

type Reply = Partial<CommandResult>

/**
 * A runner that answers from a script and records what it was asked.
 *
 * Nothing in these tests starts a process or reaches Google: the whole point of
 * routing every invocation through `CommandRunner` is that the orchestration can
 * be asserted offline.
 */
function fakeRunner(replies: Reply[]): CommandRunner & { calls: string[][] } {
  const calls: string[][] = []
  let index = 0

  return {
    calls,
    async run(command, args, _options?: RunOptions) {
      calls.push([command, ...args])
      const reply = replies[Math.min(index++, replies.length - 1)] ?? {}
      return { code: reply.code ?? 0, stdout: reply.stdout ?? '', stderr: reply.stderr ?? '' }
    },
    async which() {
      return '/usr/bin/firebase'
    }
  }
}

const envelope = (result: unknown) => JSON.stringify({ status: 'success', result })

describe('listProjects', () => {
  test('passes --json and sorts by project id', async () => {
    const runner = fakeRunner([
      { stdout: envelope([{ projectId: 'zeta-1' }, { projectId: 'alpha-2', displayName: 'Alpha' }]) }
    ])

    const projects = await listProjects(runner)

    expect(runner.calls[0]).toEqual(['firebase', 'projects:list', '--json'])
    expect(projects.map((project) => project.projectId)).toEqual(['alpha-2', 'zeta-1'])
  })

  test('reads the JSON body even when the CLI printed progress lines first', async () => {
    const runner = fakeRunner([
      { stdout: `- Preparing the list of your Firebase projects\n${envelope([{ projectId: 'a-project' }])}` }
    ])

    expect((await listProjects(runner)).map((project) => project.projectId)).toEqual(['a-project'])
  })

  test('a stale credential is its own error, because it has its own remedy', async () => {
    const runner = fakeRunner([
      {
        code: 1,
        stderr: 'Authentication Error: Your credentials are no longer valid. Please run firebase login --reauth'
      }
    ])

    await expect(listProjects(runner)).rejects.toThrow(FirebaseAuthExpiredError)
  })

  test('an error envelope carries the CLI’s own complaint forward', async () => {
    const runner = fakeRunner([
      { stdout: JSON.stringify({ status: 'error', error: 'Failed to list Firebase projects.' }) }
    ])

    await expect(listProjects(runner)).rejects.toThrow('Failed to list Firebase projects.')
  })
})

describe('isLoggedIn', () => {
  test('false for a stale credential', async () => {
    const runner = fakeRunner([{ code: 1, stderr: 'Your credentials are no longer valid.' }])
    expect(await isLoggedIn(runner)).toBe(false)
  })

  test('true when the cheapest authenticated call works', async () => {
    const runner = fakeRunner([{ stdout: envelope([]) }])
    expect(await isLoggedIn(runner)).toBe(true)
  })

  test('rethrows anything that is not an authentication problem', async () => {
    const runner = fakeRunner([{ code: 1, stderr: 'getaddrinfo ENOTFOUND firebase.googleapis.com' }])
    await expect(isLoggedIn(runner)).rejects.toThrow('ENOTFOUND')
  })
})

describe('getWebConfig', () => {
  const config = {
    apiKey: 'key',
    authDomain: 'my-app-345.firebaseapp.com',
    projectId: 'my-app-345',
    storageBucket: 'my-app-345.appspot.com',
    messagingSenderId: '123',
    appId: '1:123:web:abc'
  }

  test('accepts the config nested under sdkConfig', async () => {
    const runner = fakeRunner([{ stdout: envelope({ sdkConfig: config }) }])
    expect((await getWebConfig(runner, 'my-app-345', '1:123:web:abc')).projectId).toBe('my-app-345')
  })

  test('accepts the config returned flat', async () => {
    const runner = fakeRunner([{ stdout: envelope(config) }])
    expect((await getWebConfig(runner, 'my-app-345', '1:123:web:abc')).apiKey).toBe('key')
  })

  test('names the missing keys rather than handing back undefined', async () => {
    const { apiKey: _apiKey, appId: _appId, ...partial } = config
    const runner = fakeRunner([{ stdout: envelope({ sdkConfig: partial }) }])

    await expect(getWebConfig(runner, 'my-app-345', '1:123:web:abc')).rejects.toThrow(/apiKey, appId/)
  })
})
