import { spawn } from 'node:child_process'

export type CommandResult = {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

export type RunOptions = {
  readonly cwd?: string
  /** Let the command own the terminal — needed by `firebase login`, which draws its own prompts. */
  readonly interactive?: boolean
  readonly env?: Record<string, string | undefined>
}

/**
 * The one seam through which this CLI touches the outside world.
 *
 * Every `firebase`, `gcloud`, `bun` and `wrangler` invocation goes through it, so
 * a test can hand the orchestrator a fake and assert the exact argv without a
 * process ever starting or a request ever reaching Google.
 */
export type CommandRunner = {
  run(command: string, args: readonly string[], options?: RunOptions): Promise<CommandResult>
  /** Whether the command exists on PATH. Separate from `run` so probing cannot have side effects. */
  which(command: string): Promise<string | null>
}

function spawnCommand(
  command: string,
  args: readonly string[],
  options: RunOptions = {}
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      // An interactive command inherits the terminal: its prompts are the user's
      // to answer, and capturing them would hang on input nobody can see.
      stdio: options.interactive ? 'inherit' : ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }))
  })
}

export const systemCommandRunner: CommandRunner = {
  run: spawnCommand,
  async which(command) {
    const result = await spawnCommand('/usr/bin/which', [command])
    const resolved = result.stdout.trim()
    return result.code === 0 && resolved.length > 0 ? resolved : null
  }
}

/**
 * Runs a command and returns its stdout, or throws with the command's own
 * complaint. External tools explain their failures better than a wrapper can, so
 * the message carries theirs rather than replacing it.
 */
export async function runOrThrow(
  runner: CommandRunner,
  command: string,
  args: readonly string[],
  options?: RunOptions
): Promise<string> {
  const result = await runner.run(command, args, options)

  if (result.code !== 0) {
    const complaint = (result.stderr.trim() || result.stdout.trim() || `exit code ${result.code}`).trim()
    throw new Error(`\`${command} ${args.join(' ')}\` failed: ${complaint}`)
  }

  return result.stdout
}
