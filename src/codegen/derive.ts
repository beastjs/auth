import type { ConsoleSpec } from '../context'

/**
 * Everything a template needs to name things for one console, derived from its
 * label so the pieces cannot drift apart.
 */
export type Console = {
  /** The DNS label, e.g. `asgard`. */
  readonly label: string
  /** Symbol stem, e.g. `asgard`. */
  readonly camel: string
  /** Type and function stem, e.g. `Asgard`. */
  readonly pascal: string
  /** Env-var stem, e.g. `ASGARD`. */
  readonly upper: string
  /** Title case for prose and aria labels. */
  readonly title: string
  /** The custom claim that admits a session here. */
  readonly claim: string
  /** The only claim allowed to grant that one. */
  readonly grantClaim: string
  /**
   * Where the console mounts on the main origin, and also its handoff path.
   *
   * One path, not two. The reference splits these for `admin`
   * (`/admin` plus `/admin-handoff`) and unifies them for `asgard`; the split is
   * Next.js residue, so the unified shape is what gets generated.
   */
  readonly routePrefix: string
  /** The cookie this console's session lives in. */
  readonly cookieName: string
  /** Prefix for its Worker API routes. */
  readonly apiPrefix: string
  /** Prefix for its CSS class names and stylesheet. */
  readonly cssPrefix: string
}

const toPascal = (label: string) =>
  label
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1).toLowerCase())
    .join('')

const toCamel = (label: string) => {
  const pascal = toPascal(label)
  return pascal[0]?.toLowerCase() + pascal.slice(1)
}

/**
 * The claim that may grant a console's claim.
 *
 * `topg` for everything, matching the reference: `canManageFirebaseAccessClaim`
 * lets only `topg` hand out `admin` or `god`, which is what stops a console from
 * being a one-person system with no way to add the second person.
 */
const GRANT_CLAIM = 'topg'

export function derive(spec: ConsoleSpec, appSlug: string): Console {
  const label = spec.label.toLowerCase()

  return {
    label,
    camel: toCamel(label),
    pascal: toPascal(label),
    upper: label.replace(/[^a-z0-9]+/g, '_').toUpperCase(),
    title: toPascal(label),
    claim: spec.claim,
    grantClaim: GRANT_CLAIM,
    routePrefix: spec.routePrefix,
    cookieName: `${appSlug}-${label}-session`,
    apiPrefix: `/api/${label}`,
    cssPrefix: label
  }
}

export const deriveAll = (specs: readonly ConsoleSpec[], appSlug: string): readonly Console[] =>
  specs.map((spec) => derive(spec, appSlug))
