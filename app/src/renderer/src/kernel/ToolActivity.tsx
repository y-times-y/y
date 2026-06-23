import * as React from 'react'
import type { CSSProperties } from 'react'
import { highlightLine } from './markdown'

function toolIconName(verb: string, name?: string): string {
  const label = `${verb} ${name ?? ''}`.toLowerCase()
  if (label.includes('edit') || label.includes('write')) return 'edit'
  if (label.includes('read')) return 'files'
  if (label.includes('grep') || label.includes('search') || label.includes('find')) return 'search'
  if (label.includes('glob') || label.includes('list')) return 'folder'
  if (label.includes('shell') || label.includes('bash') || label.includes('run') || label.includes('terminal')) return 'terminal'
  if (label.includes('web') || label.includes('request') || label.includes('fetch')) return 'auto'
  return 'plugins'
}

function ToolActivityIcon({ name, size = 14 }: { name: string; size?: number }): React.JSX.Element {
  const s = { width: size, height: size, display: 'block', flexShrink: 0 } as CSSProperties
  const sw = 1.5
  if (name === 'search') {
    return (
      <svg style={s} viewBox="0 0 20 20" fill="none" aria-hidden>
        <circle cx="10" cy="10" r="5.5" stroke="currentColor" strokeWidth={sw} />
        <path d="M14.5 14.5L17 17" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" />
      </svg>
    )
  }
  if (name === 'plugins') {
    return (
      <svg style={s} viewBox="0 0 20 20" fill="none" aria-hidden>
        <path d="M8.5 3.5h3l2.2 2.2v3.1l-2.2 2.2h-3L6.3 8.8V5.7L8.5 3.5z" stroke="currentColor" strokeWidth={sw} strokeLinejoin="round" />
        <circle cx="10" cy="7.5" r="1.1" fill="currentColor" />
      </svg>
    )
  }
  if (name === 'auto') {
    return (
      <svg style={s} viewBox="0 0 20 20" fill="none" aria-hidden>
        <path d="M11 3L5 11h4l-1 6 6-8h-4l1-6z" stroke="currentColor" strokeWidth={sw} strokeLinejoin="round" />
      </svg>
    )
  }
  if (name === 'folder') {
    return (
      <svg style={s} viewBox="0 0 20 20" fill="none" aria-hidden>
        <path d="M3 6.5A1.5 1.5 0 014.5 5H8l1.5 1.5H15.5A1.5 1.5 0 0117 8v6.5A1.5 1.5 0 0115.5 16h-11A1.5 1.5 0 013 14.5V6.5z" stroke="currentColor" strokeWidth={sw} strokeLinejoin="round" />
      </svg>
    )
  }
  if (name === 'files') {
    return (
      <svg style={s} viewBox="0 0 20 20" fill="none" aria-hidden>
        <path d="M6.5 3.5h5L15 7v8.5A1.5 1.5 0 0113.5 17h-7A1.5 1.5 0 015 15.5v-10A2 2 0 016.5 3.5z" stroke="currentColor" strokeWidth={sw} strokeLinejoin="round" />
        <path d="M11.5 3.8V7h3.2M8 10h4M8 13h4" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (name === 'terminal') {
    return (
      <svg style={s} viewBox="0 0 20 20" fill="none" aria-hidden>
        <rect x="3" y="4" width="14" height="12" rx="2" stroke="currentColor" strokeWidth={sw} />
        <path d="M6 8l2.2 2L6 12M10 12h4" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  return (
    <svg style={s} viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="M12.5 3.5l4 4L8 16H4v-4l8.5-8.5z" stroke="currentColor" strokeWidth={sw} strokeLinejoin="round" />
      <path d="M11 5l4 4" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" />
    </svg>
  )
}

function targetFileName(target?: string): string | undefined {
  if (!target) return undefined
  const matches = target.replace(/ · .*$/, '').match(/[A-Za-z0-9_@.()\/-]+\.[A-Za-z0-9]+/g)
  return matches?.[matches.length - 1]
}

function fileExt(name: string): string {
  const base = name.split('/').pop() || name
  const i = base.lastIndexOf('.')
  return i === -1 ? '' : base.slice(i + 1).toLowerCase()
}

function fileIconMeta(name: string): { label: string; bg: string; fg?: string } {
  const ext = fileExt(name)
  const w = '#ffffff'
  const k = '#1a1a1a'
  const map: Record<string, { label: string; bg: string; fg?: string }> = {
    ts: { label: 'TS', bg: '#3178c6', fg: w },
    tsx: { label: 'TSX', bg: '#0ea5e9', fg: w },
    js: { label: 'JS', bg: '#ca8a04', fg: k },
    jsx: { label: 'JSX', bg: '#ca8a04', fg: k },
    mjs: { label: 'MJS', bg: '#ca8a04', fg: k },
    cjs: { label: 'CJS', bg: '#ca8a04', fg: k },
    py: { label: 'PY', bg: '#2563eb', fg: w },
    rb: { label: 'RB', bg: '#dc2626', fg: w },
    go: { label: 'GO', bg: '#0891b2', fg: w },
    rs: { label: 'RS', bg: '#c2410c', fg: w },
    java: { label: 'JV', bg: '#d97706', fg: w },
    kt: { label: 'KT', bg: '#7c3aed', fg: w },
    swift: { label: 'SW', bg: '#ea580c', fg: w },
    css: { label: 'CSS', bg: '#7c3aed', fg: w },
    scss: { label: 'SCss', bg: '#db2777', fg: w },
    less: { label: 'LES', bg: '#1d4ed8', fg: w },
    html: { label: 'HTM', bg: '#ea580c', fg: w },
    json: { label: '{ }', bg: '#475569', fg: w },
    jsonc: { label: '{ }', bg: '#475569', fg: w },
    md: { label: 'MD', bg: '#4b5563', fg: w },
    mdx: { label: 'MDX', bg: '#4b5563', fg: w },
    yaml: { label: 'YML', bg: '#b91c1c', fg: w },
    yml: { label: 'YML', bg: '#b91c1c', fg: w },
    toml: { label: 'TML', bg: '#92400e', fg: w },
    sh: { label: 'SH', bg: '#059669', fg: w },
    bash: { label: 'SH', bg: '#059669', fg: w },
    zsh: { label: 'ZSH', bg: '#059669', fg: w },
    env: { label: 'ENV', bg: '#065f46', fg: w },
    png: { label: 'PNG', bg: '#6d28d9', fg: w },
    jpg: { label: 'JPG', bg: '#6d28d9', fg: w },
    jpeg: { label: 'JPG', bg: '#6d28d9', fg: w },
    gif: { label: 'GIF', bg: '#6d28d9', fg: w },
    svg: { label: 'SVG', bg: '#b45309', fg: w },
    pdf: { label: 'PDF', bg: '#dc2626', fg: w },
    sql: { label: 'SQL', bg: '#0e7490', fg: w },
    graphql: { label: 'GQL', bg: '#9d174d', fg: w },
    gql: { label: 'GQL', bg: '#9d174d', fg: w },
    prisma: { label: 'PRM', bg: '#0369a1', fg: w },
    lock: { label: 'LCK', bg: '#374151', fg: w },
    xml: { label: 'XML', bg: '#b45309', fg: w },
    csv: { label: 'CSV', bg: '#047857', fg: w },
    txt: { label: 'TXT', bg: '#374151', fg: w }
  }
  return map[ext] || { label: ext ? ext.slice(0, 3).toUpperCase() : 'F', bg: '#374151', fg: w }
}

function FileTypeIcon({ name }: { name: string }): React.JSX.Element {
  const ext = fileExt(name)
  const base = name.split('/').pop() || name
  const isGit = base === '.git' || base.startsWith('.git') || ext === 'git' || base === '.gitignore' || base === '.gitattributes'
  const isNpm = base === 'package.json' || base === 'package-lock.json'

  if (isGit) {
    return (
      <svg width="15" height="15" viewBox="0 0 32 32" aria-hidden="true">
        <path fill="#e64a19" d="M13.172 2.828 11.78 4.22l1.91 1.91 2 2A2.986 2.986 0 0 1 20 10.81a3.25 3.25 0 0 1-.31 1.31l2.06 2a2.68 2.68 0 0 1 3.37.57 2.86 2.86 0 0 1 .88 2.117 3.02 3.02 0 0 1-.856 2.109A2.9 2.9 0 0 1 23 19.81a2.93 2.93 0 0 1-2.13-.87 2.694 2.694 0 0 1-.56-3.38l-2-2.06a3 3 0 0 1-.31.12V20a3 3 0 0 1 1.44 1.09 2.92 2.92 0 0 1 .56 1.72 2.88 2.88 0 0 1-.878 2.128 2.98 2.98 0 0 1-2.048.871 2.981 2.981 0 0 1-2.514-4.719A3 3 0 0 1 16 20v-6.38a2.96 2.96 0 0 1-1.44-1.09 2.9 2.9 0 0 1-.56-1.72 2.9 2.9 0 0 1 .31-1.31l-3.9-3.9-7.579 7.572a4 4 0 0 0-.001 5.658l10.342 10.342a4 4 0 0 0 5.656 0l10.344-10.344a4 4 0 0 0 0-5.656L18.828 2.828a4 4 0 0 0-5.656 0"/>
      </svg>
    )
  }
  if (isNpm) {
    return (
      <svg width="15" height="15" viewBox="0 0 32 32" aria-hidden="true">
        <path fill="#e53935" d="M4 4v24h24V4Zm20 20h-4V12h-4v12H8V8h16Z"/>
      </svg>
    )
  }
  if (ext === 'ts') {
    return (
      <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
        <path fill="#0288d1" d="M2 2v12h12V2zm4 6h3v1H8v4H7V9H6zm5 0h2v1h-2v1h1a1.003 1.003 0 0 1 1 1v1a1.003 1.003 0 0 1-1 1h-2v-1h2v-1h-1a1.003 1.003 0 0 1-1-1V9a1.003 1.003 0 0 1 1-1"/>
      </svg>
    )
  }
  if (ext === 'js' || ext === 'mjs' || ext === 'cjs') {
    return (
      <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
        <path fill="#ffca28" d="M2 2v12h12V2zm6 6h1v4a1.003 1.003 0 0 1-1 1H7a1.003 1.003 0 0 1-1-1v-1h1v1h1zm3 0h2v1h-2v1h1a1.003 1.003 0 0 1 1 1v1a1.003 1.003 0 0 1-1 1h-2v-1h2v-1h-1a1.003 1.003 0 0 1-1-1V9a1.003 1.003 0 0 1 1-1"/>
      </svg>
    )
  }
  if (ext === 'tsx' || ext === 'jsx') {
    return (
      <svg width="15" height="15" viewBox="0 0 32 32" aria-hidden="true">
        <path fill="#00bcd4" d="M16 12c7.444 0 12 2.59 12 4s-4.556 4-12 4-12-2.59-12-4 4.556-4 12-4m0-2c-7.732 0-14 2.686-14 6s6.268 6 14 6 14-2.686 14-6-6.268-6-14-6"/>
        <path fill="#00bcd4" d="M16 14a2 2 0 1 0 2 2 2 2 0 0 0-2-2"/>
        <path fill="#00bcd4" d="M10.458 5.507c2.017 0 5.937 3.177 9.006 8.493 3.722 6.447 3.757 11.687 2.536 12.392a.9.9 0 0 1-.457.1c-2.017 0-5.938-3.176-9.007-8.492C8.814 11.553 8.779 6.313 10 5.608a.9.9 0 0 1 .458-.1m-.001-2A2.87 2.87 0 0 0 9 3.875C6.13 5.532 6.938 12.304 10.804 19c3.284 5.69 7.72 9.493 10.74 9.493A2.87 2.87 0 0 0 23 28.124c2.87-1.656 2.062-8.428-1.804-15.124-3.284-5.69-7.72-9.493-10.74-9.493Z"/>
        <path fill="#00bcd4" d="M21.542 5.507A.9.9 0 0 1 22 5.608c1.22.705 1.186 5.945-2.536 12.392-3.069 5.316-6.99 8.492-9.007 8.492a.9.9 0 0 1-.457-.1C8.78 25.687 8.814 20.447 12.536 14c3.069-5.316 6.99-8.493 9.006-8.493m0-2c-3.019 0-7.455 3.804-10.738 9.493C6.938 19.696 6.13 26.468 9 28.124a2.87 2.87 0 0 0 1.456.369c3.02 0 7.456-3.804 10.74-9.493C25.062 12.304 25.87 5.532 23 3.876a2.87 2.87 0 0 0-1.457-.369Z"/>
      </svg>
    )
  }
  if (ext === 'py') {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#0288d1" d="M9.86 2A2.86 2.86 0 0 0 7 4.86v1.68h4.29c.39 0 .71.57.71.96H4.86A2.86 2.86 0 0 0 2 10.36v3.781a2.86 2.86 0 0 0 2.86 2.86h1.18v-2.68a2.85 2.85 0 0 1 2.85-2.86h5.25c1.58 0 2.86-1.271 2.86-2.851V4.86A2.86 2.86 0 0 0 14.14 2zm-.72 1.61c.4 0 .72.12.72.71s-.32.891-.72.891c-.39 0-.71-.3-.71-.89s.32-.711.71-.711"/>
        <path fill="#fdd835" d="M17.959 7v2.68a2.85 2.85 0 0 1-2.85 2.859H9.86A2.85 2.85 0 0 0 7 15.389v3.75a2.86 2.86 0 0 0 2.86 2.86h4.28A2.86 2.86 0 0 0 17 19.14v-1.68h-4.291c-.39 0-.709-.57-.709-.96h7.14A2.86 2.86 0 0 0 22 13.64V9.86A2.86 2.86 0 0 0 19.14 7zM14.86 18.61c.39 0 .71.3.71.89a.71.71 0 0 1-.71.71c-.4 0-.72-.12-.72-.71s.32-.89.72-.89"/>
      </svg>
    )
  }
  if (ext === 'md' || ext === 'mdx') {
    return (
      <svg width="15" height="15" viewBox="0 0 32 32" aria-hidden="true">
        <path fill="#42a5f5" d="m14 10-4 3.5L6 10H4v12h4v-6l2 2 2-2v6h4V10zm12 6v-6h-4v6h-4l6 8 6-8z"/>
      </svg>
    )
  }
  if (ext === 'json' || ext === 'jsonc') {
    return (
      <svg width="15" height="15" viewBox="0 -960 960 960" aria-hidden="true">
        <path fill="#f9a825" d="M560-160v-80h120q17 0 28.5-11.5T720-280v-80q0-38 22-69t58-44v-14q-36-13-58-44t-22-69v-80q0-17-11.5-28.5T680-720H560v-80h120q50 0 85 35t35 85v80q0 17 11.5 28.5T840-560h40v160h-40q-17 0-28.5 11.5T800-360v80q0 50-35 85t-85 35zm-280 0q-50 0-85-35t-35-85v-80q0-17-11.5-28.5T120-400H80v-160h40q17 0 28.5-11.5T160-600v-80q0-50 35-85t85-35h120v80H280q-17 0-28.5 11.5T240-680v80q0 38-22 69t-58 44v14q36 13 58 44t22 69v80q0 17 11.5 28.5T280-240h120v80z"/>
      </svg>
    )
  }
  if (ext === 'html' || ext === 'htm') {
    return (
      <svg width="15" height="15" viewBox="0 0 32 32" aria-hidden="true">
        <path fill="#e65100" d="m4 4 2 22 10 2 10-2 2-22Zm19.72 7H11.28l.29 3h11.86l-.802 9.335L15.99 25l-6.635-1.646L8.93 19h3.02l.19 2 3.86.77 3.84-.77.29-4H8.84L8 8h16Z"/>
      </svg>
    )
  }
  if (ext === 'css') {
    return (
      <svg width="15" height="15" viewBox="0 0 32 32" aria-hidden="true">
        <path fill="#7e57c2" d="M20 18h-2v-2h-2v2c0 .193 0 .703 1.254 1.033A3.345 3.345 0 0 1 20 22h2v2h2v-2c0-.388-.562-.851-1.254-1.034C20.356 20.34 20 18.84 20 18m-3.254 2.966C14.356 20.34 14 18.84 14 18h-2v-2h-2v8h2v-2h4v2h2v-2c0-.388-.562-.851-1.254-1.034"/>
        <path fill="#7e57c2" d="M24 4H4v20a4 4 0 0 0 4 4h16.16A3.84 3.84 0 0 0 28 24.16V8a4 4 0 0 0-4-4m2 14h-2v-2h-2v2c0 .193 0 .703 1.254 1.033A3.345 3.345 0 0 1 26 22v2a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2 2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2 2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2 2 2 0 0 1 2-2h2a2 2 0 0 1 2 2 2 2 0 0 1 2-2h2a2 2 0 0 1 2 2Z"/>
      </svg>
    )
  }
  if (ext === 'sh' || ext === 'bash' || ext === 'zsh') {
    return (
      <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
        <path fill="#ff7043" d="M2 2a1 1 0 0 0-1 1v10c0 .554.446 1 1 1h12c.554 0 1-.446 1-1V3a1 1 0 0 0-1-1zm0 3h12v8H2zm1 2 2 2-2 2 1 1 3-3-3-3zm5 3.5V12h5v-1.5z"/>
      </svg>
    )
  }
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'gif' || ext === 'webp') {
    return (
      <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
        <path fill="#26a69a" d="M8.5 6h4l-4-4zM3.875 1H9.5l4 4v8.6c0 .773-.616 1.4-1.375 1.4h-8.25c-.76 0-1.375-.627-1.375-1.4V2.4c0-.777.612-1.4 1.375-1.4M4 13.6h8V8l-2.625 2.8L8 9.4zm1.25-7.7c-.76 0-1.375.627-1.375 1.4s.616 1.4 1.375 1.4c.76 0 1.375-.627 1.375-1.4S6.009 5.9 5.25 5.9"/>
      </svg>
    )
  }
  if (ext === 'pdf') {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#ef5350" d="M13 9h5.5L13 3.5zM6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2m4.93 10.44c.41.9.93 1.64 1.53 2.15l.41.32c-.87.16-2.07.44-3.34.93l-.11.04.5-1.04c.45-.87.78-1.66 1.01-2.4m6.48 3.81c.18-.18.27-.41.28-.66.03-.2-.02-.39-.12-.55-.29-.47-1.04-.69-2.28-.69l-1.29.07-.87-.58c-.63-.52-1.2-1.43-1.6-2.56l.04-.14c.33-1.33.64-2.94-.02-3.6a.85.85 0 0 0-.61-.24h-.24c-.37 0-.7.39-.79.77-.37 1.33-.15 2.06.22 3.27v.01c-.25.88-.57 1.9-1.08 2.93l-.96 1.8-.89.49c-1.2.75-1.77 1.59-1.88 2.12-.04.19-.02.36.05.54l.03.05.48.31.44.11c.81 0 1.73-.95 2.97-3.07l.18-.07c1.03-.33 2.31-.56 4.03-.75 1.03.51 2.24.74 3 .74.44 0 .74-.11.91-.3m-.41-.71.09.11c-.01.1-.04.11-.09.13h-.04l-.19.02c-.46 0-1.17-.19-1.9-.51.09-.1.13-.1.23-.1 1.4 0 1.8.25 1.9.35M7.83 17c-.65 1.19-1.24 1.85-1.69 2 .05-.38.5-1.04 1.21-1.69zm3.02-6.91c-.23-.9-.24-1.63-.07-2.05l.07-.12.15.05c.17.24.19.56.09 1.1l-.03.16-.16.82z"/>
      </svg>
    )
  }
  const meta = fileIconMeta(name)
  return (
    <svg width="16" height="16" viewBox="0 0 100 100" aria-hidden="true">
      <rect width="100" height="100" rx="14" fill={meta.bg} />
      <text x="50" y="50" textAnchor="middle" dominantBaseline="middle" fill={meta.fg ?? '#fff'} fontFamily="system-ui,-apple-system,'Helvetica Neue',Arial,sans-serif" fontWeight="700" fontSize={meta.label.length >= 4 ? 34 : meta.label.length === 3 ? 40 : 48}>{meta.label}</text>
    </svg>
  )
}

export function diffStat(body?: string): { added: number; removed: number } | null {
  if (!body) return null
  let added = 0
  let removed = 0
  for (const line of body.split('\n')) {
    if (line.startsWith('+ ')) added += 1
    else if (line.startsWith('- ')) removed += 1
  }
  return added || removed ? { added, removed } : null
}

function ToolDiffBody({ body, lang }: { body: string; lang: string }): React.JSX.Element {
  let lineNo = 1
  const lines = body
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const del = line.startsWith('- ')
      const add = line.startsWith('+ ')
      return { line, del, add, raw: del || add || line.startsWith('  ') ? line.slice(2) : line }
    })
  const commonIndent = lines.reduce<number | null>((min, item) => {
    if (!item.raw.trim()) return min
    const indent = item.raw.match(/^ */)?.[0].length ?? 0
    return min === null ? indent : Math.min(min, indent)
  }, null) ?? 0
  return (
    <div className="tool-activity-detail">
      {lines.map(({ del, add, raw }, i) => {
        const text = commonIndent > 0 ? raw.slice(commonIndent) : raw
        const cls = del ? ' tool-diff-del' : add ? ' tool-diff-add' : ''
        const mark = del ? '-' : add ? '+' : ' '
        const currentLine = lineNo
        if (!del) lineNo += 1
        return (
          <div key={i} className={'tool-diff-line' + cls}>
            <span className="tool-diff-ln">{currentLine}</span>
            <span className="tool-diff-gutter">{mark}</span>
            <code dangerouslySetInnerHTML={{ __html: highlightLine(text, lang) }} />
          </div>
        )
      })}
    </div>
  )
}

