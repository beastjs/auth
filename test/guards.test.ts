import { describe, expect, test } from 'bun:test'
import { readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { toAppSlug } from '../src/detect'

const SOURCE_ROOT = join(import.meta.dirname, '..', 'src')

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)))
    else if (entry.name.endsWith('.ts')) files.push(path)
  }

  return files
}

describe('the process boundary', () => {
  test('only exec.ts spawns processes, which is what keeps the fakes honest', async () => {
    const offenders: string[] = []

    for (const path of await sourceFiles(SOURCE_ROOT)) {
      const relativePath = relative(SOURCE_ROOT, path)
      if (relativePath === 'exec.ts') continue
      // Templates are generated code, not this CLI's code.
      if (relativePath.startsWith('codegen/templates')) continue
      if ((await readFile(path, 'utf8')).includes("from 'node:child_process'")) offenders.push(relativePath)
    }

    expect(offenders).toEqual([])
  })
})

describe('toAppSlug', () => {
  test('drops a scope but keeps the leaf, which is what names the cookie', () => {
    expect(toAppSlug('@beastjs/lucky-pick')).toBe('lucky-pick')
  })

  test('makes a cookie-safe slug out of an awkward name', () => {
    expect(toAppSlug('My App!! v2')).toBe('my-app-v2')
  })

  test('falls back rather than producing an empty slug', () => {
    expect(toAppSlug('???')).toBe('app')
  })
})
