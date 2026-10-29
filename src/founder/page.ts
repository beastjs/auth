import type { FirebaseWebConfig } from '../context'

/**
 * The version of the Firebase web SDK the sign-in page loads.
 *
 * Pinned rather than floating: the page is served once, to one person, and a
 * surprise major version would break the one interaction it exists for.
 */
const SDK_VERSION = '12.0.0'

const escapeJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c')

/**
 * The one page the callback server serves.
 *
 * Google sign-in happens in the person's own browser and the CLI only ever sees
 * the resulting ID token — no password, no credential, nothing to store.
 *
 * It names the two errors that actually happen here instead of showing a raw
 * code, because they are the symptoms of the two steps the CLI cannot do itself:
 * enabling the provider, and authorizing the host.
 */
export function renderSignInPage(input: {
  readonly config: FirebaseWebConfig
  readonly nonce: string
  readonly projectId: string
  readonly appSlug: string
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in — ${input.appSlug}</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; min-height: 100dvh; display: grid; place-items: center;
    font: 15px/1.5 ui-sans-serif, -apple-system, system-ui, sans-serif;
    background: Canvas; color: CanvasText;
  }
  main { width: min(28rem, calc(100vw - 3rem)); text-align: center; }
  h1 { margin: 0 0 .25rem; font-size: 1.25rem; }
  p { margin: 0 0 1.5rem; opacity: .7; }
  button {
    font: inherit; font-weight: 500; padding: .625rem 1.125rem; border-radius: .5rem;
    border: 1px solid currentColor; background: transparent; color: inherit; cursor: pointer;
  }
  button:disabled { opacity: .5; cursor: default; }
  .note { margin-top: 1.5rem; padding: .75rem .875rem; border-radius: .5rem; font-size: .8125rem; text-align: left; }
  .error { border: 1px solid color-mix(in srgb, currentColor 30%, transparent); }
  a { color: inherit; }
  code { font-size: .8125em; }
  [hidden] { display: none; }
</style>
</head>
<body>
<main>
  <h1>${input.appSlug}</h1>
  <p>Sign in to create the founder account.</p>
  <button id="go">Continue with Google</button>
  <div class="note error" id="error" hidden></div>
  <div class="note" id="done" hidden></div>
</main>
<script type="module">
import { initializeApp } from 'https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app.js'
import {
  GoogleAuthProvider,
  getAuth,
  signInWithPopup
} from 'https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-auth.js'

// Public values only: the API key ships in every client bundle by design.
const app = initializeApp(${escapeJson(input.config)})
const auth = getAuth(app)
const provider = new GoogleAuthProvider()
provider.setCustomParameters({ prompt: 'select_account' })

const button = document.getElementById('go')
const errorBox = document.getElementById('error')
const doneBox = document.getElementById('done')

const show = (node, html) => {
  node.innerHTML = html
  node.hidden = false
}

/** The two failures that actually happen here, named rather than coded. */
const explain = (error) => {
  const code = error?.code ?? ''

  if (code === 'auth/operation-not-allowed') {
    return 'Google sign-in is not enabled on this project yet.<br><a href="https://console.firebase.google.com/project/${input.projectId}/authentication/providers" target="_blank" rel="noreferrer">Enable it here</a>, then try again.'
  }

  if (code === 'auth/unauthorized-domain') {
    return '<code>localhost</code> is not an authorized domain on this project.<br><a href="https://console.firebase.google.com/project/${input.projectId}/authentication/settings" target="_blank" rel="noreferrer">Add it here</a>, then try again.'
  }

  if (code === 'auth/popup-blocked') {
    return 'Your browser blocked the sign-in popup. Allow popups for this page and try again.'
  }

  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return 'The sign-in window closed before it finished. Try again when ready.'
  }

  return (error?.message ?? String(error)) + (code ? ' <code>' + code + '</code>' : '')
}

button.addEventListener('click', async () => {
  button.disabled = true
  errorBox.hidden = true

  try {
    const credential = await signInWithPopup(auth, provider)
    const idToken = await credential.user.getIdToken(true)

    const response = await fetch('/callback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idToken, nonce: ${escapeJson(input.nonce)} })
    })

    if (!response.ok) {
      show(errorBox, 'The CLI refused the sign-in: ' + (await response.text()))
      button.disabled = false
      return
    }

    button.hidden = true
    show(doneBox, 'Signed in as <strong>' + (credential.user.email ?? 'your account') + '</strong>. You can close this tab.')
  } catch (error) {
    show(errorBox, explain(error))
    button.disabled = false
  }
})
</script>
</body>
</html>
`
}
