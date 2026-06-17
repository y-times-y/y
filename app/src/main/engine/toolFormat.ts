// Human-readable tool activity for the chat UI — verb + target, Codex-style.

import { extractPartialJsonString } from './partialJson'

export interface ToolPresentation {
  verb: string // display label: Read, Edit, Grep…
  target?: string // file path, pattern, or command snippet
  body?: string // edit diff preview, file snippet, etc.
}

function toolVerb(name: string): string {
  const map: Record<string, string> = {
    Read: 'Read',
    Edit: 'Edit',
    Write: 'Write',
    Grep: 'Grep',
    Glob: 'Glob',
    shell: 'Run'
  }
  return map[name] ?? name.charAt(0).toUpperCase() + name.slice(1)
}

function shortPath(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/')
  const file = parts[parts.length - 1] || p
  if (parts.length <= 2) return file
  return parts[parts.length - 2] + '/' + file
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max) + '…'
}

function decodeJsonString(raw: string): string {
  return raw.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
}

function tryParseObject(json: string): Record<string, unknown> | null {
  if (!json.trim()) return null
  try {
    const v = JSON.parse(json) as unknown
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function pickString(input: Record<string, unknown>, key: string): string | undefined {
  const v = input[key]
  return typeof v === 'string' ? v : undefined
}

function diffPreview(oldS: string, newS: string, maxOutLines = 500): string {
  const oldLines = oldS.split('\n')
  const newLines = newS.split('\n')
  const out: string[] = []
  const max = Math.max(oldLines.length, newLines.length)
  for (let i = 0; i < max && out.length < maxOutLines; i++) {
    const o = oldLines[i]
    const n = newLines[i]
    if (o === n) continue
    if (o !== undefined) out.push('- ' + o)
    if (n !== undefined) out.push('+ ' + n)
  }
  if (out.length === 0) return newS || oldS
  return out.join('\n')
}

function partialFilePath(partialJson: string): string | undefined {
  const fromPartial = extractPartialJsonString(partialJson, 'file_path')
  if (fromPartial) return shortPath(fromPartial)
  const m = partialJson.match(/"file_path"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/)
  if (!m?.[1]) return undefined
  return shortPath(decodeJsonString(m[1]))
}

function partialEditBody(partialJson: string): string | undefined {
  const oldS = extractPartialJsonString(partialJson, 'old_string') ?? ''
  const newS = extractPartialJsonString(partialJson, 'new_string') ?? ''
  if (!oldS && !newS) return partialEditBodyLegacy(partialJson)
  return diffPreview(oldS, newS)
}

function partialEditBodyLegacy(partialJson: string): string | undefined {
  const oldM = partialJson.match(/"old_string"\s*:\s*"((?:[^"\\]|\\.)*)"/)
  const newM = partialJson.match(/"new_string"\s*:\s*"((?:[^"\\]|\\.)*)"/)
  if (!oldM && !newM) return undefined
  const oldS = oldM ? decodeJsonString(oldM[1]) : ''
  const newS = newM ? decodeJsonString(newM[1]) : ''
  if (!oldS && !newS) return undefined
  return diffPreview(oldS, newS)
}

function partialWriteBody(partialJson: string): string | undefined {
  const content = extractPartialJsonString(partialJson, 'content')
  if (!content) return partialWriteBodyLegacy(partialJson)
  return content
    .split('\n')
    .map((l) => '+ ' + l)
    .join('\n')
}

function partialWriteBodyLegacy(partialJson: string): string | undefined {
  const m = partialJson.match(/"content"\s*:\s*"((?:[^"\\]|\\.)*)/)
  if (!m?.[1]) return undefined
  const legacy = decodeJsonString(m[1])
  if (!legacy) return undefined
  return legacy
    .split('\n')
    .map((l) => '+ ' + l)
    .join('\n')
}

function present(name: string, input: Record<string, unknown>): ToolPresentation {
  const verb = toolVerb(name)
  const fp = pickString(input, 'file_path')

  switch (name) {
    case 'Read': {
      const limit = input.limit
      const suffix = typeof limit === 'number' ? ` · first ${limit} lines` : ''
      return { verb, target: fp ? shortPath(fp) + suffix : undefined }
    }
    case 'Edit': {
      const oldS = pickString(input, 'old_string') ?? ''
      const newS = pickString(input, 'new_string') ?? ''
      return {
        verb,
        target: fp ? shortPath(fp) : undefined,
        body: oldS || newS ? diffPreview(oldS, newS) : undefined
      }
    }
    case 'Write': {
      const content = pickString(input, 'content') ?? ''
      return {
        verb,
        target: fp ? shortPath(fp) : undefined,
        body: content
          ? content
              .split('\n')
              .map((l) => '+ ' + l)
              .join('\n')
          : undefined
      }
    }
    case 'Grep': {
      const pattern = pickString(input, 'pattern')
      const path = pickString(input, 'path')
      return {
        verb,
        target: pattern
          ? path
            ? `"${pattern}" in ${shortPath(path)}`
            : `"${pattern}"`
          : path
            ? shortPath(path)
            : undefined
      }
    }
    case 'Glob': {
      const pattern = pickString(input, 'pattern')
      const path = pickString(input, 'path')
      return {
        verb,
        target: pattern
          ? path
            ? `${pattern} in ${shortPath(path)}`
            : pattern
          : path
            ? shortPath(path)
            : undefined
      }
    }
    default:
      return { verb, body: truncate(JSON.stringify(input, null, 2), 800) }
  }
}

/** Best-effort label while tool input JSON is still streaming in. */
export function formatToolStream(name: string, partialJson: string): ToolPresentation {
  const parsed = tryParseObject(partialJson)
  if (parsed) return present(name, parsed)

  const verb = toolVerb(name)
  const fp = partialFilePath(partialJson)
  let body: string | undefined
  if (name === 'Edit') body = partialEditBody(partialJson)
  else if (name === 'Write') body = partialWriteBody(partialJson)

  if (fp) return { verb, target: shortPath(fp), body }

  return { verb, body }
}

/** Final label once the tool input JSON is complete. */
export function formatToolFinal(name: string, json: string): ToolPresentation {
  const parsed = tryParseObject(json)
  if (parsed) return present(name, parsed)
  return { verb: toolVerb(name) }
}

export { toolVerb }
