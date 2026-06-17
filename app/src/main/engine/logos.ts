import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

const ENGINE_LOGO_FILES: Record<string, string> = {
  'claude-code': 'claude-code.png',
  codex: 'codex.png'
}

function logoFilePath(fileName: string): string | null {
  const candidates = [
    join(app.getAppPath(), 'src/main/assets/engines', fileName),
    join(__dirname, 'assets/engines', fileName)
  ]
  for (const path of candidates) {
    if (existsSync(path)) return path
  }
  return null
}

export function loadEngineLogoDataUrl(engine: string): string | undefined {
  const fileName = ENGINE_LOGO_FILES[engine]
  if (!fileName) return undefined
  const path = logoFilePath(fileName)
  if (!path) return undefined
  try {
    const b64 = readFileSync(path).toString('base64')
    return `data:image/png;base64,${b64}`
  } catch {
    return undefined
  }
}
