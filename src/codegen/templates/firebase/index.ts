import type { TemplateOptions } from '../../options'

/** Lifted from the reference app's `src/lib/firebase/index.ts`. Re-extract with `tools/extract-reference.ts`. */
export const firebaseIndexModule = (options: TemplateOptions): string =>
  `import { type FirebaseApp, type FirebaseOptions, getApp, getApps, initializeApp } from 'firebase/app'
import { type Auth, GoogleAuthProvider, getAuth, onAuthStateChanged, type User } from 'firebase/auth'

export const firebaseConfig = {
  apiKey: import.meta.env.PUBLIC_FIREBASE_API_KEY,
  authDomain: import.meta.env.PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.PUBLIC_FIREBASE_APP_ID
  // measurementId: import.meta.env.PUBLIC_FIREBASE_MEASUREMENT_ID
} satisfies FirebaseOptions

// Analytics and storage are optional; these four are what \`getAuth\` needs to
// reach the right project.
const requiredConfig = {
  PUBLIC_FIREBASE_API_KEY: firebaseConfig.apiKey,
  PUBLIC_FIREBASE_AUTH_DOMAIN: firebaseConfig.authDomain,
  PUBLIC_FIREBASE_PROJECT_ID: firebaseConfig.projectId,
  PUBLIC_FIREBASE_APP_ID: firebaseConfig.appId
}

export const missingFirebaseConfig = Object.entries(requiredConfig)
  .filter(([, value]) => !value)
  .map(([name]) => name)

export const isFirebaseConfigured = missingFirebaseConfig.length === 0

// A missing \`.env\` must not take the whole app down with it — the game runs fine
// signed out, so the switcher degrades to a disabled control instead.
if (!isFirebaseConfigured) {
  console.warn(\`Firebase auth is disabled. Missing configuration: \${missingFirebaseConfig.join(', ')}\`)
}

export const firebaseApp: FirebaseApp | null = isFirebaseConfigured
  ? getApps().length > 0
    ? getApp()
    : initializeApp(firebaseConfig)
  : null

export const auth: Auth | null = firebaseApp ? getAuth(firebaseApp) : null

export const googleProvider = new GoogleAuthProvider()

googleProvider.setCustomParameters({ prompt: 'select_account' })

let authStateReady = !isFirebaseConfigured

export function subscribeToAuthState(onStoreChange: () => void): () => void {
  if (!auth) {
    onStoreChange()
    return () => {}
  }

  return onAuthStateChanged(auth, () => {
    authStateReady = true
    onStoreChange()
  })
}

export function getCurrentUser(): User | null {
  return auth?.currentUser ?? null
}

export function getAuthStateReady(): boolean {
  return authStateReady
}

export async function authenticatedFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const user = auth?.currentUser
  if (!user) throw new Error('Sign in with Google to access your files.')

  const headers = new Headers(init.headers)
  headers.set('authorization', \`Bearer \${await user.getIdToken()}\`)
  return await fetch(input, { ...init, headers })
}
`
