// Native-Git checkpoints shared by Userland recovery and project-chat resets.
// Project checkpoints use a temporary index and hidden refs, so y never moves
// the user's HEAD or mutates their real staging index.

import { execFile } from 'node:child_process'
import { mkdtemp, rm, rmdir, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const IDENTITY = ['-c', 'user.name=y', '-c', 'user.email=y@localhost']

export interface SnapResult {
  ok: boolean
  hash?: string
  count?: number
  error?: string
}

export interface CheckpointResult {
  ok: boolean
  checkpointId?: string
  error?: string
}

export interface SnapshotEntry {
  hash: string
  shortHash: string
  message: string
  label: string
  kind: 'original' | 'change' | 'snapshot'
  timestamp: string
  current?: boolean
}

export interface SnapshotHistoryResult {
  ok: boolean
  entries?: SnapshotEntry[]
  error?: string
}

async function run(dir: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd: dir,
    env: env ? { ...process.env, ...env } : process.env,
    maxBuffer: 32 * 1024 * 1024
  })
  return stdout.trim()
}

async function rootFor(dir: string): Promise<string> {
  return resolve(await run(dir, ['rev-parse', '--show-toplevel']))
}

function isNotGitRepositoryError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /not a git repository/i.test(message)
}

async function metadata(dir: string): Promise<{ hash: string; count: number }> {
  const hash = (await run(dir, ['rev-parse', '--short', 'HEAD']).catch(() => '')) || ''
  const raw = await run(dir, ['rev-list', '--count', 'HEAD']).catch(() => '0')
  return { hash, count: Number(raw) || 0 }
}

function cleanSnapshotMessage(message?: string): string {
  return (message || 'snapshot').replace(/\s+/g, ' ').trim().slice(0, 160) || 'snapshot'
}

function labelFromMessage(message: string): { label: string; kind: SnapshotEntry['kind'] } {
  if (message === 'initial userland' || message === 'original app') return { label: 'Original app', kind: 'original' }
  if (message.startsWith('after: ')) return { label: message.slice(7).trim() || 'Verified app change', kind: 'change' }
  if (message.startsWith('snapshot ')) return { label: 'Saved app version', kind: 'snapshot' }
  return { label: message || 'Saved app version', kind: 'snapshot' }
}

async function pinSnapshot(root: string, hash?: string): Promise<void> {
  const commit = hash || await run(root, ['rev-parse', 'HEAD'])
  if (!/^[0-9a-f]{40}$/i.test(commit)) return
  await run(root, ['update-ref', `refs/y/snapshots/${commit}`, commit]).catch(() => {})
}

function parseHistoryLine(line: string, current: string): SnapshotEntry | null {
  const [hash, shortHash, timestamp, message] = line.split('\x1f')
  if (!hash) return null
  const meta = labelFromMessage(message || '')
  return {
    hash,
    shortHash,
    message: message || 'snapshot',
    label: meta.label,
    kind: meta.kind,
    timestamp: new Date((Number(timestamp) || 0) * 1000).toISOString(),
    current: hash === current
  }
}

