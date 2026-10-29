import type { HttpClient } from '../http'

const ENDPOINT = 'https://identitytoolkit.googleapis.com/v1'

type ProjectConfig = { authorizedDomains?: readonly string[] }

type AuthUriResponse = { authUri?: string }

type ApiError = { error?: { message?: string } }

const errorMessage = (body: unknown): string =>
  (body as ApiError | undefined)?.error?.message ?? 'the request was refused without saying why'

/**
 * Whether Google sign-in is actually enabled on this project.
 *
 * This is the call the web SDK itself makes to begin an IdP flow, so it answers
 * the only question that matters — would a real sign-in work — rather than what
 * some configuration resource claims. It needs nothing but the public web API
 * key: no `gcloud`, no OAuth token, no service account. That is what lets the
 * manual step verify the user's click instead of taking their word for it.
 *
 * A disabled or unconfigured provider answers `400 OPERATION_NOT_ALLOWED`.
 */
export async function isGoogleProviderEnabled(
  http: HttpClient,
  apiKey: string
): Promise<{ enabled: boolean; detail: string }> {
  const response = await http.postJson(`${ENDPOINT}/accounts:createAuthUri?key=${encodeURIComponent(apiKey)}`, {
    providerId: 'google.com',
    // Required by the endpoint, and never navigated to: only the response is read.
    continueUri: 'http://localhost'
  })

  if (response.ok && typeof (response.body as AuthUriResponse | undefined)?.authUri === 'string') {
    return { enabled: true, detail: 'Google sign-in is enabled.' }
  }

  const message = errorMessage(response.body)

  if (message.includes('OPERATION_NOT_ALLOWED')) {
    return { enabled: false, detail: 'Google sign-in is not enabled on this project yet.' }
  }

  // Anything else — a restricted key, a disabled Identity Toolkit API, no
  // network — is not evidence either way, and saying "not enabled" would send
  // the user to toggle something that is already on.
  return { enabled: false, detail: `Could not tell: ${message}` }
}

/**
 * The project's authorized domains, read with the public web API key.
 *
 * Firebase refuses a sign-in from a host that is not on this list, and the
 * failure shows up only on that host — so the list is worth reading back rather
 * than assuming.
 */
export async function getAuthorizedDomains(http: HttpClient, apiKey: string): Promise<readonly string[] | null> {
  const response = await http.getJson(`${ENDPOINT}/projects?key=${encodeURIComponent(apiKey)}`)

  if (!response.ok) return null

  return (response.body as ProjectConfig | undefined)?.authorizedDomains ?? null
}
