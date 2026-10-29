import type { TemplateOptions } from '../../options'

/** Lifted from the reference app's `src/lib/firebase-admin/admin.ts`. Re-extract with `tools/extract-reference.ts`. */
export const adminBarrelModule = (options: TemplateOptions): string =>
  `export * from './admin-core'
`
