import { afterEach, describe, expect, test } from 'bun:test'
import type { FirebaseWebConfig } from '../src/context'
import { startFounderSignIn, type FounderSignIn } from '../src/founder/server'
import { renderSignInPage } from '../src/founder/page'

const CONFIG: FirebaseWebConfig = {
  apiKey: 'AIzaTESTKEY',
  authDomain: 'my-app-345.firebaseapp.com',
  projectId: 'my-app-345',
  storageBucket: 'my-app-345.appspot.com',
  messagingSenderId: '123',
  appId: '1:123:web:abc'
}

let running: FounderSignIn | null = null

const start = async () => {
  running = await startFounderSignIn({ config: CONFIG, projectId: CONFIG.projectId, appSlug: 'my-app' })
  return running
}

const origin = (url: string) => new URL(url).origin

afterEach(() => {
  running?.close()
  running = null
})

describe('the callback server', () => {
  test('sends the browser to localhost, not 127.0.0.1', async () => {
    const { url } = await start()

    // `localhost` is in Firebase's default authorized-domain list; 127.0.0.1
    // historically was not, and authorization is per-host, not per-port.
    expect(new URL(url).hostname).toBe('localhost')
    expect(new URL(url).port).not.toBe('')
  })

  test('serves the page only to someone holding the nonce', async () => {
    const { url } = await start()

    const withNonce = await fetch(url)
    expect(withNonce.status).toBe(200)
    expect(await withNonce.text()).toInclude('Continue with Google')

    const without = await fetch(`${origin(url)}/`)
    expect(without.status).toBe(404)
  })

  test('accepts a token posted from its own origin', async () => {
    const { url, idToken } = await start()
    const nonce = new URL(url).searchParams.get('s')

    const response = await fetch(`${origin(url)}/callback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: origin(url) },
      body: JSON.stringify({ idToken: 'HEADER.PAYLOAD.SIGNATURE', nonce })
    })

    expect(response.status).toBe(200)
    expect(await idToken).toBe('HEADER.PAYLOAD.SIGNATURE')
  })

  test('refuses a post from another origin', async () => {
    const { url } = await start()
    const nonce = new URL(url).searchParams.get('s')

    const response = await fetch(`${origin(url)}/callback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify({ idToken: 'x', nonce })
    })

    expect(response.status).toBe(403)
  })

  test('refuses a post with the wrong nonce', async () => {
    const { url } = await start()

    const response = await fetch(`${origin(url)}/callback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: origin(url) },
      body: JSON.stringify({ idToken: 'x', nonce: 'guessed' })
    })

    expect(response.status).toBe(403)
  })

  test('shuts down the moment it has the token, so there is nothing to replay', async () => {
    const { url, idToken } = await start()
    const nonce = new URL(url).searchParams.get('s')

    const post = () =>
      fetch(`${origin(url)}/callback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: origin(url) },
        body: JSON.stringify({ idToken: 'first', nonce })
      })

    expect((await post()).status).toBe(200)
    expect(await idToken).toBe('first')

    // Stronger than refusing a replay: the listener is gone. The 409 branch
    // still guards the race where two posts are already in flight.
    await expect(post()).rejects.toThrow()
  })

  test('refuses a body that is not a token', async () => {
    const { url } = await start()
    const nonce = new URL(url).searchParams.get('s')

    const response = await fetch(`${origin(url)}/callback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: origin(url) },
      body: JSON.stringify({ nonce })
    })

    expect(response.status).toBe(400)
  })

  test('answers nothing else', async () => {
    const { url } = await start()

    expect((await fetch(`${origin(url)}/anything`)).status).toBe(404)
    expect((await fetch(`${origin(url)}/favicon.ico`)).status).toBe(204)
  })

  test('sends no CORS headers, so another origin could not read a reply', async () => {
    const { url } = await start()
    const response = await fetch(url)

    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })
})

describe('the sign-in page', () => {
  const page = renderSignInPage({ config: CONFIG, nonce: 'NONCE', projectId: 'my-app-345', appSlug: 'my-app' })

  test('embeds only public config', () => {
    expect(page).toInclude('AIzaTESTKEY')
    expect(page).not.toInclude('BEGIN PRIVATE KEY')
    expect(page).not.toInclude('client_email')
  })

  test('names the provider error, because that is the step the CLI cannot do', () => {
    expect(page).toInclude('auth/operation-not-allowed')
    expect(page).toInclude('Google sign-in is not enabled on this project yet')
    expect(page).toInclude('authentication/providers')
  })

  test('names the authorized-domain error too', () => {
    expect(page).toInclude('auth/unauthorized-domain')
    expect(page).toInclude('authentication/settings')
  })

  test('pins the SDK version rather than floating', () => {
    expect(page).toMatch(/firebasejs\/\d+\.\d+\.\d+\/firebase-app\.js/)
  })

  test('escapes a < in config so it cannot break out of the script', () => {
    const hostile = renderSignInPage({
      config: { ...CONFIG, appId: '</script><script>alert(1)</script>' },
      nonce: 'N',
      projectId: 'p',
      appSlug: 'a'
    })

    expect(hostile).not.toInclude('</script><script>alert(1)')
    expect(hostile).toInclude('\\u003c')
  })
})
