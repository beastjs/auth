# Changelog

## 0.1.0

First release. Wires Firebase into a Beast app in one interactive command.

### What it does

- Detects the stack — rsbuild, `beast-tsrx`, Convex, a Cloudflare Worker, the
  router module, the component kit — and refuses politely when the directory is
  not a Beast app.
- Picks or creates a Firebase project, registers a web app, and reads its client
  config.
- Walks you through enabling Google sign-in and the authorized domains, then
  **verifies** both rather than taking your word for it.
- Mints the Admin SDK private key and writes only the four discrete environment
  variables. No `sa.json`, ever.
- Writes the three env surfaces this stack reads: `.env`, `.dev.vars`, and a
  committed `.env.example`.
- Generates `lib/firebase`, `lib/firebase-admin`, their tests, and the claims
  script.
- Generates the console subdomains you choose — routing, session, Worker
  endpoints, route trees, access gates — and seeds pages and styles you own.
- Wires the consoles into your Worker, router, env types, Wrangler config and
  package scripts with five idempotent edits.
- Signs you in with Google in your own browser and grants you
  `topg` / `god` / `admin`.

### Notes

- The `firebase` CLI is used for the browser sign-in only. Every API call goes
  over REST with the token that sign-in produces, because `firebase-tools` 15.x
  fails on Node 26 with `InvalidArgumentError: invalid onError method` from
  undici.
- `--check` is fully offline and exits 1 when the generated files are out of
  date, so it works as a package script and a CI gate.
- Re-running is safe: every step detects before it plans, seeded files are never
  overwritten, and the five edits replace their marker blocks byte for byte.
