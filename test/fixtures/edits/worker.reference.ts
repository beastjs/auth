import { handleAsgardAccounts } from './server/asgard-account-routes'
import { handleAsgardSession, handleAsgardSessionToken } from './server/asgard-auth-routes'
import { handleAsgardUsers } from './server/asgard-user-routes'

interface WorkerEnvironment {
  ASSETS: {
    fetch(request: Request): Promise<Response>
  }
  FIREBASE_CLIENT_EMAIL?: string
  FIREBASE_PRIVATE_KEY?: string
  FIREBASE_PRIVATE_KEY_ID?: string
  FIREBASE_PROJECT_ID?: string
  FIREBASE_SERVICE_ACCOUNT_KEY?: string
  CONVEX_URL?: string
}

const ASGARD_SESSION_PATH = '/api/asgard/session'
const ASGARD_SESSION_TOKEN_PATH = '/api/asgard/session/token'
const ASGARD_USERS_PATH = '/api/asgard/users'
const ASGARD_ACCOUNTS_PATH = '/api/asgard/accounts'

const isSpaNavigation = (request: Request) =>
  request.method === 'GET' && request.headers.get('accept')?.includes('text/html')

export default {
  async fetch(request: Request, env: WorkerEnvironment): Promise<Response> {
    const pathname = new URL(request.url).pathname

    if (pathname === ASGARD_SESSION_TOKEN_PATH) return handleAsgardSessionToken(request)
    if (pathname === ASGARD_SESSION_PATH) return handleAsgardSession(request)
    if (pathname === ASGARD_USERS_PATH) return handleAsgardUsers(request)
    if (pathname === ASGARD_ACCOUNTS_PATH) return handleAsgardAccounts(request, { convexUrl: env.CONVEX_URL })

    // Anything that is not an API route is the built client. A client route has
    // no file of its own, so an unknown navigation falls back to the shell and
    // the router resolves it — on every host, Asgard's included.
    const response = await env.ASSETS.fetch(request)
    if (response.status !== 404 || !isSpaNavigation(request)) return response

    return env.ASSETS.fetch(new Request(new URL('/', request.url), request))
  }
}
