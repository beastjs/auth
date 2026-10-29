import type { TemplateOptions } from '../../options'

/** Lifted from the reference app's `src/lib/firebase/auth.ts`. Re-extract with `tools/extract-reference.ts`. */
export const firebaseAuthModule = (options: TemplateOptions): string =>
  `import {
  getRedirectResult,
  onIdTokenChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
  type UserCredential
} from 'firebase/auth'
import { useCallback, useEffect, useState, useSyncExternalStore } from 'octane'
import {
  type FirebaseCustomClaims,
  getFirebaseCustomClaimsFromIdTokenResult,
  hasFirebaseGodAccess
} from '@/lib/firebase-admin/custom-claims'

import { auth, googleProvider, isFirebaseConfigured } from './'
import {
  getRememberedAccounts,
  rememberAccount,
  subscribeToRememberedAccounts,
  type RememberedAccount
} from './accounts'

const TOKEN_FETCH_TIMEOUT_MS = 12_000
const TOKEN_FETCH_MAX_RETRIES = 2

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(\`\${label} timed out after \${ms}ms\`)), ms)
  })

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }) as Promise<T>
}

export const isMessengerInAppBrowser = (): boolean => {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || (navigator as { vendor?: string }).vendor || ''
  return /FBAN|FBAV|FBAN\\/Messenger|FB_IAB|FB4A|Instagram|Messenger/i.test(ua)
}

export const openInExternalBrowser = (): boolean => {
  if (typeof window === 'undefined') return false
  const href = window.location.href
  // Android Chrome intent - forces external browser
  if (/Android/i.test(navigator.userAgent)) {
    window.location.href = \`intent://\${href.replace(/^https?:\\/\\//, '')}#Intent;scheme=https;end\`
    return true
  }
  window.open(href, '_blank', 'noopener,noreferrer')
  return true
}

/**
 * @param loginHint Email of a previously used account. Google lands on that
 * entry in the chooser instead of the generic "select an account" screen, which
 * is what makes the switcher's roster feel like switching rather than
 * re-authenticating from scratch.
 */
export async function signInWithGoogle(loginHint?: string): Promise<UserCredential | undefined> {
  if (!isFirebaseConfigured || !auth) {
    throw new Error('Firebase auth is not configured.')
  }

  // A shared provider instance carries whichever hint was set last, so it is
  // rewritten (and cleared) on every call rather than accumulating.
  googleProvider.setCustomParameters(
    loginHint ? { prompt: 'select_account', login_hint: loginHint } : { prompt: 'select_account' }
  )

  // Messenger / FB / Instagram in-app WebView blocks window.open popups - use redirect flow
  if (isMessengerInAppBrowser()) {
    await signInWithRedirect(auth, googleProvider)
    return
  }

  const credential = await signInWithPopup(auth, googleProvider)
  rememberAccount(credential.user)
  return credential
}

export async function consumeRedirectResult(): Promise<UserCredential | null> {
  if (!isFirebaseConfigured || !auth) return null
  try {
    const credential = await getRedirectResult(auth)
    if (credential) rememberAccount(credential.user)
    return credential
  } catch {
    return null
  }
}

/** Roster of accounts this browser has signed in with, newest first. */
export function useRememberedAccounts(): RememberedAccount[] {
  return useSyncExternalStore(subscribeToRememberedAccounts, getRememberedAccounts, getRememberedAccounts)
}

export function useFirebaseUser() {
  const [user, setUser] = useState<User | null>(null)
  const [customClaims, setCustomClaims] = useState<FirebaseCustomClaims>({})
  const [hasAdminClaim, setHasAdminClaim] = useState(false)
  const [hasGodAccess, setHasGodAccess] = useState(false)
  const [isLoading, setIsLoading] = useState(Boolean(auth))
  const [authError, setAuthError] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  // Complete redirect flow (Messenger in-app browser) - must be called once on mount
  useEffect(() => {
    if (!auth) return
    void consumeRedirectResult()
  }, [])

  useEffect(() => {
    if (!auth) return

    let isCancelled = false
    let latestTokenRequest = 0

    const loadClaimsWithRetry = async (nextUser: User, requestId: number, forceRefreshInitial: boolean) => {
      let lastError: unknown = null

      for (let attempt = 0; attempt <= TOKEN_FETCH_MAX_RETRIES; attempt++) {
        const shouldForceRefresh = forceRefreshInitial || attempt > 0

        try {
          const tokenResult = await withTimeout(
            nextUser.getIdTokenResult(shouldForceRefresh),
            TOKEN_FETCH_TIMEOUT_MS,
            'Token fetch'
          )

          if (isCancelled || requestId !== latestTokenRequest) {
            return
          }

          const nextCustomClaims = getFirebaseCustomClaimsFromIdTokenResult(tokenResult)
          setCustomClaims(nextCustomClaims)
          setHasAdminClaim(nextCustomClaims.admin === true)
          setHasGodAccess(hasFirebaseGodAccess(nextCustomClaims))
          setAuthError(null)
          setIsLoading(false)
          return
        } catch (error) {
          lastError = error

          if (isCancelled || requestId !== latestTokenRequest) {
            return
          }

          if (attempt < TOKEN_FETCH_MAX_RETRIES) {
            await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)))
          }
        }
      }

      if (isCancelled || requestId !== latestTokenRequest) {
        return
      }

      setCustomClaims({})
      setHasAdminClaim(false)
      setHasGodAccess(false)
      setAuthError(
        lastError instanceof Error ? lastError.message : 'Failed to load auth claims. Please re-authenticate.'
      )
      setIsLoading(false)
    }

    const unsubscribe = onIdTokenChanged(auth, (nextUser) => {
      latestTokenRequest += 1
      const requestId = latestTokenRequest

      setUser(nextUser)
      setAuthError(null)

      if (!nextUser) {
        setCustomClaims({})
        setHasAdminClaim(false)
        setHasGodAccess(false)
        setIsLoading(false)
        return
      }

      // Covers sessions Firebase restored on load, not just fresh sign-ins, so
      // the roster never misses the account the user is actually on.
      rememberAccount(nextUser)
      setIsLoading(true)
      void loadClaimsWithRetry(nextUser, requestId, false)
    })

    return () => {
      isCancelled = true
      unsubscribe()
    }
  }, [])

  const refreshClaims = useCallback(async () => {
    const currentUser = auth?.currentUser ?? user

    if (!currentUser) {
      setAuthError('No signed-in user to refresh.')
      return
    }

    setIsRefreshing(true)
    setAuthError(null)

    try {
      await withTimeout(currentUser.getIdToken(true), TOKEN_FETCH_TIMEOUT_MS, 'Token refresh')
      const tokenResult = await withTimeout(currentUser.getIdTokenResult(true), TOKEN_FETCH_TIMEOUT_MS, 'Token fetch')
      const nextCustomClaims = getFirebaseCustomClaimsFromIdTokenResult(tokenResult)
      setCustomClaims(nextCustomClaims)
      setHasAdminClaim(nextCustomClaims.admin === true)
      setHasGodAccess(hasFirebaseGodAccess(nextCustomClaims))
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Failed to refresh session.')
    } finally {
      setIsRefreshing(false)
    }
  }, [user])

  const reauthenticate = useCallback(async () => {
    setAuthError(null)
    // Always try a forced refresh first; caller can fall back to signInWithGoogle if claim still missing
    await refreshClaims()
  }, [refreshClaims])

  return {
    customClaims,
    hasAdminClaim,
    hasGodAccess,
    isLoading,
    user,
    authError,
    isRefreshing,
    refreshClaims,
    reauthenticate,
    // alias for ergonomics
    refresh: refreshClaims
  }
}

export async function signOutUser(): Promise<void> {
  if (!isFirebaseConfigured || !auth) {
    throw new Error('Firebase auth is not configured.')
  }

  await signOut(auth)
}
`
