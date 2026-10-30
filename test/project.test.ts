import { describe, expect, test } from 'bun:test'
import { validateProjectId } from '../src/steps/project'

const taken = new Set(['lucky-pick-345', 'abridge-global'])

describe('validateProjectId', () => {
  test('accepts nothing typed, so the suggested id can be taken by pressing Enter', () => {
    // It used to reject empty, which made the `defaultValue` it offers
    // impossible to accept: the only way to use the suggestion was to retype it.
    expect(validateProjectId('', taken)).toBeUndefined()
    expect(validateProjectId('   ', taken)).toBeUndefined()
  })

  test('accepts a well-formed id', () => {
    expect(validateProjectId('my-app-1234', taken)).toBeUndefined()
  })

  test('ignores surrounding whitespace when judging', () => {
    expect(validateProjectId('  my-app-1234  ', taken)).toBeUndefined()
  })

  test('refuses one the account already has, by name', () => {
    expect(validateProjectId('lucky-pick-345', taken)).toInclude('already have a project')
  })

  test('refuses what Google would refuse', () => {
    // Too short, uppercase, leading digit, trailing hyphen.
    for (const bad of ['abc', 'My-App-1234', '1my-app', 'my-app-']) {
      expect(validateProjectId(bad, taken)).toInclude('Six to thirty characters')
    }
  })
})
