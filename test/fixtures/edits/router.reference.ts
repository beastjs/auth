import { createRootRoute, createRoute, createRouter, lazyRouteComponent } from '@octanejs/tanstack-router'
import AnalyticsRoute from '../pages/AnalyticsRoute.btsx'
import AppRoot from '../pages/AppRoot.btsx'
import { adminRoutePrefix, isAdminSubdomainHostname } from './routing/admin-subdomain'
import { asgardHandoffPath, isAsgardSubdomainHostname } from './routing/asgard-subdomain'

// Asgard is a surface of its own, not a page of the app: on its subdomain the
// console *is* the site, so the host picks the tree once, at load. Nothing
// downstream has to ask which host it is on, and the main bundle never carries
// the console.
const isAsgardHost = typeof window !== 'undefined' && isAsgardSubdomainHostname(window.location.hostname)

// The admin console is the same arrangement on `admin.`: its own tree, chosen
// once by the host. Asgard is checked first, since a host can only be one of
// them and the two labels never overlap.
const isAdminHost = typeof window !== 'undefined' && isAdminSubdomainHostname(window.location.hostname)

const asgardShell = lazyRouteComponent(() => import('../pages/asgard-page.btsx'))
const asgardOverview = lazyRouteComponent(() => import('../pages/asgard-overview-page.btsx'))
const asgardAccounts = lazyRouteComponent(() => import('../pages/asgard-accounts-page.btsx'))

const adminShell = lazyRouteComponent(() => import('../pages/admin-page.btsx'))
const adminOverview = lazyRouteComponent(() => import('../pages/admin-overview-page.btsx'))

function createAdminRouteTree() {
  const rootRoute = createRootRoute({ component: adminShell })

  const overviewRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: adminOverview
  })

  return rootRoute.addChildren([overviewRoute])
}

function createAsgardRouteTree() {
  const rootRoute = createRootRoute({ component: asgardShell })

  const overviewRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: asgardOverview
  })

  const accountsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/accounts',
    component: asgardAccounts
  })

  return rootRoute.addChildren([overviewRoute, accountsRoute])
}

function createAppRouteTree() {
  const rootRoute = createRootRoute({ component: AppRoot })

  const playRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/'
  })

  const analyticsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/analytics',
    component: AnalyticsRoute
  })

  // The handoff mints an ID token on the origin the client SDK is signed in on
  // and sends the god to Asgard's root with it. It renders the console's own
  // shell rather than a page inside the app, since the app is not where it ends.
  const asgardRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: asgardHandoffPath,
    component: asgardShell
  })

  // Where the host cannot carry an `asgard.` subdomain — a workers.dev origin,
  // an IP — this path is the console rather than a doorway to it, so the shell
  // needs the overview beneath it. On a host that can, the shell redirects
  // before this ever renders.
  const asgardIndexRoute = createRoute({
    getParentRoute: () => asgardRoute,
    path: '/',
    component: asgardOverview
  })

  const asgardAccountsRoute = createRoute({
    getParentRoute: () => asgardRoute,
    path: 'accounts',
    component: asgardAccounts
  })

  // Where no `admin.` subdomain is in front of the app — the dev server, a
  // workers.dev origin — `/admin` is the console rather than a doorway to it,
  // so the whole surface hangs off this path. On a host that carries the
  // subdomain the admin tree is chosen instead and this never renders.
  const adminRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: adminRoutePrefix,
    component: adminShell
  })

  const adminIndexRoute = createRoute({
    getParentRoute: () => adminRoute,
    path: '/',
    component: adminOverview
  })

  return rootRoute.addChildren([
    playRoute,
    analyticsRoute,
    asgardRoute.addChildren([asgardIndexRoute, asgardAccountsRoute]),
    adminRoute.addChildren([adminIndexRoute])
  ])
}

const routeTree = isAsgardHost ? createAsgardRouteTree() : isAdminHost ? createAdminRouteTree() : createAppRouteTree()

export const analyticsRouter = createRouter({ routeTree, scrollRestoration: true })

declare module '@tanstack/router-core' {
  interface Register {
    router: typeof analyticsRouter
  }
}
