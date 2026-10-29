import type { ConsoleSpec } from '../context'

export type TemplateOptions = {
  /** Seeds cookie names and the remembered-accounts storage key. */
  readonly appSlug: string
  /** Whether `convex` is a dependency — decides if Convex-only code is emitted at all. */
  readonly hasConvex: boolean
  readonly consoles: readonly ConsoleSpec[]
}

/**
 * Removes a tagged region, markers included.
 *
 * Templates carry optional code inline rather than in a second copy of the file,
 * so the lifted source stays a faithful mirror of the reference and only the
 * renderer decides what a given app gets.
 */
export function stripRegion(source: string, tag: string): string {
  const pattern = new RegExp(`[ \\t]*// @beast-auth:${tag}-start\\n[\\s\\S]*?// @beast-auth:${tag}-end\\n?`, 'g')
  return source.replace(pattern, '')
}

/** Keeps a tagged region's contents and drops only its markers. */
export function keepRegion(source: string, tag: string): string {
  return source
    .replace(new RegExp(`[ \\t]*// @beast-auth:${tag}-start\\n`, 'g'), '')
    .replace(new RegExp(`[ \\t]*// @beast-auth:${tag}-end\\n`, 'g'), '')
}

/** Resolves every tagged region in one pass: `convex` survives only in a Convex app. */
export function resolveRegions(source: string, options: TemplateOptions): string {
  const resolved = options.hasConvex ? keepRegion(source, 'convex') : stripRegion(source, 'convex')
  // A stripped region can leave a doubled blank line where it used to sit.
  return resolved.replace(/\n{3,}/g, '\n\n')
}
