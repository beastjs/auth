import type { TemplateOptions } from '../../options'

/** Lifted from the reference app's `src/lib/firebase-admin/admin-core.test.ts`. Re-extract with `tools/extract-reference.ts`. */
export const adminCoreTestModule = (options: TemplateOptions): string =>
  `import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import { getFirebaseServiceAccountKeyId } from './admin-core'

const OWNED = ['FIREBASE_PRIVATE_KEY_ID', 'FIREBASE_SERVICE_ACCOUNT_KEY'] as const

function setEnv(values: Partial<Record<(typeof OWNED)[number], string>>) {
  for (const name of OWNED) {
    const value = values[name]
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
}

afterEach(() => setEnv({}))

describe('service account key id', () => {
  test('reads the dedicated variable', () => {
    setEnv({ FIREBASE_PRIVATE_KEY_ID: 'abc123' })
    assert.equal(getFirebaseServiceAccountKeyId(), 'abc123')
  })

  test('strips the quotes a copied secret keeps', () => {
    setEnv({ FIREBASE_PRIVATE_KEY_ID: '"abc123"' })
    assert.equal(getFirebaseServiceAccountKeyId(), 'abc123')
  })

  test('falls back to the field inside a service account blob', () => {
    setEnv({ FIREBASE_SERVICE_ACCOUNT_KEY: JSON.stringify({ private_key_id: 'from-blob' }) })
    assert.equal(getFirebaseServiceAccountKeyId(), 'from-blob')
  })

  test('prefers the dedicated variable over the blob', () => {
    setEnv({
      FIREBASE_PRIVATE_KEY_ID: 'explicit',
      FIREBASE_SERVICE_ACCOUNT_KEY: JSON.stringify({ private_key_id: 'from-blob' })
    })
    assert.equal(getFirebaseServiceAccountKeyId(), 'explicit')
  })

  test('answers null when neither is configured, and on an unparseable blob', () => {
    assert.equal(getFirebaseServiceAccountKeyId(), null)
    setEnv({ FIREBASE_SERVICE_ACCOUNT_KEY: '{not json' })
    assert.equal(getFirebaseServiceAccountKeyId(), null)
  })
})
`
