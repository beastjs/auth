import { join } from 'node:path'
import type { FileWrite } from '../step'
import { withHeader } from './emit'
import type { TemplateOptions } from './options'
import { consoleAccessModule, consoleDevGateModule, consoleSessionModule } from './templates/console/client'
import {
  consoleHostModule,
  subdomainsConfigModule,
  subdomainsIndexModule,
  subdomainsUtilsModule
} from './templates/console/host'
import { consoleOverviewPage, consoleShellPage, consoleStylesheet } from './templates/console/pages'
import { appUrlModule, consoleRoutingModule } from './templates/console/routing'
import { consoleDispatchModule, consoleRoutesModule } from './templates/console/server'
import { serverAuthModule, serverSessionModule, sessionModule } from './templates/console/session'
import { routeTreesModule } from './templates/console/trees'

/** A file the tool owns: re-rendered every run, and checked by `--check`. */
const managed = (root: string, path: string, contents: string): FileWrite => ({
  path: join(root, path),
  contents: withHeader(contents)
})

/**
 * A file written once and then left alone.
 *
 * Its header is part of the template rather than added here: a stylesheet has
 * no `//` comments, and a `.btsx` file is indentation-sensitive enough that what
 * sits above its imports is the template's business.
 */
const seeded = (root: string, path: string, contents: string): FileWrite => ({
  path: join(root, path),
  contents,
  seeded: true
})

/**
 * Everything a console needs: host arithmetic, a session, Worker endpoints, a
 * route tree, and pages to put in it.
 *
 * Empty when no console was chosen — Firebase sign-in on its own is a complete
 * outcome, and generating a session layer nothing gates is just dead code.
 */
export function buildConsoleManifest(root: string, options: TemplateOptions): readonly FileWrite[] {
  if (options.consoles.length === 0) return []

  const writes: FileWrite[] = [
    // Host and tenant arithmetic, shared by every console.
    managed(root, 'src/lib/subdomains/config.ts', subdomainsConfigModule(options)),
    managed(root, 'src/lib/subdomains/utils.ts', subdomainsUtilsModule()),
    managed(root, 'src/lib/subdomains/index.ts', subdomainsIndexModule()),
    managed(root, 'src/lib/routing/console-host.ts', consoleHostModule(options)),
    managed(root, 'src/lib/routing/app-url.ts', appUrlModule()),

    // The session layer, now that there is a console to gate.
    managed(root, 'src/lib/firebase-admin/session.ts', sessionModule(options)),
    managed(root, 'src/lib/firebase-admin/server-auth.ts', serverAuthModule(options)),
    managed(root, 'src/lib/firebase-admin/server-session.ts', serverSessionModule()),
    managed(root, 'src/lib/firebase/console-session.ts', consoleSessionModule(options)),

    // The dispatch table and the route trees, so the two surgical edits stay small.
    managed(root, 'src/server/console-routes.ts', consoleDispatchModule(options)),
    managed(root, 'src/lib/consoles/route-trees.ts', routeTreesModule(options))
  ]

  for (const spec of options.consoles) {
    const { label } = spec

    writes.push(
      managed(root, `src/lib/routing/${label}-console.ts`, consoleRoutingModule(spec, options)),
      managed(root, `src/lib/${label}/access.ts`, consoleAccessModule(spec, options)),
      managed(root, `src/lib/${label}/dev-gate.ts`, consoleDevGateModule(spec, options)),
      managed(root, `src/server/${label}-auth-routes.ts`, consoleRoutesModule(spec, options)),

      seeded(root, `src/pages/${label}-page.btsx`, consoleShellPage(spec, options)),
      seeded(root, `src/pages/${label}-overview-page.btsx`, consoleOverviewPage(spec, options)),
      seeded(root, `src/styles/${label}.css`, consoleStylesheet(spec, options))
    )
  }

  return writes
}