async function withTemporaryIndex<T>(fn: (env: NodeJS.ProcessEnv) => Promise<T>): Promise<T> {
  const temp = await mkdtemp(join(tmpdir(), 'y-git-'))
  const index = join(temp, 'index')
  try {
    return await fn({ GIT_INDEX_FILE: index })
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}

async function treeFromWorktree(root: string, env: NodeJS.ProcessEnv): Promise<string> {
  await run(root, ['read-tree', '--empty'], env)
  await run(root, ['add', '-A', '--', '.'], env)
  return run(root, ['write-tree'], env)
}

async function treeFiles(root: string, tree: string): Promise<Set<string>> {
  const out = await run(root, ['ls-tree', '-r', '--name-only', '-z', tree])
  return new Set(out ? out.split('\0').filter(Boolean) : [])
}

async function removeEmptyParents(root: string, filepaths: string[]): Promise<void> {
  const parents = new Set<string>()
  for (const filepath of filepaths) {
    let parent = resolve(root, filepath, '..')
    while (parent !== root && parent.startsWith(`${root}${sep}`)) {
      parents.add(parent)
      parent = resolve(parent, '..')
    }
  }
  for (const parent of [...parents].sort((a, b) => b.length - a.length)) {
    await rmdir(parent).catch(() => {})
  }
}

export async function requireNativeGit(): Promise<void> {
  await execFileAsync('git', ['--version'])
}

export async function ensureRepo(dir: string): Promise<void> {
  await requireNativeGit()
  if (!existsSync(join(dir, '.git'))) await run(dir, ['init'])
  const hasHead = await run(dir, ['rev-parse', '--verify', 'HEAD']).then(() => true, () => false)
  if (!hasHead) {
    await run(dir, ['add', '-A'])
    await run(dir, [...IDENTITY, 'commit', '-m', 'initial userland'])
  }
  await pinSnapshot(dir)
}

export async function snapshot(dir: string, message = 'snapshot'): Promise<SnapResult> {
  try {
    await ensureRepo(dir)
    const dirty = Boolean(await run(dir, ['status', '--porcelain=v1', '--untracked-files=all']))
    if (dirty) {
      await run(dir, ['add', '-A'])
      await run(dir, [...IDENTITY, 'commit', '-m', cleanSnapshotMessage(message)])
    }
    await pinSnapshot(dir)
    return { ok: true, ...(await metadata(dir)) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function revert(dir: string): Promise<SnapResult> {
  try {
    await ensureRepo(dir)
    const dirty = Boolean(await run(dir, ['status', '--porcelain=v1', '--untracked-files=all']))
    if (dirty) await run(dir, ['reset', '--hard', 'HEAD'])
    else {
      const parent = await run(dir, ['rev-parse', '--verify', 'HEAD~1']).catch(() => '')
      if (!parent) return { ok: false, error: 'No earlier snapshot to revert to.' }
      await run(dir, ['reset', '--hard', parent])
    }
    return { ok: true, ...(await metadata(dir)) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function history(dir: string, limit = 40): Promise<SnapshotHistoryResult> {
  try {
    await ensureRepo(dir)
    const format = '%H%x1f%h%x1f%ct%x1f%s'
    const out = await run(dir, ['log', `--max-count=${limit}`, `--format=${format}`])
    const refFormat = '%(objectname)\x1f%(objectname:short)\x1f%(committerdate:unix)\x1f%(contents:subject)'
    const pinnedOut = await run(dir, ['for-each-ref', `--format=${refFormat}`, 'refs/y/snapshots']).catch(() => '')
    const current = await run(dir, ['rev-parse', 'HEAD'])
    await pinSnapshot(dir, current)
    const byHash = new Map<string, SnapshotEntry>()
    for (const line of `${out}\n${pinnedOut}`.split('\n').filter(Boolean)) {
      const entry = parseHistoryLine(line, current)
      if (entry) byHash.set(entry.hash, entry)
    }
    const entries = Array.from(byHash.values())
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit)
    return { ok: true, entries }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function restoreSnapshot(dir: string, hash: string): Promise<SnapResult> {
  try {
    await ensureRepo(dir)
    if (!/^[0-9a-f]{7,40}$/i.test(hash)) throw new Error('Invalid snapshot id.')
    const current = await run(dir, ['rev-parse', 'HEAD']).catch(() => '')
    if (current) await pinSnapshot(dir, current)
    const target = await run(dir, ['rev-parse', '--verify', `${hash}^{commit}`])
    await pinSnapshot(dir, target)
    await run(dir, ['reset', '--hard', target])
    return { ok: true, ...(await metadata(dir)) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function captureCheckpoint(dir: string): Promise<CheckpointResult> {
  try {
    await requireNativeGit()
    const root = await rootFor(dir)
    const id = randomUUID()
    await withTemporaryIndex(async (env) => {
      const tree = await treeFromWorktree(root, env)
      const parent = await run(root, ['rev-parse', '--verify', 'HEAD']).catch(() => '')
      const commitArgs = ['commit-tree', tree, '-m', `y checkpoint ${id}`]
      if (parent) commitArgs.splice(2, 0, '-p', parent)
      const commit = await run(root, commitArgs, {
        ...env,
        GIT_AUTHOR_NAME: 'y',
        GIT_AUTHOR_EMAIL: 'y@localhost',
        GIT_COMMITTER_NAME: 'y',
        GIT_COMMITTER_EMAIL: 'y@localhost'
      })
      await run(root, ['update-ref', `refs/y/checkpoints/${id}`, commit])
    })
    return { ok: true, checkpointId: id }
  } catch (err) {
    if (isNotGitRepositoryError(err)) return { ok: true }
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function restoreCheckpoint(dir: string, checkpointId: string): Promise<CheckpointResult> {
  try {
    await requireNativeGit()
    if (!/^[0-9a-f-]{36}$/i.test(checkpointId)) throw new Error('Invalid checkpoint id.')
    const root = await rootFor(dir)
    const target = await run(root, ['rev-parse', '--verify', `refs/y/checkpoints/${checkpointId}^{tree}`])
    await withTemporaryIndex(async (env) => {
      const current = await treeFromWorktree(root, env)
      const [currentFiles, targetFiles] = await Promise.all([
        treeFiles(root, current),
        treeFiles(root, target)
      ])
      const removed: string[] = []
      for (const filepath of currentFiles) {
        if (!targetFiles.has(filepath)) {
          await unlink(join(root, filepath)).catch(() => {})
          removed.push(filepath)
        }
      }
      await removeEmptyParents(root, removed)
      await run(root, ['read-tree', target], env)
      await run(root, ['checkout-index', '-a', '-f'], env)
    })
    return { ok: true, checkpointId }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
