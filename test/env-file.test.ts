import { describe, expect, test } from 'bun:test'
import { adminCredentialEntries, formatEnvLine, upsertEnvContents } from '../src/env-file'

const PEM = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg\nkqhki==\n-----END PRIVATE KEY-----\n'

/**
 * Re-implements the reference app's own reader (`readEnvSecret` plus
 * `normalizePrivateKey` in `admin-core.ts`), so the round-trip is asserted
 * against the consumer's real behaviour rather than this writer's assumptions.
 */
function readBackLikeAdminCore(line: string): string {
  const raw = line.slice(line.indexOf('=') + 1).trim()
  const unquoted = raw.replace(/^(['"])([\s\S]*)\1$/, '$2').trim()
  return unquoted.replace(/\\n/g, '\n')
}

describe('formatEnvLine', () => {
  test('a PEM survives the round-trip through admin-core’s reader', () => {
    const line = formatEnvLine({ key: 'FIREBASE_PRIVATE_KEY', value: PEM })

    expect(line).toStartWith('FIREBASE_PRIVATE_KEY="')
    expect(line).not.toInclude('\n-----END')
    expect(readBackLikeAdminCore(line)).toBe(PEM)
  })

  test('the written PEM still announces itself, which admin-core requires', () => {
    const line = formatEnvLine({ key: 'FIREBASE_PRIVATE_KEY', value: PEM })
    expect(readBackLikeAdminCore(line)).toInclude('BEGIN PRIVATE KEY')
  })

  test('a plain value is left unquoted', () => {
    expect(formatEnvLine({ key: 'PUBLIC_FIREBASE_PROJECT_ID', value: 'my-app-345' })).toBe(
      'PUBLIC_FIREBASE_PROJECT_ID=my-app-345'
    )
  })

  test('an empty value writes a bare key, which is what .env.example needs', () => {
    expect(formatEnvLine({ key: 'FIREBASE_CLIENT_EMAIL', value: '' })).toBe('FIREBASE_CLIENT_EMAIL=')
  })
})

describe('upsertEnvContents', () => {
  test('replaces a key in place rather than appending a second definition', () => {
    const existing = '# mine\nPUBLIC_FIREBASE_PROJECT_ID=old\nOTHER=keep\n'
    const result = upsertEnvContents(existing, [{ key: 'PUBLIC_FIREBASE_PROJECT_ID', value: 'new' }])

    expect(result).toBe('# mine\nPUBLIC_FIREBASE_PROJECT_ID=new\nOTHER=keep\n')
    expect(result.match(/PUBLIC_FIREBASE_PROJECT_ID/g)).toHaveLength(1)
  })

  test('leaves unrelated lines and comments untouched', () => {
    const existing = '# a comment\nUNRELATED=1\n\n# another\nKEEP=2\n'
    const result = upsertEnvContents(existing, [{ key: 'NEW_KEY', value: 'x' }])

    expect(result).toInclude('# a comment')
    expect(result).toInclude('UNRELATED=1')
    expect(result).toInclude('# another')
    expect(result).toInclude('KEEP=2')
    expect(result).toInclude('NEW_KEY=x')
  })

  test('recognises an exported key, so it is replaced and not duplicated', () => {
    const result = upsertEnvContents('export FIREBASE_PROJECT_ID=old\n', [
      { key: 'FIREBASE_PROJECT_ID', value: 'new' }
    ])

    expect(result.match(/FIREBASE_PROJECT_ID/g)).toHaveLength(1)
    expect(result).toInclude('FIREBASE_PROJECT_ID=new')
  })

  test('is idempotent: writing the same entries twice changes nothing', () => {
    const entries = adminCredentialEntries({
      projectId: 'my-app-345',
      clientEmail: 'admin@my-app-345.iam.gserviceaccount.com',
      privateKey: PEM,
      privateKeyId: 'abc123'
    })

    const once = upsertEnvContents('', entries)
    expect(upsertEnvContents(once, entries)).toBe(once)
  })

  test('does not emit a key whose name is a prefix of another by accident', () => {
    const result = upsertEnvContents('FIREBASE_PROJECT_ID_EXTRA=keep\n', [
      { key: 'FIREBASE_PROJECT_ID', value: 'new' }
    ])

    expect(result).toInclude('FIREBASE_PROJECT_ID_EXTRA=keep')
    expect(result).toInclude('FIREBASE_PROJECT_ID=new')
  })
})
