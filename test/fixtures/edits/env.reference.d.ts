declare module '*.btsx' {
  import type { ComponentBody } from 'octane'

  const component: ComponentBody
  export default component
}

// Rsbuild inlines `PUBLIC_*` entries from `.env` into `import.meta.env`. Anything
// absent from the loaded env files is replaced with `undefined`, so every key is
// optional here and guarded at the point of use.
interface ImportMetaEnv {
  /** Rsbuild's own build-time flags, inlined the same way. */
  readonly DEV?: boolean
  readonly PROD?: boolean
  readonly MODE?: 'development' | 'production' | 'none'
  /** Opens Asgard's client gate in a dev build. See `lib/asgard/dev-gate.ts`. */
  readonly PUBLIC_ASGARD_OPEN?: string
  readonly PUBLIC_FIREBASE_API_KEY?: string
  readonly PUBLIC_FIREBASE_AUTH_DOMAIN?: string
  readonly PUBLIC_FIREBASE_PROJECT_ID?: string
  readonly PUBLIC_FIREBASE_STORAGE_BUCKET?: string
  readonly PUBLIC_FIREBASE_MESSAGING_SENDER_ID?: string
  readonly PUBLIC_FIREBASE_APP_ID?: string
  readonly PUBLIC_FIREBASE_MEASUREMENT_ID?: string
  readonly PUBLIC_CONVEX_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
