import type { TemplateOptions } from '../../options'

/** Lifted from the reference app's `src/lib/firebase/accounts.ts`. Re-extract with `tools/extract-reference.ts`. */
export const firebaseAccountsModule = (options: TemplateOptions): string =>
  `import type { User } from 'firebase/auth'

/**
 * Firebase holds exactly one signed-in user per app instance, so "switch
 * account" cannot mean "swap between live sessions". What it means here is a
 * roster of accounts this browser has signed in with before: picking one
 * re-runs the Google flow with that address as the \`login_hint\`, which lands
 * straight on the chooser entry instead of the generic account picker.
 *
 * Only display fields are stored — never a token — so the worst a stale entry
 * can do is pre-fill an email on the Google consent screen.
 */
export interface RememberedAccount {
  uid: string
  email: string | null
  displayName: string | null
  photoURL: string | null
  lastUsedAt: number
}

const STORAGE_KEY = '${options.appSlug}:accounts'
const MAX_ACCOUNTS = 6

const listeners = new Set<() => void>()

function isRememberedAccount(value: unknown): value is RememberedAccount {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.uid === 'string' && candidate.uid.length > 0 && typeof candidate.lastUsedAt === 'number'
}

function readStorage(): RememberedAccount[] {
  if (typeof localStorage === 'undefined') return []

  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []

    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    return parsed.filter(isRememberedAccount).sort((a, b) => b.lastUsedAt - a.lastUsedAt)
  } catch {
    return []
  }
}

// \`useSyncExternalStore\` compares snapshots by identity, so the parsed list is
// cached and only replaced when the stored value actually changes.
let snapshot: RememberedAccount[] = readStorage()

const publish = (next: RememberedAccount[]) => {
  snapshot = next
  for (const listener of listeners) listener()
}

function writeStorage(accounts: RememberedAccount[]): void {
  const next = accounts.sort((a, b) => b.lastUsedAt - a.lastUsedAt).slice(0, MAX_ACCOUNTS)

  try {
    if (next.length > 0) localStorage?.setItem(STORAGE_KEY, JSON.stringify(next))
    else localStorage?.removeItem(STORAGE_KEY)
  } catch {
    // Private-mode or quota failures just mean the roster is session-only.
  }

  publish(next)
}

/** Identity-stable snapshot for \`useSyncExternalStore\`. */
export function getRememberedAccounts(): RememberedAccount[] {
  return snapshot
}

export function subscribeToRememberedAccounts(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange)

  // Another tab signing in or out writes the same key; re-read so both windows
  // show the same roster.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return
    publish(readStorage())
  }

  window.addEventListener('storage', onStorage)

  return () => {
    listeners.delete(onStoreChange)
    window.removeEventListener('storage', onStorage)
  }
}

export function rememberAccount(user: User): void {
  const entry: RememberedAccount = {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    photoURL: user.photoURL,
    lastUsedAt: Date.now()
  }

  writeStorage([entry, ...readStorage().filter((account) => account.uid !== user.uid)])
}

export function forgetAllAccounts(): void {
  writeStorage([])
}

export function getAccountLabel(account: Pick<RememberedAccount, 'displayName' | 'email'>): string {
  return account.displayName?.split(' ')[0]?.trim() || account.email?.split('@')[0] || 'Account'
}
`
