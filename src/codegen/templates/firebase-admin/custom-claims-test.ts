import type { TemplateOptions } from '../../options'

/** Lifted from the reference app's `src/lib/firebase-admin/custom-claims.test.ts`. Re-extract with `tools/extract-reference.ts`. */
export const customClaimsTestModule = (options: TemplateOptions): string =>
  `import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  canManageFirebaseAccessClaim,
  canReceiveFirebaseClaimGrant,
  canViewTopgFirebaseUser,
  isFirebaseCustomClaimName,
  isFirebaseManagedAccessClaimName,
  isPrivilegedFirebaseCustomClaimName,
  updateFirebaseAdminClaim,
  updateFirebaseManagedAccessClaim
} from './custom-claims'

describe('Firebase custom claim names', () => {
  test('accepts bounded application claim names', () => {
    assert.equal(isFirebaseCustomClaimName('role'), true)
    assert.equal(isFirebaseCustomClaimName('app.editor'), true)
    assert.equal(isFirebaseCustomClaimName('feature_flag-2'), true)
  })

  test('rejects reserved, unsafe, malformed, and untrimmed names', () => {
    assert.equal(isFirebaseCustomClaimName('sub'), false)
    assert.equal(isFirebaseCustomClaimName('constructor'), false)
    assert.equal(isFirebaseCustomClaimName('__proto__'), false)
    assert.equal(isFirebaseCustomClaimName('2fa'), false)
    assert.equal(isFirebaseCustomClaimName(' role'), false)
    assert.equal(isFirebaseCustomClaimName('role/name'), false)
  })

  test('keeps privileged claims out of the general claim editor', () => {
    assert.equal(isPrivilegedFirebaseCustomClaimName('admin'), true)
    assert.equal(isPrivilegedFirebaseCustomClaimName('god'), true)
    assert.equal(isPrivilegedFirebaseCustomClaimName('topg'), true)
    assert.equal(isPrivilegedFirebaseCustomClaimName('role'), false)
    assert.equal(isFirebaseCustomClaimName('admin'), false)
    assert.equal(isFirebaseCustomClaimName('god'), false)
    assert.equal(isFirebaseCustomClaimName('topg'), false)
    assert.equal(isFirebaseManagedAccessClaimName('admin'), true)
    assert.equal(isFirebaseManagedAccessClaimName('god'), true)
    assert.equal(isFirebaseManagedAccessClaimName('topg'), false)
  })
})

describe('Firebase admin claim updates', () => {
  test('grants admin without changing other claims', () => {
    assert.deepEqual(updateFirebaseAdminClaim({ role: 'staff', topg: true }, true), {
      admin: true,
      role: 'staff',
      topg: true
    })
  })

  test('revokes only admin and preserves every other claim', () => {
    assert.deepEqual(updateFirebaseAdminClaim({ admin: true, role: 'staff', topg: true }, false), {
      role: 'staff',
      topg: true
    })
  })

  test('manages god without changing other claims', () => {
    assert.deepEqual(updateFirebaseManagedAccessClaim({ admin: true, region: 'apac' }, 'god', true), {
      admin: true,
      god: true,
      region: 'apac'
    })
  })
})

describe('Firebase privileged claim authorization', () => {
  test('only allows claim grants to users with a verified email', () => {
    assert.equal(canReceiveFirebaseClaimGrant({ email: 'verified@example.com', emailVerified: true }), true)
    assert.equal(canReceiveFirebaseClaimGrant({ email: 'unverified@example.com', emailVerified: false }), false)
    assert.equal(canReceiveFirebaseClaimGrant({ email: null, emailVerified: true }), false)
    assert.equal(canReceiveFirebaseClaimGrant({ email: '   ', emailVerified: true }), false)
  })

  test('keeps god claim management restricted to topg', () => {
    assert.equal(canManageFirebaseAccessClaim({ topg: true }, 'god'), true)
    assert.equal(canManageFirebaseAccessClaim({ admin: true }, 'god'), false)
  })

  test('keeps admin claim management restricted to topg', () => {
    assert.equal(canManageFirebaseAccessClaim({ topg: true }, 'admin'), true)
    assert.equal(canManageFirebaseAccessClaim({ admin: true }, 'admin'), false)
  })

  test('only exposes topg targets to topg actors', () => {
    assert.equal(canViewTopgFirebaseUser({ admin: true }, { topg: true }), false)
    assert.equal(canViewTopgFirebaseUser({ admin: true, topg: true }, { topg: true }), true)
    assert.equal(canViewTopgFirebaseUser({ admin: true }, { god: true }), true)
  })
})
`
