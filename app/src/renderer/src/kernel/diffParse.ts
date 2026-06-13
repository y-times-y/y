export type ParsedDiffFile = {
  path: string
  diff: string
  adds: number
  dels: number
}

/** Split a unified diff into per-file chunks (jsdiff / git format). */
export function parseUnifiedDiff(raw: string): ParsedDiffFile[] {
  if (!raw.trim()) return []

  const chunks = raw.split(/\n(?=--- )/).filter((c) => c.trim())
  const files: ParsedDiffFile[] = []

  for (const chunk of chunks) {
    if (!chunk.startsWith('---')) continue

    const pathMatch =
      chunk.match(/^--- a\/(.+?)(?:\r?\n|$)/m) ||
      chunk.match(/^--- b\/(.+?)(?:\r?\n|$)/m) ||
      chunk.match(/^--- (.+?)(?:\r?\n|$)/m)
    const path = pathMatch?.[1]?.trim()
    if (!path) continue

    let adds = 0
    let dels = 0
    for (const line of chunk.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) adds++
      else if (line.startsWith('-') && !line.startsWith('---')) dels++
    }
    files.push({ path, diff: chunk.trim(), adds, dels })
  }

  return files
}
