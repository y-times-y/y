// Phase 5b — the self-verify bus (KERNEL).
//
// The compile/render verdict for an edit is known by `UserlandHost` (it runs
// esbuild and owns the error boundary), but the surface that needs it is
// `ModifyChat` (it talks to the agent). They are sibling Kernel components with
// no parent state between them, so this module is the thin channel: UserlandHost
// PUBLISHES a verdict every time it settles a load, and ModifyChat reads the
// latest one after a turn to decide whether to ask the agent to fix its work.
//
// Kept deliberately tiny and renderer-local (not a brick): it carries no power,
// only a status, so it doesn't belong on the privileged `window.y` bridge.

export type UserlandVerdict =
  | { outcome: 'ok' } // compiled and rendered cleanly
  | { outcome: 'compile-error'; error: string } // esbuild / module build failed
  | { outcome: 'crash'; error: string } // threw at render (and was auto-rolled-back)

// What subscribers receive: the verdict plus when it settled, so ModifyChat can
// tell "this verdict was caused by the turn I just ran" from a stale one.
export type UserlandOutcome = UserlandVerdict & { at: number }

type Listener = (o: UserlandOutcome) => void
type AgentWorkingListener = (working: boolean) => void

const listeners = new Set<Listener>()
const agentWorkingListeners = new Set<AgentWorkingListener>()
let latest: UserlandOutcome | null = null
let agentWorking = false

export function publishVerdict(v: UserlandVerdict): void {
  const outcome: UserlandOutcome = { ...v, at: Date.now() }
  latest = outcome
  listeners.forEach((l) => l(outcome))
}

export function latestVerdict(): UserlandOutcome | null {
  return latest
}

export function subscribeVerdict(l: Listener): () => void {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

export function publishAgentWorking(working: boolean): void {
  if (agentWorking === working) return
  agentWorking = working
  agentWorkingListeners.forEach((l) => l(working))
}

export function latestAgentWorking(): boolean {
  return agentWorking
}

export function subscribeAgentWorking(l: AgentWorkingListener): () => void {
  agentWorkingListeners.add(l)
  return () => {
    agentWorkingListeners.delete(l)
  }
}

// ---- The self-verify policy (pure, so it can be tested without React) ----
// Given the latest verdict and the loop's bookkeeping, decide what to do after a
// Modify turn. Kept side-effect-free: ModifyChat performs the action, this only
// chooses it. `note` strings are the transcript lines; `prompt` is fed back to
// the agent on a retry.
export type VerifyAction =
  | { kind: 'ignore' } // no edit settled this turn → nothing to verify
  | { kind: 'verified'; note: string } // compiled + rendered cleanly
  | { kind: 'retry'; attempt: number; note: string; prompt: string } // ask agent to fix
  | { kind: 'giveup'; message: string } // hit the retry cap → stop and surface

export function decideVerify(
  v: UserlandOutcome | null,
  turnStartAt: number,
  retries: number,
  max: number
): VerifyAction {
  // Only a verdict that settled AFTER the turn began reflects this turn's edit.
  if (!v || v.at < turnStartAt) return { kind: 'ignore' }
  if (v.outcome === 'ok') return { kind: 'verified', note: '✓ verified — compiled & rendered' }

  // Failure (compile-error | crash).
  const label = v.outcome === 'crash' ? 'render crash' : 'compile error'
  if (retries >= max) {
    const what = v.outcome === 'crash' ? 'crashes when rendered' : "won't compile"
    return {
      kind: 'giveup',
      message: `The change still ${what} after ${max} fix attempts — stopping. Last error:\n${v.error}`
    }
  }
  const attempt = retries + 1
  const detail =
    v.outcome === 'crash'
      ? 'threw when rendered (y auto-rolled-back to the previous working version)'
      : 'failed to compile'
  const prompt =
    `Your last edit to panel.tsx ${detail}. Fix panel.tsx so it compiles and ` +
    `renders cleanly. Error:\n\n${v.error}`
  return {
    kind: 'retry',
    attempt,
    note: `✗ ${label} — asking agent to fix (${attempt}/${max})`,
    prompt
  }
}
