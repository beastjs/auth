import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TemplateOptions } from '../../src/codegen/options'
import {
  consoleHostModule,
  subdomainsConfigModule,
  subdomainsIndexModule,
  subdomainsUtilsModule
} from '../../src/codegen/templates/console/host'
import { appUrlModule, consoleRoutingModule } from '../../src/codegen/templates/console/routing'

/**
 * Renders the routing modules into a temp directory and imports them.
 *
 * A snapshot proves the bytes have not changed; this proves the generated code
 * *behaves* — which is the only way to catch a template that compiles and is
 * quietly wrong about a hostname.
 */
export async function renderRoutingModules(options: TemplateOptions) {
  const root = await mkdtemp(join(tmpdir(), 'beast-auth-routing-'))

  await mkdir(join(root, 'lib/subdomains'), { recursive: true })
  await mkdir(join(root, 'lib/routing'), { recursive: true })

  await writeFile(join(root, 'lib/subdomains/config.ts'), subdomainsConfigModule(options))
  await writeFile(join(root, 'lib/subdomains/utils.ts'), subdomainsUtilsModule())
  await writeFile(join(root, 'lib/subdomains/index.ts'), subdomainsIndexModule())

  // The emitted code imports through the app's `@` alias, which does not exist
  // in a temp directory; only the import specifier is rewritten.
  await writeFile(
    join(root, 'lib/routing/console-host.ts'),
    consoleHostModule(options).replaceAll('@/lib/subdomains/config', '../subdomains/config')
  )

  for (const spec of options.consoles) {
    await writeFile(join(root, `lib/routing/${spec.label}-console.ts`), consoleRoutingModule(spec, options))
  }

  await writeFile(join(root, 'lib/routing/app-url.ts'), appUrlModule())

  return {
    root,
    host: (await import(join(root, 'lib/routing/console-host.ts'))) as Record<string, (...args: never[]) => unknown>,
    appUrl: (await import(join(root, 'lib/routing/app-url.ts'))) as Record<string, (...args: never[]) => unknown>,
    subdomains: (await import(join(root, 'lib/subdomains/utils.ts'))) as Record<string, (...args: never[]) => unknown>,
    console: async (label: string) =>
      (await import(join(root, `lib/routing/${label}-console.ts`))) as Record<string, (...args: never[]) => unknown>
  }
}
