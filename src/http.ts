export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE'

export type HttpRequest = {
  readonly url: string
  readonly method?: HttpMethod
  readonly body?: unknown
  /** An OAuth access token. Never logged, never recorded, never put in a URL. */
  readonly bearer?: string
}

export type HttpResponse = {
  readonly status: number
  readonly ok: boolean
  readonly body: unknown
}

/**
 * The one seam through which this CLI makes HTTP requests.
 *
 * It exists for the same reason `CommandRunner` does: the Google API calls and
 * the Identity Toolkit probes are the only parts of the tool that can say "this
 * is really configured now", and that logic has to be testable without a
 * network.
 */
export type HttpClient = {
  request(request: HttpRequest): Promise<HttpResponse>
}

const TIMEOUT_MS = 30_000

export const systemHttpClient: HttpClient = {
  async request({ url, method = 'GET', body, bearer }) {
    const headers: Record<string, string> = {}
    if (bearer !== undefined) headers.authorization = `Bearer ${bearer}`
    if (body !== undefined) headers['content-type'] = 'application/json'

    const response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })

    // A Google API error is JSON too, so the body is read either way and the
    // caller can surface the API's own wording rather than a bare status.
    const text = await response.text()

    let parsed: unknown = text
    try {
      parsed = JSON.parse(text)
    } catch {
      // Leave it as text; nothing downstream depends on it being JSON.
    }

    return { status: response.status, ok: response.ok, body: parsed }
  }
}

type ApiError = { error?: { message?: string; status?: string } }

/** The API's own description of a failure, which beats anything a wrapper invents. */
export function describeHttpError(response: HttpResponse): string {
  const error = (response.body as ApiError | undefined)?.error
  return error?.message ?? `the request failed with status ${response.status}`
}
