# @beastjs/auth

Wires Firebase and `firebase-admin` into a [beast](https://github.com/) app — an
rsbuild + octane SPA served by a Cloudflare Worker, optionally with Convex.

```bash
cd your-beast-app
bunx @beastjs/auth
```

It integrates into an app that already exists. It never scaffolds one, and it
refuses politely when the directory is not a beast app.

## What it does today

- **Detects** the stack: rsbuild, `beast-tsrx`, Convex, a Worker, the router
  module, the component kit.
- **Signs you in** to Firebase, and catches the common case where the stored
  credential has quietly expired (`firebase login --reauth`).
- **Talks to the Google APIs over REST**, with the token that sign-in produced.
- **Picks a project** — your existing projects first, then "create a new one".
- **Registers a web app** (or reuses the one that is there) and reads its client
  config.
- **Installs** `firebase` and `firebase-admin` through Bun, so the lockfile stays
  truthful.
- **Writes the three env surfaces** this stack actually reads: `.env` for rsbuild
  and the Bun scripts, `.dev.vars` for the Worker under Wrangler, and a committed
  `.env.example` that carries every key and not one value.
- **Generates** `src/lib/firebase/*`, `src/lib/firebase-admin/*`, their
  co-located tests, and `scripts/firebase/seed-claims.ts`.
- **Type-checks** the result against your app.

- **Generates the consoles** you choose: host arithmetic, a session cookie and
  its verification, Worker endpoints, a route tree picked by hostname, an access
  gate, and pages to put in it.
- **Wires them into the app**, with five marker-wrapped edits to files you own.
- **Mints the Admin SDK key** and writes only the four discrete variables — there
  is no `sa.json`, ever.
- **Signs you in with Google** in your own browser and grants you the founder
  claims.

## Consoles

A console is a staff area on its own subdomain, separate from the app. Each one
gets four things of its own: a subdomain label, a route tree the host picks at
load, a session cookie, and the custom claim that admits a session.

| | `asgard` | `admin` |
| --- | --- | --- |
| host | `asgard.<domain>` | `admin.<domain>` |
| claim | `god` | `admin` |
| path before DNS exists | `/asgard` | `/admin` |

Picking none is a complete outcome — Firebase sign-in on its own is useful.

Every console component stays behind `lazyRouteComponent`, so the main bundle
never carries a console.

### What gets written

Owned by this tool, re-rendered every run and checked by `--check`:
`src/lib/routing/*`, `src/lib/subdomains/*`, `src/lib/firebase-admin/*`,
`src/lib/firebase/*`, `src/server/*`, `src/lib/consoles/route-trees.ts`,
`src/lib/<console>/{access,dev-gate}.ts`, `scripts/firebase/seed-claims.ts`.

Seeded once and then yours — never overwritten, and ignored by `--check`:
`src/pages/<console>-page.btsx`, `src/pages/<console>-overview-page.btsx`,
`src/styles/<console>.css`. Without that distinction a second run would discard
a half-built console UI.

### The five edits

`src/worker.ts`, your router, `src/env.d.ts`, `wrangler.jsonc` and
`package.json` are changed in place, each inside a
`// beast-auth:<id> start` / `end` block or as one narrow replacement. A second
run replaces the block byte for byte, so it is a true no-op.

They stay small because the parts that grow — the API dispatch table and the
route trees — are generated into files of their own.

Each edit refuses rather than guesses. A router that already builds several
trees, or a Worker with no recognisable handler, is reported with the exact
lines to paste. Mangling a file you wrote is worse than asking you to add two
lines.

One assertion is worth more than the rest: the console dispatch must precede the
static asset fallback. A Worker that serves assets first answers every console
endpoint with the SPA shell, and the symptom points nowhere near the cause.

## Install size

`firebase-admin` is a real dependency and brings `@google-cloud` with it, so the
tree lands around 80 MB. That is paid for one step: granting the founder claims.

It is deliberate. `verifyIdToken` does genuine cryptographic verification of the
ID token against Google's JWKS before anything is granted, and substituting a
REST lookup for that would be a weaker stand-in for security-critical work.

## Why REST and not the `firebase` CLI

The CLI owns exactly one thing here: the browser sign-in. This tool never asks
for a Google password and holds no refresh token of its own.

Everything else — listing and creating projects, registering a web app, reading
its config — goes straight to the Firebase Management API with the token that
sign-in produced. `firebase-tools` 15.x fails on Node 26 with
`InvalidArgumentError: invalid onError method` from undici, so every one of those
commands errors out on a machine that has only current Node. Speaking to the API
directly removes a whole class of version-skew failure and needs no extra
credential.

If the credential is missing, expired, or lacks the `cloud-platform` scope, the
run says which and offers `firebase login --reauth`.

## Flags

| Flag | Effect |
| --- | --- |
| `--consoles asgard,admin` | Choose console subdomains without the prompt |
| `--no-consoles` | Firebase only |
| `--dry-run` | Print every file that would change; write nothing |
| `--check` | Exit 1 when the generated files are out of date. Fully offline — no credential probe, no network. Usable as a package script and a CI gate |

## The founder account

The CLI serves one page on an ephemeral `localhost` port, opens your browser, and
waits. You click *Continue with Google*; the sign-in happens in your browser and
the CLI only ever receives the resulting ID token. No password is typed into it
and no credential is stored.

It then verifies that token with the Admin SDK and grants
`{ topg: true, god: true, admin: true }`. `topg` is not optional: only `topg` may
hand out `god` or `admin`, so without it the app would be a one-person system
with no way to add the second person.

Claims are **merged**, never replaced — an account may carry claims this tool
knows nothing about. Refresh tokens are deliberately not revoked, since that
would invalidate the token just used. The result is read back and printed, rather
than reporting what was sent.

The server binds `127.0.0.1` but sends your browser to `localhost`: `localhost`
is in Firebase's default authorized-domain list and authorization is per-host,
not per-port, which is what lets an ephemeral port work with no setup. The page
is gated by a single-use nonce, checks `Origin` and `Sec-Fetch-Site`, sends no
CORS headers, shuts down the instant it has the token, and gives up after five
minutes with the by-hand command printed.

It also names the two errors that actually happen there —
`auth/operation-not-allowed` and `auth/unauthorized-domain` — because those are
the symptoms of the two steps the CLI cannot do for you.

## The service-account key

Firebase's own `firebase-adminsdk-*` account is used when it exists, because
Firebase already granted it what the Admin SDK needs — which avoids a
`setIamPolicy` call, the step most likely to be refused by an organization
policy. Otherwise a dedicated `<app>-admin` account is created and granted
`roles/firebaseauth.admin`.

The key is returned by the API as base64, decoded in memory, and written out as
`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` and
`FIREBASE_PRIVATE_KEY_ID` into gitignored files. It is never written as a file
and never printed.

## Things that cannot be automated

Stated plainly, because the run says so too:

- **Enabling the Google sign-in provider.** The Firebase CLI has no command for
  it — `firebase auth` only exposes `auth:export` and `auth:import`. The Identity
  Toolkit admin API may demand an OAuth client that the console normally
  auto-provisions, so this is a console visit and the run gives you the link.
- **DNS records and Cloudflare custom domains.** Your zone is yours; the run
  prints the records to add.
- **`wrangler secret put`** for production. The commands are printed.
- The **first `getIdToken(true)`** in a browser that is already signed in — new
  claims do not appear on an old token.

## Secrets

The service-account private key is never written into the repository. There is no
`sa.json`. Only the four discrete `FIREBASE_*` variables are written, into
gitignored files, and `.env.example` gets the key names with empty values.

## Development

```bash
bun install
bun test                                        # unit, codegen and integration tests
bun run typecheck
bun run build                                   # dist/cli.js, runs under node and bun

bun run tools/extract-reference.ts ~/path/to/reference-app   # re-lift the templates
bun run tools/compile-proof.ts ~/path/to/reference-app       # prove the generated output for real
```

`tools/extract-reference.ts` lifts the reference app's modules into
`src/codegen/templates/`. Those templates are committed, so the reference app is
a build-time input and never a runtime dependency.

`tools/compile-proof.ts` is the real gate. It generates a whole run into a
throwaway directory alongside a synthetic beast app, applies the five surgical
edits twice, and then:

- type-checks every generated `.ts` against the reference app's real `firebase`,
  `firebase-admin`, `octane` and `convex` types;
- compiles every generated `.btsx` with the actual beast compiler, because those
  files are indentation-sensitive and emitted as text, so a template bug there is
  a compiler error that `tsc` cannot see at all;
- asserts the second edit pass changes nothing.

Snapshots prove the output has not changed; only this proves it is correct.

## Architecture

Every step is `detect` → `plan` → `apply`. `detect` reads reality and never
prompts, so a re-run skips what is already done and a resumed run is safe.
`--dry-run` and `--check` stop after `plan` and cannot reach a write.

Every external process goes through the one `CommandRunner` in `src/exec.ts`, and
a test asserts no other module imports `node:child_process`. That is what lets
the whole orchestration be tested offline with a scripted fake.
