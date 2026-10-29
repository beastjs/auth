import { deriveAll } from '../../derive'
import type { TemplateOptions } from '../../options'

const quote = (value: string) => `'${value.replace(/'/g, "\\'")}'`

/**
 * The tenant-style subdomain config.
 *
 * Kept deliberately small: the only function the rest of the system uses is
 * `getAllowedRootDomain`, and the reference's `subdomains/server.ts` is not
 * generated at all — it builds an empty `new Headers()` and so always reports
 * `localhost`, which is dead code wearing a useful name.
 */
export const subdomainsConfigModule = (options: TemplateOptions): string => {
  const consoles = deriveAll(options.consoles, options.appSlug)
  const allowed = ['localhost', ...(options.rootDomain === null ? [] : [options.rootDomain])]
  const reserved = ['www', 'api', ...consoles.map((console_) => console_.label)]

  return `/**
 * Which hostnames this app answers on, and which labels are not tenants.
 *
 * A console's label is reserved rather than routed: \`${consoles[0]?.label ?? 'admin'}.<domain>\` is a
 * surface of this app, not somebody's subdomain, so \`extractSubdomain\` must not
 * report it as one.
 */
export const SUBDOMAIN_CONFIG = {
  /** Tenant subdomains and the route each one maps to. */
  subdomains: {},

  /** The host with no subdomain in front of it. */
  rootDomain: ${quote(allowed[allowed.length - 1] ?? 'localhost')},

  /** Hostnames subdomain routing is active on. */
  allowedDomains: [${allowed.map(quote).join(', ')}],

  /** Labels that belong to this app rather than to a tenant. */
  reservedSubdomains: [${reserved.map(quote).join(', ')}]
} as const

export type SubdomainKey = keyof typeof SUBDOMAIN_CONFIG.subdomains

const normalizeDomain = (domain: string) => domain.trim().toLowerCase().replace(/:\\d+$/, '').replace(/\\.$/, '')

/**
 * The configured domain this hostname sits under, or null when it is none of
 * them. This is the one function the routing layer actually depends on.
 */
export function getAllowedRootDomain(hostname: string): string | null {
  const normalizedHostname = normalizeDomain(hostname)

  return (
    SUBDOMAIN_CONFIG.allowedDomains.find(
      (allowed) => normalizedHostname === allowed || normalizedHostname.endsWith(\`.\${allowed}\`)
    ) ?? null
  )
}

export function getSubdomainRoute(subdomain: string): string | null {
  const key = subdomain.toLowerCase() as SubdomainKey
  return SUBDOMAIN_CONFIG.subdomains[key] ?? null
}

export function isReservedSubdomain(subdomain: string): boolean {
  return SUBDOMAIN_CONFIG.reservedSubdomains.includes(
    subdomain.toLowerCase() as (typeof SUBDOMAIN_CONFIG.reservedSubdomains)[number]
  )
}

export function isAllowedDomain(domain: string): boolean {
  return getAllowedRootDomain(domain) !== null
}
`
}

export const subdomainsUtilsModule = (): string => `import { getAllowedRootDomain, isReservedSubdomain } from './config'

export type SubdomainInfo = {
  subdomain: string | null
  domain: string
  isSubdomain: boolean
}

/**
 * Pulls the tenant label out of a hostname.
 *
 * A reserved label answers \`null\`, because a console is a surface of this app
 * and not a tenant of it.
 */
export function extractSubdomain(hostname: string): SubdomainInfo {
  const firstHost = hostname.split(',')[0]?.trim() ?? ''
  let normalizedHostname = firstHost.toLowerCase().replace(/\\.$/, '')

  try {
    normalizedHostname = new URL(\`http://\${normalizedHostname}\`).hostname.toLowerCase().replace(/\\.$/, '')
  } catch {
    normalizedHostname = normalizedHostname.replace(/:\\d+$/, '')
  }

  const matchingDomain = getAllowedRootDomain(normalizedHostname)

  if (!matchingDomain) {
    return { subdomain: null, domain: normalizedHostname, isSubdomain: false }
  }

  if (normalizedHostname === matchingDomain) {
    return { subdomain: null, domain: matchingDomain, isSubdomain: false }
  }

  const subdomain = normalizedHostname.slice(0, -(matchingDomain.length + 1))

  if (isReservedSubdomain(subdomain)) {
    return { subdomain: null, domain: matchingDomain, isSubdomain: false }
  }

  return { subdomain, domain: matchingDomain, isSubdomain: true }
}

/** Reads the tenant label off a request, for use in the Worker. */
export function getSubdomainFromHeaders(headers: Headers): SubdomainInfo {
  const host = headers.get('x-forwarded-host') ?? headers.get('host') ?? 'localhost'
  return extractSubdomain(host)
}
`

