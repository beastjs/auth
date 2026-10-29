import type { TemplateOptions } from '../../options'

/** Lifted from the reference app's `src/lib/firebase-admin/admin-users.test.ts`. Re-extract with `tools/extract-reference.ts`. */
export const adminUsersTestModule = (options: TemplateOptions): string =>
  `import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { toFirebaseAdminUserSummary } from './admin-users'

describe('Firebase admin user summaries', () => {
  test('returns only the account fields and claim metadata needed by the admin UI', () => {
    const summary = toFirebaseAdminUserSummary({
      customClaims: { admin: true, god: true, region: 'apac', topg: true },
      disabled: false,
      displayName: 'Ada Admin',
      email: 'ada@example.com',
      emailVerified: true,
      metadata: {
        creationTime: 'Wed, 01 Jan 2025 00:00:00 GMT',
        lastRefreshTime: null,
        lastSignInTime: 'Thu, 02 Jan 2025 00:00:00 GMT',
        toJSON: () => ({})
      },
      photoURL: 'https://images.example.com/ada.jpg',
      providerData: [
        {
          displayName: '',
          email: '',
          phoneNumber: '',
          photoURL: '',
          providerId: 'google.com',
          toJSON: () => ({}),
          uid: 'one'
        },
        {
          displayName: '',
          email: '',
          phoneNumber: '',
          photoURL: '',
          providerId: 'google.com',
          toJSON: () => ({}),
          uid: 'two'
        }
      ],
      uid: 'firebase-uid'
    })

    assert.deepEqual(summary, {
      admin: true,
      createdAt: 'Wed, 01 Jan 2025 00:00:00 GMT',
      customClaimNames: ['admin', 'god', 'region', 'topg'],
      disabled: false,
      displayName: 'Ada Admin',
      email: 'ada@example.com',
      emailVerified: true,
      lastSignInAt: 'Thu, 02 Jan 2025 00:00:00 GMT',
      photoUrl: 'https://images.example.com/ada.jpg',
      providerIds: ['google.com'],
      god: true,
      topg: true,
      uid: 'firebase-uid'
    })
  })
})
`
