import { createRootRoute, createRoute, createRouter } from '@octanejs/tanstack-router'
import AppRoot from '../pages/AppRoot.btsx'
import HomeRoute from '../pages/HomeRoute.btsx'

function createAppRouteTree() {
  const rootRoute = createRootRoute({ component: AppRoot })

  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: HomeRoute
  })

  return rootRoute.addChildren([homeRoute])
}

const routeTree = createAppRouteTree()

export const appRouter = createRouter({ routeTree, scrollRestoration: true })