export const subdomainsIndexModule = (): string => `export type { SubdomainKey } from './config'
export {
  getAllowedRootDomain,
  getSubdomainRoute,
  isAllowedDomain,
  isReservedSubdomain,
  SUBDOMAIN_CONFIG
} from './config'
export type { SubdomainInfo } from './utils'
export { extractSubdomain, getSubdomainFromHeaders } from './utils'
`

/**
 * Host arithmetic shared by every console.
 *
 * This is where the reference's Next.js residue dies: no
 * \`NEXT_PUBLIC_*_SUBDOMAIN_MODE\` tri-state, no \`*.vercel.app\` special case, and
 * the \`*.workers.dev\` guard — which the reference applies only to \`asgard\` —
 * applied once here, so every console is correct on Cloudflare.
 */
export const consoleHostModule = (options: TemplateOptions): string => {
  const consoles = deriveAll(options.consoles, options.appSlug)

  return `import { getAllowedRootDomain } from '@/lib/subdomains/config'

/**
 * Every console label this app has.
 *
 * Host arithmetic needs the whole set, not one label at a time: stripping a
 * console off a hostname means knowing which labels are consoles.
 */
export const CONSOLE_LABELS = [${consoles.map((console_) => `'${console_.label}'`).join(', ')}] as const

export function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\\.$/, '')
}

/** The hostname a request arrived on, from a possibly comma-joined Host header. */
export function getHostnameFromHostHeader(hostHeader: string | null | undefined): string | null {
  if (!hostHeader) return null

  const firstHost = hostHeader.split(',')[0]?.trim()
  if (!firstHost) return null

  try {
    return normalizeHostname(new URL(\`http://\${firstHost}\`).hostname)
  } catch {
    return normalizeHostname(firstHost.replace(/:\\d+$/, ''))
  }
}

export function isIpHostname(hostname: string): boolean {
  const normalizedHostname = normalizeHostname(hostname)
  return /^\\d{1,3}(?:\\.\\d{1,3}){3}$/.test(normalizedHostname) || normalizedHostname.includes(':')
}

/**
 * Whether a console can have a subdomain of its own on this host.
 *
 * \`*.workers.dev\` cannot: the certificate Cloudflare serves there is a
 * single-label wildcard, so \`<console>.<worker>.<account>.workers.dev\` fails TLS
 * before a request is made. A bare IP has no subdomain to speak of. On both, a
 * console falls back to its path on the origin it is already on, and moves to
 * its own subdomain once a real domain is in front.
 */
export function supportsConsoleSubdomain(hostname: string): boolean {
  const normalizedHostname = normalizeHostname(hostname)

  if (normalizedHostname.length === 0) return false
  if (isIpHostname(normalizedHostname)) return false

  return !normalizedHostname.endsWith('.workers.dev')
}

/** The app's own host, with any console label stripped off the front. */
export function getAppRootHostname(hostname: string): string {
  const normalizedHostname = normalizeHostname(hostname)

  const label = CONSOLE_LABELS.find((candidate) => normalizedHostname.startsWith(\`\${candidate}.\`))
  const appHostname = label === undefined ? normalizedHostname : normalizedHostname.slice(label.length + 1)

  return getAllowedRootDomain(appHostname) ?? appHostname
}

/**
 * The \`Domain\` a session cookie should carry so it is readable on both the app
 * and its consoles.
 *
 * \`undefined\` on localhost and wherever a console shares the main origin: there
 * is one host, so a host-only cookie is both sufficient and tighter.
 */
export function getSharedCookieDomain(hostname: string): string | undefined {
  const appHostname = getAppRootHostname(hostname)

  if (appHostname === 'localhost') return undefined
  if (!supportsConsoleSubdomain(appHostname)) return undefined

  return appHostname
}
`
}
