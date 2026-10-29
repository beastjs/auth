import { createRootRoute, createRouter } from '@octanejs/tanstack-router'

const routeTree = createRootRoute({})
export const a = createRouter({ routeTree })
export const b = createRouter({ routeTree })
