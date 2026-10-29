export type HttpResponse = {
  readonly status: number
  readonly ok: boolean
  readonly body: unknown
}

/**
 * The one seam through which this CLI makes HTTP requests.
 *
 * It exists for the same reason `CommandRunner` does: the Identity Toolkit
 * probes are the only part of the tool that can tell the user "this is actually
 * enabled now", and that logic has to be testable without a network.
 */
export type HttpClient = {
  getJson(url: string): Promise<HttpResponse>
  postJson(url: string, body: unknown): Promise<HttpResponse>
}

async function toResponse(response: Response): Promise<HttpResponse> {
  // A Google API error is JSON too, so the body is read either way and the
  // caller reads the error's own wording rather than a status code alone.
  const text = await response.text()

  let body: unknown = text
  try {
    body = JSON.parse(text)
  } catch {
    // Leave it as text; nothing downstream depends on it being JSON.
  }

  return { status: response.status, ok: response.ok, body }
}

const TIMEOUT_MS = 20_000

export const systemHttpClient: HttpClient = {
  async getJson(url) {
    return toResponse(await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) }))
  },
  async postJson(url, body) {
    return toResponse(
      await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS)
      })
    )
  }
}
