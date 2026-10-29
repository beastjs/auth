import { deriveAll } from '../../derive'
import type { TemplateOptions } from '../../options'

/**
 * The console route trees, and the host check that picks one.
 *
 * This lives in a generated module so the app's own router takes a two-line
 * edit rather than eighty inserted ones, and so the tree selection can be read
 * and tested on its own.
 *
 * Every console component stays behind `lazyRouteComponent`, which is what keeps
 * the console code out of the main bundle — the property the whole
 * host-picks-a-tree arrangement exists for.
 */
export const routeTreesModule = (options: TemplateOptions): string => {
  const consoles = deriveAll(options.consoles, options.appSlug)

  return `import { createRootRoute, createRoute, lazyRouteComponent } from '@octanejs/tanstack-router'
import type { AnyRoute } from '@tanstack/router-core'
${consoles
  .map(
    (c) =>
      `import { is${c.pascal}SubdomainHostname, ${c.camel}RoutePrefix } from '@/lib/routing/${c.label}-console'`
  )
  .join('\n')}

/**
 * \`lazyRouteComponent\` declares \`preload\` as possibly returning \`undefined\`,
 * while the route options require \`Promise<void>\`. The value behaves correctly
 * at runtime; only the declarations disagree, so the cast is confined here
 * instead of being repeated at every route.
 */
type RouteComponentOption = NonNullable<Parameters<typeof createRootRoute>[0]>['component']

const lazy = (load: () => Promise<unknown>): RouteComponentOption =>
  lazyRouteComponent(load as () => Promise<{ default: never }>) as RouteComponentOption

${consoles
  .map(
    (c) => `const ${c.camel}Shell = lazy(() => import('@/pages/${c.label}-page.btsx'))
const ${c.camel}Overview = lazy(() => import('@/pages/${c.label}-overview-page.btsx'))`
  )
  .join('\n')}

${consoles
  .map(
    (c) => `/** ${c.title} as the whole site, which is what it is on its own subdomain. */
function create${c.pascal}RouteTree(): AnyRoute {
  const rootRoute = createRootRoute({ component: ${c.camel}Shell })

  const overviewRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: ${c.camel}Overview
  })

  return rootRoute.addChildren([overviewRoute])
}`
  )
  .join('\n\n')}

/**
 * The console tree for this host, or \`null\` when this is the app.
 *
 * The host decides once, at module load: on a console's subdomain the console
 * *is* the site, so nothing downstream has to ask which host it is on and the
 * main bundle never carries a console.
 */
export function selectConsoleRouteTree(): AnyRoute | null {
  if (typeof window === 'undefined') return null

  const hostname = window.location.hostname

${consoles
  .map((c) => `  if (is${c.pascal}SubdomainHostname(hostname)) return create${c.pascal}RouteTree()`)
  .join('\n')}

  return null
}

/**
 * The consoles mounted as paths on the app's own tree.
 *
 * These are what make a console reachable before DNS exists — on the dev
 * server, on a \`*.workers.dev\` origin, on an IP. Where the subdomain works, the
 * tree above is chosen instead and these never render.
 */
export function createConsoleFallbackRoutes(rootRoute: AnyRoute): AnyRoute[] {
${consoles
  .map(
    (c) => `  const ${c.camel}Route = createRoute({
    getParentRoute: () => rootRoute,
    path: ${c.camel}RoutePrefix,
    component: ${c.camel}Shell
  })

  const ${c.camel}IndexRoute = createRoute({
    getParentRoute: () => ${c.camel}Route,
    path: '/',
    component: ${c.camel}Overview
  })`
  )
  .join('\n\n')}

  return [${consoles.map((c) => `${c.camel}Route.addChildren([${c.camel}IndexRoute])`).join(', ')}]
}
`
}
