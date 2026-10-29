import type { RunContext } from './context'

/**
 * Whether a step's work is already done.
 *
 * `partial` is the interesting one: it means some of what the step owns is on
 * disk and some is not, which is what a re-run after an interrupted run looks
 * like. A step reports it rather than guessing, so the orchestrator can ask.
 */
export type StepState = 'satisfied' | 'partial' | 'absent'

export type FileWrite = {
  readonly path: string
  readonly contents: string
  /**
   * A seeded file is written once and never overwritten, and `--check` ignores
   * it. Pageholders, stylesheets and anything else the user is expected to grow
   * are seeded; everything the tool owns is not. Without this distinction the
   * second run would discard a half-built console UI.
   */
  readonly seeded?: boolean
}

export type StepPlan = {
  /** One line the user reads before anything happens. */
  readonly summary: string
  /** Files this step intends to create or replace wholesale. */
  readonly writes: readonly FileWrite[]
  /** Human notes to print after the run — DNS records, console URLs, manual follow-ups. */
  readonly notes: readonly string[]
}

export type Step = {
  readonly id: string
  readonly title: string
  /** True when this step has nothing to do for this run at all (e.g. no consoles chosen). */
  skip?(context: RunContext): boolean
  detect(context: RunContext): Promise<StepState>
  plan(context: RunContext): Promise<StepPlan>
  /** Never called in `dry-run` or `check` mode. */
  apply(context: RunContext, plan: StepPlan): Promise<void>
}

export const emptyPlan = (summary: string): StepPlan => ({ summary, writes: [], notes: [] })
