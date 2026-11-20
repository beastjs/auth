import { describe, expect, mock, test } from 'bun:test'
import { ProjectIdTakenError } from '../src/google/firebase-api'
import { emptyPlan } from '../src/step'

/**
 * Creating a project whose id Google says is taken.
 *
 * It used to throw Google's bare "Requested entity already exists" and leave
 * the "Creating…" spinner running, so the run looked hung. Now it stops the
 * spinner, says why, and asks for another id.
 */
describe('projectStep, creating a project whose id is taken', () => {
  test('stops the spinner, explains, and asks for another id', async () => {
    const answers = ['taken-id-1234', 'My App', 'fresh-id-1234']
    const asked: { message: string; validate?: (value: string) => string | undefined }[] = []
    const stops: { message?: string; code?: number }[] = []
    const warnings: string[] = []
    const noop = () => {}

    await mock.module('@clack/prompts', () => ({
      isCancel: () => false,
      select: async () => '\u0000create',
      text: async (options: { message: string; validate?: (value: string) => string | undefined }) => {
        asked.push(options)
        return answers.shift()
      },
      spinner: () => ({ start: noop, message: noop, stop: (message?: string, code?: number) => stops.push({ message, code }) }),
      log: { warn: (m: string) => warnings.push(m), info: noop, error: noop, success: noop, step: noop, message: noop }
    }))

    const { setInteractive } = await import('../src/prompts')
    const { projectStep } = await import('../src/steps/project')
    setInteractive(true)

    const attempts: string[] = []
    const context = {
      projectId: null,
      app: { appSlug: 'my-app' },
      api: {
        listProjects: async () => [],
        createProject: async (projectId: string, displayName: string) => {
          attempts.push(projectId)
          if (projectId === 'taken-id-1234') throw new ProjectIdTakenError(projectId)
          return { projectId, displayName }
        }
      }
    }

    try {
      await projectStep.apply(context as never, emptyPlan(''))
    } finally {
      setInteractive(null)
      mock.restore()
    }

    expect(attempts).toEqual(['taken-id-1234', 'fresh-id-1234'])
    expect(context.projectId).toBe('fresh-id-1234' as never)

    // The failed spinner was stopped as a failure, not left running.
    expect(stops).toContainEqual({ message: 'Could not create taken-id-1234', code: 2 })

    expect(warnings.join('\n')).toInclude('already taken')

    // Id, display name, then only the id again; the retry refuses the taken one.
    expect(asked.map((question) => question.message)).toEqual(['Project id', 'Display name', 'Project id'])
    expect(asked[2]?.validate?.('taken-id-1234')).toInclude('already taken')
  })
})
