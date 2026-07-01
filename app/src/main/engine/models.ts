import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { loadEngineLogoDataUrl } from './logos'

type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type ModelInfo = { id: string; label: string; contextWindow?: number }

export type EngineModelCatalog = {
  engine: string
  label: string
  logoUrl?: string
  defaultModel: string
  models: ModelInfo[]
}

const ENGINE_LABELS: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex'
}

const EFFORT_LABELS: Record<Effort, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'XHigh',
  max: 'Max'
}

const CLAUDE_BASE_MODELS = [
  { id: 'claude-fable-5', label: 'Fable 5', contextWindow: 200_000, efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { id: 'claude-sonnet-5', label: 'Sonnet 5', contextWindow: 1_000_000, defaultEffort: 'high', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', contextWindow: 200_000, efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { id: 'claude-sonnet-4-6[1m]', label: 'Sonnet 4.6', contextWindow: 1_000_000, efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { id: 'claude-opus-4-8', label: 'Opus 4.8', contextWindow: 1_000_000, efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { id: 'claude-opus-4-8[1m]', label: 'Opus 4.8', contextWindow: 1_000_000, efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', contextWindow: 200_000, efforts: ['low', 'medium', 'high', 'xhigh', 'max'] }
] satisfies Array<{ id: string; label: string; contextWindow?: number; defaultEffort?: Effort; efforts: Effort[] }>

const CODEX_FALLBACK_BASE = [
  {
    id: 'gpt-5.5',
    label: 'GPT-5.5',
    contextWindow: 372_000,
    defaultEffort: 'medium',
    efforts: ['low', 'medium', 'high', 'xhigh']
  },
  {
    id: 'gpt-5.4',
    label: 'GPT-5.4',
    contextWindow: 272_000,
    defaultEffort: 'xhigh',
    efforts: ['low', 'medium', 'high', 'xhigh']
  },
  {
    id: 'gpt-5.4-mini',
    label: 'GPT-5.4 Mini',
    contextWindow: 272_000,
    defaultEffort: 'medium',
    efforts: ['low', 'medium', 'high', 'xhigh']
  }
] satisfies Array<{ id: string; label: string; contextWindow?: number; defaultEffort: Effort; efforts: Effort[] }>

const CODEX_SKIP = new Set(['codex-auto-review'])

function withEffort(id: string, effort: Effort): string {
  return `${id}#effort=${effort}`
}

function effortModels(
  models: Array<{ id: string; label: string; contextWindow?: number; defaultEffort?: Effort; efforts: Effort[] }>
): ModelInfo[] {
  const out: ModelInfo[] = []
  for (const model of models) {
    const ordered = model.defaultEffort
      ? [model.defaultEffort, ...model.efforts.filter((e) => e !== model.defaultEffort)]
      : model.efforts
    for (const effort of ordered) {
      out.push({
        id: withEffort(model.id, effort),
        label: `${model.label} · ${EFFORT_LABELS[effort]}`,
        contextWindow: model.contextWindow
      })
    }
  }
  return out
}

const CLAUDE_FALLBACK: ModelInfo[] = effortModels(CLAUDE_BASE_MODELS)
const CODEX_FALLBACK: ModelInfo[] = effortModels(CODEX_FALLBACK_BASE)

function isEffort(value: string | undefined): value is Effort {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh' || value === 'max'
}

function uniqueEfforts(levels: Array<{ effort?: string }> | undefined, fallback: Effort[]): Effort[] {
  const seen = new Set<Effort>()
  const out: Effort[] = []
  for (const level of levels ?? []) {
    if (isEffort(level.effort) && !seen.has(level.effort)) {
      seen.add(level.effort)
      out.push(level.effort)
    }
  }
  return out.length ? out : fallback
}

type CodexModelCache = {
  models?: Array<{
    slug?: string
    display_name?: string
    visibility?: string
    context_window?: number
    default_reasoning_level?: string
    supported_reasoning_levels?: Array<{ effort?: string; description?: string }>
  }>
}

function loadCodexModels(): ModelInfo[] {
  try {
    const path = join(homedir(), '.codex', 'models_cache.json')
    if (!existsSync(path)) return CODEX_FALLBACK
    const data = JSON.parse(readFileSync(path, 'utf8')) as CodexModelCache
    const bases = (data.models ?? [])
      .filter((m) => m.slug && !CODEX_SKIP.has(m.slug) && m.visibility !== 'hide' && m.visibility !== 'hidden')
      .map((m) => {
        const fallback = CODEX_FALLBACK_BASE.find((f) => f.id === m.slug)
        const efforts = uniqueEfforts(m.supported_reasoning_levels, fallback?.efforts ?? ['low', 'medium', 'high'])
        return {
          id: m.slug as string,
          label: m.display_name || (m.slug as string),
          contextWindow: typeof m.context_window === 'number'
            ? m.context_window
            : fallback?.contextWindow,
          defaultEffort: isEffort(m.default_reasoning_level)
            ? m.default_reasoning_level
            : (fallback?.defaultEffort ?? efforts[0]),
          efforts
        }
      })
    const models = effortModels(bases)
    return models.length ? models : CODEX_FALLBACK
  } catch {
    return CODEX_FALLBACK
  }
}

function loadClaudeModels(): ModelInfo[] {
  return CLAUDE_FALLBACK
}

let cache: EngineModelCatalog[] | null = null

export function listEngineModels(engineIds: string[]): EngineModelCatalog[] {
  if (cache) return cache.filter((c) => engineIds.includes(c.engine))

  const claudeModels = loadClaudeModels()
  const codexModels = loadCodexModels()

  cache = [
    {
      engine: 'claude-code',
      label: ENGINE_LABELS['claude-code'],
      logoUrl: loadEngineLogoDataUrl('claude-code'),
      defaultModel: withEffort('claude-fable-5', 'medium'),
      models: claudeModels
    },
    {
      engine: 'codex',
      label: ENGINE_LABELS.codex,
      logoUrl: loadEngineLogoDataUrl('codex'),
      defaultModel: codexModels[0]?.id ?? withEffort('gpt-5.5', 'medium'),
      models: codexModels
    }
  ]

  return cache.filter((c) => engineIds.includes(c.engine))
}
