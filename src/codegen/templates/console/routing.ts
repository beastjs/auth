import { derive } from '../../derive'
import type { ConsoleSpec } from '../../../context'
import type { TemplateOptions } from '../../options'

/**
 * One console's host and path arithmetic.
 *
 * Generated per console from a single template, so `asgard` and `admin` cannot
 * drift apart the way the reference's two hand-written copies did — where only
 * one of them learned about `*.workers.dev`.
 */
export const consoleRoutingModule = (spec: ConsoleSpec, options: TemplateOptions): string => {
  const c = derive(spec, options.appSlug)

  return `import {
  getAppRootHostname,
  normalizeHostname,
  supportsConsoleSubdomain
} from './console-host'

export const ${c.camel}SubdomainLabel = '${c.label}'

/**
 * Where this console lives on the main origin.
 *
 * It is also the handoff path: one path, not two. The handoff exists only to
 * mint an ID token on the origin the client SDK is signed in on, and on a host
 * that cannot carry a subdomain this same path *is* the console.
 */
export const ${c.camel}RoutePrefix = '${c.routePrefix}'

export function is${c.pascal}SubdomainHostname(hostname: string): boolean {
  return normalizeHostname(hostname).startsWith(\`\${${c.camel}SubdomainLabel}.\`)
}

export function strip${c.pascal}Subdomain(hostname: string): string {
  const normalizedHostname = normalizeHostname(hostname)

  return is${c.pascal}SubdomainHostname(normalizedHostname)
    ? normalizedHostname.slice(${c.camel}SubdomainLabel.length + 1)
    : normalizedHostname
}

export function supports${c.pascal}Subdomain(hostname: string): boolean {
  return supportsConsoleSubdomain(hostname)
}

export function to${c.pascal}SubdomainHostname(hostname: string): string {
  const normalizedHostname = normalizeHostname(hostname)

  if (is${c.pascal}SubdomainHostname(normalizedHostname)) return normalizedHostname

  const appHostname = getAppRootHostname(normalizedHostname)

  return supports${c.pascal}Subdomain(appHostname) ? \`\${${c.camel}SubdomainLabel}.\${appHostname}\` : appHostname
}

/**
 * Whether this host is where the console itself runs — its own subdomain, or the
 * main origin standing in for one.
 *
 * It decides who mints the session: on its own subdomain the token arrives
 * through the handoff, while a stand-in origin already holds the client's
 * sign-in and can exchange it directly.
 */
export function is${c.pascal}ConsoleHostname(hostname: string): boolean {
  return is${c.pascal}SubdomainHostname(hostname) || !supports${c.pascal}Subdomain(hostname)
}

export function is${c.pascal}RoutePath(pathname: string): boolean {
  return pathname === ${c.camel}RoutePrefix || pathname.startsWith(\`\${${c.camel}RoutePrefix}/\`)
}

/** A console path as the console's own subdomain sees it, rooted at \`/\`. */
export function to${c.pascal}ExternalPath(pathname: string): string {
  if (pathname === ${c.camel}RoutePrefix) return '/'
  if (pathname.startsWith(\`\${${c.camel}RoutePrefix}/\`)) return pathname.slice(${c.camel}RoutePrefix.length)

  return pathname
}

/** The same path as the main origin sees it, under the console's prefix. */
export function to${c.pascal}InternalPath(pathname: string): string {
  if (pathname === '/' || pathname.length === 0) return ${c.camel}RoutePrefix
  if (is${c.pascal}RoutePath(pathname)) return pathname

  return \`\${${c.camel}RoutePrefix}\${pathname}\`
}

/**
 * A link target that works from wherever the console is currently mounted.
 *
 * The console's pages are the same on both hosts, so links have to be built
 * rather than written out.
 */
export function resolve${c.pascal}NavigationPath(destination: string, currentPathname: string): string {
  const externalPath = to${c.pascal}ExternalPath(destination)

  return is${c.pascal}RoutePath(currentPathname) ? to${c.pascal}InternalPath(externalPath) : externalPath
}

/**
 * Sends a signed-in user to the console with their ID token in the fragment,
 * which the console trades for its own session cookie.
 *
 * A fragment never reaches a server log or a proxy, unlike a query string.
 */
export function build${c.pascal}HandoffUrl(currentUrl: URL, idToken: string): URL {
  const appHostname = getAppRootHostname(currentUrl.hostname)
  const onItsOwnSubdomain = supports${c.pascal}Subdomain(appHostname)
  const handoffUrl = new URL(currentUrl)

  handoffUrl.hostname = onItsOwnSubdomain ? \`\${${c.camel}SubdomainLabel}.\${appHostname}\` : appHostname
  handoffUrl.pathname = onItsOwnSubdomain ? '/' : ${c.camel}RoutePrefix
  handoffUrl.search = ''
  handoffUrl.hash = new URLSearchParams({ idToken }).toString()

  return handoffUrl
}
`
}

/** Builds an absolute URL back to the main app from inside any console. */
export const appUrlModule = (): string => `import { CONSOLE_LABELS, getAppRootHostname } from './console-host'

/**
 * Builds an absolute URL to a page on the main app, from anywhere in a console.
 *
 * A console can live on its own subdomain, so the host drops back to the app
 * root; where a console shares the main origin only the pathname changes.
 */
export function buildAppUrl(currentUrl: URL, pathname: string): URL {
  const appUrl = new URL(currentUrl)

  appUrl.hostname = getAppRootHostname(currentUrl.hostname)
  appUrl.pathname = pathname
  appUrl.search = ''
  appUrl.hash = ''

  return appUrl
}

/** Whether this host is one of the consoles' own subdomains. */
export function isConsoleHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase()
  return CONSOLE_LABELS.some((label) => normalized.startsWith(\`\${label}.\`))
}
`
