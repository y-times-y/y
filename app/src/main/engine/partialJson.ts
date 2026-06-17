/** Extract a JSON string value while it may still be unclosed (streaming tool input). */
export function extractPartialJsonString(partialJson: string, key: string): string | undefined {
  const keyRe = new RegExp(`"${key}"\\s*:`)
  const match = keyRe.exec(partialJson)
  if (!match) return undefined
  let i = partialJson.indexOf('"', match.index + match[0].length)
  if (i === -1) return undefined
  i++
  let out = ''
  while (i < partialJson.length) {
    const c = partialJson[i]
    if (c === '\\' && i + 1 < partialJson.length) {
      const next = partialJson[i + 1]
      if (next === 'n') out += '\n'
      else if (next === 't') out += '\t'
      else if (next === '"') out += '"'
      else if (next === '\\') out += '\\'
      else out += next
      i += 2
      continue
    }
    if (c === '"') break
    out += c
    i++
  }
  return out.length ? out : undefined
}
