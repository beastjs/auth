import { describe, expect, mock, test } from 'bun:test'

/**
 * Forces the exact value `@clack/core` produces when someone presses Enter on a
 * text prompt with no `defaultValue`.
 *
 * Its TextPrompt finalizes with `this.value || (this.value = opts.defaultValue)`,
 * so the result is `undefined` while the declared type says `string`. A real run
 * crashed on the first `.trim()` downstream. This pins the coercion that fixes
 * it, which no amount of driving a real terminal would do reliably.
 */
describe('text() when the person just presses Enter', () => {
  test('returns an empty string, never undefined', async () => {
    await mock.module('@clack/prompts', () => ({
      isCancel: () => false,
      text: async () => undefined,
      log: { warn: () => {}, info: () => {}, error: () => {}, success: () => {}, step: () => {}, message: () => {} }
    }))

    const { setInteractive, text } = await import('../src/prompts')
    setInteractive(true)

    try {
      const answer = await text('What domain is the app served from? (Enter to skip)')

      expect(answer).toBe('')
      expect(typeof answer).toBe('string')
      // The call that used to throw.
      expect(() => answer.trim()).not.toThrow()
    } finally {
      setInteractive(null)
      mock.restore()
    }
  })
})
