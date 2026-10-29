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

## What it does not do yet

Console subdomains are prompted for and recorded, but the routing helpers, the
Worker session routes and the pageholder pages are not generated yet. The run
prints what is still yours to do.

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
bun run tools/compile-proof.ts ~/path/to/reference-app       # type-check generated output for real
```

`tools/extract-reference.ts` lifts the reference app's modules into
`src/codegen/templates/`. Those templates are committed, so the reference app is
a build-time input and never a runtime dependency.

`tools/compile-proof.ts` generates a whole run into a throwaway directory and
runs `tsc` against the reference app's real `firebase`, `firebase-admin`,
`octane` and `convex` types. Snapshots prove the output has not changed; only a
compiler proves it is valid.

## Architecture

Every step is `detect` → `plan` → `apply`. `detect` reads reality and never
prompts, so a re-run skips what is already done and a resumed run is safe.
`--dry-run` and `--check` stop after `plan` and cannot reach a write.

Every external process goes through the one `CommandRunner` in `src/exec.ts`, and
a test asserts no other module imports `node:child_process`. That is what lets
the whole orchestration be tested offline with a scripted fake.