function ToolPlainBody({ verb, target, body, lang }: { verb: string; target?: string; body?: string; lang: string }): React.JSX.Element {
  const isCommand = /run|shell|bash|terminal/i.test(verb)
  const file = targetFileName(target)
  const highlighted = file && body ? highlightLine(body, lang) : undefined
  return (
    <div className={'tool-activity-detail tool-activity-plain' + (file ? ' has-file' : '')}>
      {isCommand && target ? <div className="tool-activity-command">$ {target}</div> : null}
      {body ? highlighted
        ? <pre><code dangerouslySetInnerHTML={{ __html: highlighted }} /></pre>
        : <pre><code>{body}</code></pre> : null}
    </div>
  )
}

export function ToolActivity({
  verb,
  name,
  target,
  body,
  live,
  lang = 'typescript'
}: {
  verb: string
  name?: string
  target?: string
  body?: string
  live?: boolean
  lang?: string
}): React.JSX.Element {
  const showDiff = !live && !!body && (body.includes('\n- ') || body.startsWith('- ') || body.includes('\n+ '))
  const canExpand = !live && Boolean(body || (/run|shell|bash|terminal/i.test(verb) && target))
  const stat = diffStat(body)
  const targetFile = targetFileName(target)
  const activityLine = (
    <div className="tool-activity-line">
      <span className="tool-activity-icon"><ToolActivityIcon name={toolIconName(verb, name)} size={14} /></span>
      <span className="tool-activity-verb">{verb}</span>
      {target ? (
        <span className="tool-activity-target">
          {targetFile ? <span className="tool-activity-file-icon"><FileTypeIcon name={targetFile} /></span> : null}
          <span>{target}</span>
        </span>
      ) : null}
      {stat ? (
        <span className="tool-activity-stat">
          <span className="tool-stat-add">+{stat.added}</span>
          <span className="tool-stat-del">-{stat.removed}</span>
        </span>
      ) : null}
      {canExpand ? (
        <span className="tool-activity-chevron" aria-hidden="true">
          <svg width="11" height="11" viewBox="0 0 20 20" fill="none"><path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
      ) : null}
    </div>
  )
  if (canExpand) {
    return (
      <details className="tool-activity is-collapsible">
        <summary>{activityLine}</summary>
        {showDiff && body
          ? <ToolDiffBody body={body} lang={lang} />
          : <ToolPlainBody verb={verb} target={target} body={body} lang={lang} />}
      </details>
    )
  }
  return (
    <div className="tool-activity">
      {activityLine}
    </div>
  )
}

export function toolVerbFromName(name: string): string {
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

/** Stop the live shimmer on in-flight tool rows once the model moves on. */
export function settleTools<T extends { role: string; streaming?: boolean; system?: boolean }>(
  list: T[]
): T[] {
  let touched = false
  const out = list.map((m) => {
    if (m.role === 'tool' && m.streaming && !m.system) {
      touched = true
      return { ...m, streaming: false }
    }
    return m
  })
  return touched ? out : list
}
