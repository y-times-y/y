import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'path'
import { cp, mkdir, readFile, readdir, realpath, rm, stat, unlink, writeFile } from 'fs/promises'
import { watch, type FSWatcher } from 'fs'
import { randomUUID } from 'crypto'
import { execFile } from 'child_process'
import { promisify } from 'util'
import Database from 'better-sqlite3'
import type { Database as SqliteDb } from 'better-sqlite3'
import { captureCheckpoint, restoreCheckpoint } from './userlandGit'

type StoredMsg = {
  role: 'user' | 'assistant' | 'tool' | 'thinking'
  text?: string
  name?: string
  id?: string
  verb?: string
  target?: string
  body?: string
  failed?: boolean
  streaming?: boolean
  system?: boolean
  engineId?: string
  terminalId?: string
  terminalRunning?: boolean
  checkpointId?: string
  durationMs?: number
  interrupted?: boolean
}

type StoredChat = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messages: StoredMsg[]
  archived?: boolean
  engineId?: string
  modelId?: string
  goal?: string
  runOptions?: Record<string, unknown>
}

type StoredProject = {
  id: string
  name: string
  path: string
  open: boolean
  chats: StoredChat[]
}

type StoredModifyChat = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messages: StoredMsg[]
  archived?: boolean
  engineId?: string
  modelId?: string
  runOptions?: Record<string, unknown>
}

type AppState = {
  version: 1
  activeProjectId?: string
  activeChatId?: string
  projects: StoredProject[]
}

type SelectedFile = {
  name: string
  path: string
  relPath?: string
  size?: number
}

type ProjectDirectoryEntry = SelectedFile & {
  kind: 'file' | 'directory'
}

type ProjectFileResult = {
  ok: boolean
  content?: string
  path?: string
  relPath?: string
  error?: string
}

type CreateChatOptions = {
  isolate?: boolean
}

type SaveStateOptions = {
  allowShrink?: boolean
  eventType?: string
}

type IsolationStatus = {
  ok: boolean
  git: boolean
  canIsolate: boolean
  hasHead: boolean
  reason?: string
  error?: string
}

type UpdateChatPatch = {
  title?: string
  messages?: StoredMsg[]
  archived?: boolean
  engineId?: string
  modelId?: string
  goal?: string
  runOptions?: Record<string, unknown>
}

type UpdateModifyChatPatch = {
  title?: string
  messages?: StoredMsg[]
  archived?: boolean
  engineId?: string
  modelId?: string
  runOptions?: Record<string, unknown>
}

type ProjectRow = {
  id: string
  name: string
  path: string
  open: number
}

type ChatRow = {
  id: string
  title: string
  created_at: string
  updated_at: string
  archived: number
  engine_id: string | null
  model_id: string | null
  goal: string | null
  run_options: string | null
}

type ModifyChatRow = {
  id: string
  title: string
  created_at: string
  updated_at: string
  archived: number
  engine_id: string | null
  model_id: string | null
  run_options: string | null
  messages_json: string
  position: number
}

type MessageRow = {
  role: StoredMsg['role']
  text: string | null
  name: string | null
  msg_id: string | null
  verb: string | null
  target: string | null
  body: string | null
  failed: number | null
  streaming: number | null
  system: number | null
  engine_id: string | null
  terminal_id: string | null
  terminal_running: number | null
  checkpoint_id: string | null
  duration_ms: number | null
  interrupted: number | null
}

type MetaRow = {
  value: string
}

const STATE_VERSION = 1
const STATE_SCHEMA_VERSION = 1
const STATE_BACKUP_LIMIT = 80
const execFileAsync = promisify(execFile)
const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'out',
  'build',
  '.next',
  '.vite',
  'coverage',
  'playwright-report',
  'test-results'
])
const IGNORED_FILES = new Set(['.DS_Store'])
const projectWatchers = new Map<
  number,
  {
    projectId: string
    root: string
    watcher: FSWatcher
    timer: ReturnType<typeof setTimeout> | null
    changedPaths: Set<string>
  }
>()

function stopProjectWatcher(senderId: number, projectId?: string): void {
  const current = projectWatchers.get(senderId)
  if (!current || (projectId && current.projectId !== projectId)) return
  if (current.timer) clearTimeout(current.timer)
  current.watcher.close()
  projectWatchers.delete(senderId)
}

function ignoredProjectChange(filename: string | Buffer | null): boolean {
  if (!filename) return false
  return String(filename)
    .split(/[\\/]/)
    .some((part) => IGNORED_DIRS.has(part) || IGNORED_FILES.has(part))
}

function stateFile(): string {
  return join(app.getPath('userData'), 'app-state.json')
}

function stateDbFile(): string {
  return join(app.getPath('userData'), 'app-state.db')
}

function stateBackupDir(): string {
  return join(app.getPath('userData'), 'state-backups')
}

function now(): string {
  return new Date().toISOString()
}

function timestampForFile(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-')
}

function safePathSegment(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'repo'
}

function newChat(title = 'New chat', messages: StoredMsg[] = []): StoredChat {
  const t = now()
  return { id: randomUUID(), title, createdAt: t, updatedAt: t, messages }
}

function newModifyChat(title = 'New Modify chat', messages: StoredMsg[] = []): StoredModifyChat {
  const t = now()
  return { id: randomUUID(), title, createdAt: t, updatedAt: t, messages }
}

function sanitizeMessage(input: unknown): StoredMsg | null {
  if (!input || typeof input !== 'object') return null
  const value = input as Record<string, unknown>
  const role = value.role
  if (role !== 'user' && role !== 'assistant' && role !== 'tool' && role !== 'thinking') return null
  return {
    role,
    text: typeof value.text === 'string' ? value.text : undefined,
    name: typeof value.name === 'string' ? value.name : undefined,
    id: typeof value.id === 'string' ? value.id : undefined,
    verb: typeof value.verb === 'string' ? value.verb : undefined,
    target: typeof value.target === 'string' ? value.target : undefined,
    body: typeof value.body === 'string' ? value.body : undefined,
    failed: typeof value.failed === 'boolean' ? value.failed : undefined,
    streaming: typeof value.streaming === 'boolean' ? value.streaming : undefined,
    system: typeof value.system === 'boolean' ? value.system : undefined,
    engineId: typeof value.engineId === 'string' ? value.engineId : undefined,
    terminalId: typeof value.terminalId === 'string' ? value.terminalId : undefined,
    terminalRunning: typeof value.terminalRunning === 'boolean' ? value.terminalRunning : undefined,
    checkpointId: typeof value.checkpointId === 'string' ? value.checkpointId : undefined,
    durationMs: typeof value.durationMs === 'number' && Number.isFinite(value.durationMs) ? value.durationMs : undefined,
    interrupted: typeof value.interrupted === 'boolean' ? value.interrupted : undefined
  }
}

function sanitizeChat(input: unknown): StoredChat | null {
  if (!input || typeof input !== 'object') return null
  const value = input as Record<string, unknown>
  if (typeof value.id !== 'string' || typeof value.title !== 'string') return null
  const messages = Array.isArray(value.messages)
    ? value.messages.map(sanitizeMessage).filter((m): m is StoredMsg => Boolean(m))
    : []
  return {
    id: value.id,
    title: value.title || 'New chat',
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : now(),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : now(),
    messages,
    archived: typeof value.archived === 'boolean' ? value.archived : false,
    engineId: typeof value.engineId === 'string' ? value.engineId : undefined,
    modelId: typeof value.modelId === 'string' ? value.modelId : undefined,
    goal: typeof value.goal === 'string' ? value.goal : undefined,
    runOptions:
      value.runOptions && typeof value.runOptions === 'object' && !Array.isArray(value.runOptions)
        ? (value.runOptions as Record<string, unknown>)
        : undefined
  }
}

function sanitizeProject(input: unknown): StoredProject | null {
  if (!input || typeof input !== 'object') return null
  const value = input as Record<string, unknown>
  if (typeof value.id !== 'string' || typeof value.path !== 'string') return null
  const chats = Array.isArray(value.chats)
    ? value.chats.map(sanitizeChat).filter((c): c is StoredChat => Boolean(c))
    : []
  return {
    id: value.id,
    name: typeof value.name === 'string' && value.name ? value.name : basename(value.path),
    path: value.path,
    open: typeof value.open === 'boolean' ? value.open : true,
    chats: chats.length ? chats : [newChat()]
  }
}

async function loadLegacyJsonState(): Promise<AppState> {
  try {
    const raw = JSON.parse(await readFile(stateFile(), 'utf-8')) as Record<string, unknown>
    const projects = Array.isArray(raw.projects)
      ? raw.projects.map(sanitizeProject).filter((p): p is StoredProject => Boolean(p))
      : []
    const firstProject = projects[0]
    const activeProjectId =
      typeof raw.activeProjectId === 'string' &&
      projects.some((project) => project.id === raw.activeProjectId)
        ? raw.activeProjectId
        : firstProject?.id
    const activeProject = projects.find((project) => project.id === activeProjectId)
    const activeChatId =
      typeof raw.activeChatId === 'string' &&
      activeProject?.chats.some((chat) => chat.id === raw.activeChatId && !chat.archived)
        ? raw.activeChatId
        : activeProject?.chats.find((chat) => !chat.archived)?.id
    return { version: STATE_VERSION, activeProjectId, activeChatId, projects }
  } catch {
    return { version: STATE_VERSION, projects: [] }
  }
}

async function gitRootFor(folder: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', folder, 'rev-parse', '--show-toplevel'])
    return resolve(stdout.trim())
  } catch {
    return undefined
  }
}

async function hasGitHead(root: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['-C', root, 'rev-parse', '--verify', 'HEAD'])
    return true
  } catch {
    return false
  }
}

async function gitPathList(root: string, args: string[]): Promise<string[]> {
  const { stdout } = await execFileAsync('git', ['-C', root, ...args])
  return stdout.split('\0').map((path) => path.trim()).filter(Boolean)
}

async function copyWorkspacePath(root: string, worktreePath: string, relPath: string): Promise<void> {
  const source = resolve(root, relPath)
  const target = resolve(worktreePath, relPath)
  if (!isInside(root, source) || !isInside(worktreePath, target)) return
  if (!shouldCopyIntoIsolatedWorkspace(root, source)) return

  try {
    await stat(source)
  } catch {
    await rm(target, { recursive: true, force: true })
    return
  }

  await mkdir(dirname(target), { recursive: true })
  await cp(source, target, {
    recursive: true,
    force: true,
    filter: (src) => shouldCopyIntoIsolatedWorkspace(root, src)
  })
}

async function copyWorkingTreeState(root: string, worktreePath: string): Promise<void> {
  const changed = await gitPathList(root, ['diff', '--name-only', '-z', 'HEAD', '--'])
  const untracked = await gitPathList(root, ['ls-files', '--others', '--exclude-standard', '-z'])
  const paths = Array.from(new Set([...changed, ...untracked]))
  for (const path of paths) {
    await copyWorkspacePath(root, worktreePath, path)
  }
}

function isolatedWorkingDirectory(root: string, selectedPath: string, worktreePath: string): string {
  const rel = relative(root, resolve(selectedPath))
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return worktreePath
  return join(worktreePath, rel)
}

async function isolationStatusFor(folder: string): Promise<IsolationStatus> {
  const root = await gitRootFor(folder)
  if (!root) {
    return { ok: true, git: false, canIsolate: false, hasHead: false }
  }
  const hasHead = await hasGitHead(root)
  if (!hasHead) {
    return {
      ok: true,
      git: true,
      canIsolate: false,
      hasHead: false,
      reason: 'Commit once before creating an isolated workspace.'
    }
  }
  return { ok: true, git: true, canIsolate: true, hasHead: true }
}

async function createIsolatedChat(project: StoredProject): Promise<StoredChat> {
  const root = await gitRootFor(project.path)
  if (!root) throw new Error('This folder is not a Git repository.')
  if (!(await hasGitHead(root))) {
    throw new Error('This Git repository has no commits yet. Commit once before creating an isolated workspace.')
  }

  const id = randomUUID()
  const shortId = id.slice(0, 8)
  const worktreeRoot = join(app.getPath('userData'), 'isolated-workspaces', safePathSegment(basename(root)))
  const worktreePath = join(worktreeRoot, shortId)
  const branch = `y/chat-${shortId}`
  await mkdir(worktreeRoot, { recursive: true })
  await execFileAsync('git', ['-C', root, 'worktree', 'add', '-b', branch, worktreePath, 'HEAD'])
  await copyWorkingTreeState(root, worktreePath)

  const chat = newChat()
  return {
    ...chat,
    runOptions: {
      ...(chat.runOptions ?? {}),
      workingDirectory: isolatedWorkingDirectory(root, project.path, worktreePath)
    }
  }
}

async function openStateDb(): Promise<SqliteDb> {
  await mkdir(app.getPath('userData'), { recursive: true })
  const db = new Database(stateDbFile())
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
  `)
  runStateMigrations(db)
  return db
}

function runStateMigrations(db: SqliteDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `)
  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map(
      (row) => row.version
    )
  )

  if (!applied.has(1)) {
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      open INTEGER NOT NULL,
      position INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived INTEGER NOT NULL,
      engine_id TEXT,
      model_id TEXT,
      goal TEXT,
      run_options TEXT,
      position INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      role TEXT NOT NULL,
      text TEXT,
      name TEXT,
      msg_id TEXT,
      verb TEXT,
      target TEXT,
      body TEXT,
      failed INTEGER,
      streaming INTEGER,
      system INTEGER,
      engine_id TEXT,
      terminal_id TEXT,
      terminal_running INTEGER,
      checkpoint_id TEXT,
      duration_ms INTEGER,
      interrupted INTEGER
    );
    CREATE INDEX IF NOT EXISTS chats_project_position_idx ON chats(project_id, position);
    CREATE INDEX IF NOT EXISTS messages_chat_position_idx ON messages(chat_id, position);
    CREATE TABLE IF NOT EXISTS state_events (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      type TEXT NOT NULL,
      before_stats TEXT,
      after_stats TEXT,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS state_events_created_at_idx ON state_events(created_at);
  `)

      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        1,
        'initial-normalized-state',
        now()
      )
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  const messageColumns = new Set(
    (db.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>).map((column) => column.name)
  )
  if (!messageColumns.has('failed')) {
    db.exec('ALTER TABLE messages ADD COLUMN failed INTEGER')
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS modify_chats (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived INTEGER NOT NULL,
      engine_id TEXT,
      model_id TEXT,
      run_options TEXT,
      messages_json TEXT NOT NULL,
      position INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS modify_chats_position_idx ON modify_chats(position);
  `)

  db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run('schemaVersion', String(STATE_SCHEMA_VERSION))
}

function parseJsonObject(value: string | null): Record<string, unknown> | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

function readMeta(db: SqliteDb, key: string): string | undefined {
  return (db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as MetaRow | undefined)?.value
}

function parseMessagesJson(value: string): StoredMsg[] {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed)
      ? parsed.map(sanitizeMessage).filter((message): message is StoredMsg => Boolean(message))
      : []
  } catch {
    return []
  }
}

function readModifyChatsFromDb(db: SqliteDb): { chats: StoredModifyChat[]; activeChatId?: string } {
  const rows = db
    .prepare(
      'SELECT id, title, created_at, updated_at, archived, engine_id, model_id, run_options, messages_json, position FROM modify_chats ORDER BY position ASC'
    )
    .all() as ModifyChatRow[]
  const chats = rows.map((row) => ({
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messages: parseMessagesJson(row.messages_json),
    archived: Boolean(row.archived),
    engineId: row.engine_id ?? undefined,
    modelId: row.model_id ?? undefined,
    runOptions: parseJsonObject(row.run_options)
  }))
  const rawActiveChatId = readMeta(db, 'activeModifyChatId')
  const activeChatId =
    rawActiveChatId && chats.some((chat) => chat.id === rawActiveChatId && !chat.archived)
      ? rawActiveChatId
      : chats.find((chat) => !chat.archived)?.id
  return { chats, activeChatId }
}

function writeModifyChatsToDb(
  db: SqliteDb,
  chats: StoredModifyChat[],
  activeChatId: string | undefined,
  eventType = 'modify.chat.save'
): void {
  const setMeta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
  const upsertChat = db.prepare(`
    INSERT INTO modify_chats (id, title, created_at, updated_at, archived, engine_id, model_id, run_options, messages_json, position)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      archived = excluded.archived,
      engine_id = excluded.engine_id,
      model_id = excluded.model_id,
      run_options = excluded.run_options,
      messages_json = excluded.messages_json,
      position = excluded.position
  `)
  const deleteChat = db.prepare('DELETE FROM modify_chats WHERE id = ?')

  const previous = readModifyChatsFromDb(db).chats
  db.exec('BEGIN IMMEDIATE')
  try {
    if (activeChatId) setMeta.run('activeModifyChatId', activeChatId)
    else db.prepare("DELETE FROM meta WHERE key = 'activeModifyChatId'").run()
    chats.forEach((chat, index) => {
      upsertChat.run(
        chat.id,
        chat.title,
        chat.createdAt,
        chat.updatedAt,
        chat.archived ? 1 : 0,
        chat.engineId ?? null,
        chat.modelId ?? null,
        chat.runOptions ? JSON.stringify(chat.runOptions) : null,
        JSON.stringify(chat.messages),
        index
      )
    })
    const nextIds = new Set(chats.map((chat) => chat.id))
    previous.forEach((chat) => {
      if (!nextIds.has(chat.id)) deleteChat.run(chat.id)
    })
    db.prepare(`
      INSERT INTO state_events (id, created_at, type, before_stats, after_stats, payload)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      now(),
      eventType,
      null,
      null,
      JSON.stringify({ activeModifyChatId: activeChatId, modifyChatIds: chats.map((chat) => chat.id) })
    )
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

async function mutateModifyChats(
  fn: (state: { chats: StoredModifyChat[]; activeChatId?: string }) => { chats: StoredModifyChat[]; activeChatId?: string },
  eventType?: string
): Promise<{ chats: StoredModifyChat[]; activeChatId?: string }> {
  const db = await openStateDb()
  try {
    const current = readModifyChatsFromDb(db)
    const next = fn(current)
    writeModifyChatsToDb(db, next.chats, next.activeChatId, eventType)
    return next
  } finally {
    db.close()
  }
}

function readStateFromDb(db: SqliteDb): AppState {
  const projectRows = db
    .prepare('SELECT id, name, path, open FROM projects ORDER BY position ASC')
    .all() as ProjectRow[]
  const chatStmt = db.prepare(`
    SELECT id, title, created_at, updated_at, archived, engine_id, model_id, goal, run_options
    FROM chats
    WHERE project_id = ?
    ORDER BY position ASC
  `)
  const messageStmt = db.prepare(`
    SELECT role, text, name, msg_id, verb, target, body, failed, streaming, system, engine_id,
      terminal_id, terminal_running, checkpoint_id, duration_ms, interrupted
    FROM messages
    WHERE chat_id = ?
    ORDER BY position ASC
  `)
  const projects: StoredProject[] = projectRows.map((project) => {
    const chats = (chatStmt.all(project.id) as ChatRow[]).map((chat) => {
      const messages = (messageStmt.all(chat.id) as MessageRow[]).map((message) => ({
        role: message.role,
        text: message.text ?? undefined,
        name: message.name ?? undefined,
        id: message.msg_id ?? undefined,
        verb: message.verb ?? undefined,
        target: message.target ?? undefined,
        body: message.body ?? undefined,
        failed: message.failed === null ? undefined : Boolean(message.failed),
        streaming: message.streaming === null ? undefined : Boolean(message.streaming),
        system: message.system === null ? undefined : Boolean(message.system),
        engineId: message.engine_id ?? undefined,
        terminalId: message.terminal_id ?? undefined,
        terminalRunning: message.terminal_running === null ? undefined : Boolean(message.terminal_running),
        checkpointId: message.checkpoint_id ?? undefined,
        durationMs: message.duration_ms ?? undefined,
        interrupted: message.interrupted === null ? undefined : Boolean(message.interrupted)
      }))
      return {
        id: chat.id,
        title: chat.title,
        createdAt: chat.created_at,
        updatedAt: chat.updated_at,
        messages,
        archived: Boolean(chat.archived),
        engineId: chat.engine_id ?? undefined,
        modelId: chat.model_id ?? undefined,
        goal: chat.goal ?? undefined,
        runOptions: parseJsonObject(chat.run_options)
      }
    })
    return {
      id: project.id,
      name: project.name,
      path: project.path,
      open: Boolean(project.open),
      chats: chats.length ? chats : [newChat()]
    }
  })
  const firstProject = projects[0]
  const rawActiveProjectId = readMeta(db, 'activeProjectId')
  const rawActiveChatId = readMeta(db, 'activeChatId')
  const activeProjectId =
    rawActiveProjectId && projects.some((project) => project.id === rawActiveProjectId)
      ? rawActiveProjectId
      : firstProject?.id
  const activeProject = projects.find((project) => project.id === activeProjectId)
  const activeChatId =
    rawActiveChatId && activeProject?.chats.some((chat) => chat.id === rawActiveChatId && !chat.archived)
      ? rawActiveChatId
      : activeProject?.chats.find((chat) => !chat.archived)?.id
  return { version: STATE_VERSION, activeProjectId, activeChatId, projects }
}

function appendStateEvent(
  db: SqliteDb,
  type: string,
  previous: AppState,
  next: AppState
): void {
  db.prepare(`
    INSERT INTO state_events (id, created_at, type, before_stats, after_stats, payload)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(),
    now(),
    type,
    JSON.stringify(stateStats(previous)),
    JSON.stringify(stateStats(next)),
    JSON.stringify({
      activeProjectId: next.activeProjectId,
      activeChatId: next.activeChatId,
      projectIds: next.projects.map((project) => project.id),
      chatIds: next.projects.flatMap((project) => project.chats.map((chat) => chat.id))
    })
  )
}

function writeStateToDb(
  db: SqliteDb,
  state: AppState,
  eventType = 'state.save',
  previousState = readStateFromDb(db)
): void {
  const setMeta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
  const upsertProject = db.prepare(`
    INSERT INTO projects (id, name, path, open, position)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      path = excluded.path,
      open = excluded.open,
      position = excluded.position
  `)
  const upsertChat = db.prepare(`
    INSERT INTO chats (
      id, project_id, title, created_at, updated_at, archived, engine_id, model_id, goal, run_options, position
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      project_id = excluded.project_id,
      title = excluded.title,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      archived = excluded.archived,
      engine_id = excluded.engine_id,
      model_id = excluded.model_id,
      goal = excluded.goal,
      run_options = excluded.run_options,
      position = excluded.position
  `)
  const deleteChatMessages = db.prepare('DELETE FROM messages WHERE chat_id = ?')
  const deleteProject = db.prepare('DELETE FROM projects WHERE id = ?')
  const deleteChat = db.prepare('DELETE FROM chats WHERE id = ?')
  const insertMessage = db.prepare(`
    INSERT INTO messages (
      chat_id, position, role, text, name, msg_id, verb, target, body, failed, streaming, system,
      engine_id, terminal_id, terminal_running, checkpoint_id, duration_ms, interrupted
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  db.exec('BEGIN IMMEDIATE')
  try {
    setMeta.run('version', String(STATE_VERSION))
    setMeta.run('schemaVersion', String(STATE_SCHEMA_VERSION))
    db.prepare("DELETE FROM meta WHERE key IN ('activeProjectId', 'activeChatId')").run()
    if (state.activeProjectId) setMeta.run('activeProjectId', state.activeProjectId)
    if (state.activeChatId) setMeta.run('activeChatId', state.activeChatId)

    state.projects.forEach((project, projectIndex) => {
      upsertProject.run(project.id, project.name, project.path, project.open ? 1 : 0, projectIndex)
      project.chats.forEach((chat, chatIndex) => {
        upsertChat.run(
          chat.id,
          project.id,
          chat.title,
          chat.createdAt,
          chat.updatedAt,
          chat.archived ? 1 : 0,
          chat.engineId ?? null,
          chat.modelId ?? null,
          chat.goal ?? null,
          chat.runOptions ? JSON.stringify(chat.runOptions) : null,
          chatIndex
        )
        deleteChatMessages.run(chat.id)
        chat.messages.forEach((message, messageIndex) => {
          insertMessage.run(
            chat.id,
            messageIndex,
            message.role,
            message.text ?? null,
            message.name ?? null,
            message.id ?? null,
            message.verb ?? null,
            message.target ?? null,
            message.body ?? null,
            typeof message.failed === 'boolean' ? (message.failed ? 1 : 0) : null,
            typeof message.streaming === 'boolean' ? (message.streaming ? 1 : 0) : null,
            typeof message.system === 'boolean' ? (message.system ? 1 : 0) : null,
            message.engineId ?? null,
            message.terminalId ?? null,
            typeof message.terminalRunning === 'boolean' ? (message.terminalRunning ? 1 : 0) : null,
            message.checkpointId ?? null,
            typeof message.durationMs === 'number' ? message.durationMs : null,
            typeof message.interrupted === 'boolean' ? (message.interrupted ? 1 : 0) : null
          )
        })
      })
    })
    const nextProjectIds = new Set(state.projects.map((project) => project.id))
    const nextChatIds = new Set(state.projects.flatMap((project) => project.chats.map((chat) => chat.id)))
    previousState.projects.forEach((project) => {
      if (!nextProjectIds.has(project.id)) {
        deleteProject.run(project.id)
        return
      }
      project.chats.forEach((chat) => {
        if (!nextChatIds.has(chat.id)) deleteChat.run(chat.id)
      })
    })
    appendStateEvent(db, eventType, previousState, state)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

async function loadState(): Promise<AppState> {
  const db = await openStateDb()
  try {
    const current = readStateFromDb(db)
    if (current.projects.length) return current

    const legacy = await loadLegacyJsonState()
    if (legacy.projects.length) {
      writeStateToDb(db, legacy, 'state.migrate.legacy-json', current)
      return legacy
    }
    return current
  } finally {
    db.close()
  }
}

function stateStats(state: AppState): { projects: number; chats: number; messages: number } {
  return {
    projects: state.projects.length,
    chats: state.projects.reduce((sum, project) => sum + project.chats.length, 0),
    messages: state.projects.reduce(
      (sum, project) =>
        sum + project.chats.reduce((chatSum, chat) => chatSum + chat.messages.length, 0),
      0
    )
  }
}

function summarizeStateChange(previous: AppState, next: AppState): string {
  const before = stateStats(previous)
  const after = stateStats(next)
  return `app-state shrink blocked: projects ${before.projects}->${after.projects}, chats ${before.chats}->${after.chats}, messages ${before.messages}->${after.messages}`
}

function shrinksUserData(previous: AppState, next: AppState): boolean {
  const before = stateStats(previous)
  const after = stateStats(next)
  return after.projects < before.projects || after.chats < before.chats
}

async function backupCurrentState(db: SqliteDb, label = 'before-save'): Promise<void> {
  try {
    const dir = stateBackupDir()
    await mkdir(dir, { recursive: true })
    await db.backup(join(dir, `app-state.${timestampForFile()}.${label}.db`))
    const backups = (await readdir(dir))
      .filter((name) => name.startsWith('app-state.') && (name.endsWith('.json') || name.endsWith('.db')))
      .sort()
    const stale = backups.slice(0, Math.max(0, backups.length - STATE_BACKUP_LIMIT))
    await Promise.all(stale.map((name) => unlink(join(dir, name)).catch(() => undefined)))
  } catch {
    // No existing state yet, or backup failed. Saving should not fail solely because
    // a defensive backup could not be made.
  }
}

async function saveState(state: AppState, options: SaveStateOptions = {}): Promise<AppState> {
  const db = await openStateDb()
  try {
    const previous = readStateFromDb(db)
    if (previous.projects.length) {
      await backupCurrentState(db, 'before-save')
      if (!options.allowShrink && shrinksUserData(previous, state)) {
        const dir = stateBackupDir()
        await mkdir(dir, { recursive: true })
        await writeFile(
          join(dir, `rejected-app-state.${timestampForFile()}.json`),
          JSON.stringify({ reason: summarizeStateChange(previous, state), rejected: state }, null, 2),
          'utf-8'
        )
        throw new Error(summarizeStateChange(previous, state))
      }
    }
    writeStateToDb(db, state, options.eventType ?? 'state.save', previous)
    return state
  } finally {
    db.close()
  }
}

function broadcastState(state: AppState): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('app:stateChanged', state)
  }
}

async function mutateState(fn: (state: AppState) => AppState, options?: SaveStateOptions): Promise<AppState> {
  const next = await saveState(fn(await loadState()), options)
  broadcastState(next)
  return next
}

function ensureActive(state: AppState): AppState {
  const project =
    state.projects.find((p) => p.id === state.activeProjectId) ?? state.projects[0] ?? null
  return {
    ...state,
    activeProjectId: project?.id,
    activeChatId:
      project?.chats.find((c) => c.id === state.activeChatId && !c.archived)?.id ??
      project?.chats.find((c) => !c.archived)?.id
  }
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel))
}

const WORKTREE_COPY_SKIP_PARTS = new Set([
  '.git',
  '.DS_Store',
  '__pycache__',
  'node_modules',
  '.venv',
  'venv',
  'dist',
  'build',
  'out',
  '.next',
  'coverage'
])

function shouldCopyIntoIsolatedWorkspace(root: string, path: string): boolean {
  const rel = relative(root, path)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return false
  return !rel.split(/[\\/]+/u).some((part) => WORKTREE_COPY_SKIP_PARTS.has(part))
}

function normalizeProjectRelPath(value: string): string {
  return value
    .replace(/^file:\/\//iu, '')
    .replace(/\\/g, '/')
    .replace(/[?#].*$/u, '')
    .replace(/:(\d+)(?::\d+)?$/u, '')
    .replace(/^\.\//u, '')
    .replace(/^\/+/u, '')
}

async function findProjectFileBySuffix(root: string, suffix: string): Promise<string | undefined> {
  const normalizedSuffix = normalizeProjectRelPath(suffix)
  if (!normalizedSuffix) return undefined
  const matches: string[] = []
  async function walk(dir: string): Promise<void> {
    if (matches.length > 1) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue
        await walk(join(dir, entry.name))
        continue
      }
      if ((!entry.isFile() && !entry.isSymbolicLink()) || IGNORED_FILES.has(entry.name)) continue
      const abs = join(dir, entry.name)
      const relPath = relative(root, abs).replace(/\\/g, '/')
      if (relPath === normalizedSuffix || relPath.endsWith(`/${normalizedSuffix}`)) {
        try {
          const info = await stat(abs)
          if (info.isFile()) matches.push(abs)
        } catch {
          if (entry.isFile()) matches.push(abs)
        }
      }
    }
  }
  await walk(root)
  return matches.length === 1 ? matches[0] : undefined
}

async function nearestExistingParent(path: string, root: string): Promise<string> {
  let parent = dirname(path)
  while (parent !== root && isInside(root, parent)) {
    try {
      await realpath(parent)
      return parent
    } catch {
      parent = dirname(parent)
    }
  }
  return parent
}

async function resolveProjectWorkspace(
  project: StoredProject,
  workspaceRoot?: string
): Promise<{ root?: string; error?: string }> {
  const projectRoot = resolve(project.path)
  const requestedRoot = workspaceRoot?.trim() ? resolve(workspaceRoot) : projectRoot
  const realProjectRoot = await realpath(projectRoot).catch(() => projectRoot)
  const realRequestedRoot = await realpath(requestedRoot).catch(() => requestedRoot)
  if (isInside(realProjectRoot, realRequestedRoot)) return { root: requestedRoot }

  const isolatedRoot = resolve(join(app.getPath('userData'), 'isolated-workspaces'))
  const realIsolatedRoot = await realpath(isolatedRoot).catch(() => isolatedRoot)
  if (isInside(realIsolatedRoot, realRequestedRoot)) return { root: requestedRoot }

  return { error: 'That workspace is outside the selected project.' }
}

async function resolveProjectFile(
  projectId: string | undefined,
  filePath: string,
  workspaceRoot?: string
): Promise<{ project?: StoredProject; root?: string; path?: string; error?: string }> {
  const current = await loadState()
  const project =
    current.projects.find((p) => p.id === projectId) ??
    current.projects.find((p) => p.id === current.activeProjectId)
  if (!project) return { error: 'Open a project folder first.' }
  const workspace = await resolveProjectWorkspace(project, workspaceRoot)
  if (!workspace.root) return { project, error: workspace.error || 'Could not resolve workspace.' }
  const root = workspace.root
  const realRoot = await realpath(root).catch(() => root)
  const abs = isAbsolute(filePath) ? resolve(filePath) : resolve(root, normalizeProjectRelPath(filePath))
  if (!isInside(root, abs)) return { error: 'That file is outside the selected project.' }
  try {
    const realAbs = await realpath(abs)
    if (!isInside(realRoot, realAbs)) return { error: 'That file resolves outside the selected project.' }
    return { project, root, path: abs }
  } catch {}
  const relCandidate = isAbsolute(filePath) && isInside(root, abs)
    ? relative(root, abs)
    : normalizeProjectRelPath(filePath)
  const suffixMatch = await findProjectFileBySuffix(root, relCandidate)
  if (suffixMatch) {
    const realMatch = await realpath(suffixMatch).catch(() => suffixMatch)
    if (!isInside(realRoot, realMatch)) return { error: 'That file resolves outside the selected project.' }
    return { project, root, path: suffixMatch }
  }
  const parent = await nearestExistingParent(abs, root)
  const realParent = await realpath(parent).catch(() => parent)
  if (!isInside(realRoot, realParent)) return { error: 'That folder resolves outside the selected project.' }
  return { project, root, path: abs }
}

async function searchProjectFiles(root: string, query: string, limit = 40): Promise<SelectedFile[]> {
  const out: SelectedFile[] = []
  async function walk(dir: string): Promise<void> {
    if (out.length >= limit) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (out.length >= limit) return
      if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(abs)
        continue
      }
      if ((!entry.isFile() && !entry.isSymbolicLink()) || IGNORED_FILES.has(entry.name)) continue
      const relPath = relative(root, abs)
      if (!relPath.toLowerCase().includes(query)) continue
      try {
        const info = await stat(abs)
        if (!info.isFile()) continue
        out.push({ name: entry.name, path: abs, relPath, size: info.size })
      } catch {
        if (entry.isFile()) out.push({ name: entry.name, path: abs, relPath })
      }
    }
  }
  await walk(root)
  return out
}

async function listProjectDirectory(
  root: string,
  relativeDirectory = ''
): Promise<ProjectDirectoryEntry[]> {
  const normalizedRoot = resolve(root)
  const directory = resolve(normalizedRoot, relativeDirectory)
  if (!isInside(normalizedRoot, directory)) throw new Error('That folder is outside the selected project.')
  const directoryInfo = await stat(directory)
  if (!directoryInfo.isDirectory()) throw new Error('That path is not a folder.')

  const entries = await readdir(directory, { withFileTypes: true })
  entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
  const out: ProjectDirectoryEntry[] = []
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue
      const path = join(directory, entry.name)
      out.push({
        kind: 'directory',
        name: entry.name,
        path,
        relPath: relative(normalizedRoot, path)
      })
      continue
    }
    if ((!entry.isFile() && !entry.isSymbolicLink()) || IGNORED_FILES.has(entry.name)) continue
    const path = join(directory, entry.name)
    try {
      const info = await stat(path)
      if (!info.isFile()) continue
      out.push({
        kind: 'file',
        name: entry.name,
        path,
        relPath: relative(normalizedRoot, path),
        size: info.size
      })
    } catch {
      if (entry.isFile()) {
        out.push({ kind: 'file', name: entry.name, path, relPath: relative(normalizedRoot, path) })
      }
    }
  }
  return out
}

export function registerAppStateBricks(): void {
  ipcMain.handle('app:getState', () => loadState())

  ipcMain.handle('app:checkpoint', async (_e, projectId?: string) => {
    const current = await loadState()
    const project = projectId
      ? current.projects.find((p) => p.id === projectId)
      : current.projects.find((p) => p.id === current.activeProjectId)
    if (!project) return { ok: false, error: 'Open a project folder first.' }
    return captureCheckpoint(project.path)
  })

  ipcMain.handle('app:restoreCheckpoint', async (_e, projectId: string | undefined, checkpointId: string) => {
    const current = await loadState()
    const project = projectId
      ? current.projects.find((p) => p.id === projectId)
      : current.projects.find((p) => p.id === current.activeProjectId)
    if (!project) return { ok: false, error: 'Open a project folder first.' }
    return restoreCheckpoint(project.path, checkpointId)
  })

  ipcMain.handle('app:addProject', async () => {
    const focused = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const result = await dialog.showOpenDialog(focused, {
      title: 'Open project folder',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true }
    const folder = result.filePaths[0]
    const state = await mutateState((current) => {
      const existing = current.projects.find((project) => project.path === folder)
      if (existing) {
        return ensureActive({
          ...current,
          activeProjectId: existing.id,
          activeChatId: existing.chats[0]?.id,
          projects: current.projects.map((project) =>
            project.id === existing.id ? { ...project, open: true } : project
          )
        })
      }
      const chat = newChat()
      const project: StoredProject = {
        id: randomUUID(),
        name: basename(folder) || folder,
        path: folder,
        open: true,
        chats: [chat]
      }
      return {
        version: STATE_VERSION,
        activeProjectId: project.id,
        activeChatId: chat.id,
        projects: [project, ...current.projects]
      }
    })
    return { ok: true, state }
  })

  ipcMain.handle('app:selectFiles', async (_e, projectId?: string) => {
    const current = await loadState()
    const project =
      current.projects.find((p) => p.id === projectId) ??
      current.projects.find((p) => p.id === current.activeProjectId)
    const focused = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const result = await dialog.showOpenDialog(focused, {
      title: 'Attach files',
      defaultPath: project?.path,
      properties: ['openFile', 'multiSelections']
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, canceled: true, files: [] }
    }
    const files: SelectedFile[] = await Promise.all(
      result.filePaths.map(async (filePath) => {
        try {
          const info = await stat(filePath)
          return { name: basename(filePath), path: filePath, relPath: project ? relative(project.path, filePath) : undefined, size: info.size }
        } catch {
          return { name: basename(filePath), path: filePath, relPath: project ? relative(project.path, filePath) : undefined }
        }
      })
    )
    return { ok: true, files }
  })

  ipcMain.handle('app:searchFiles', async (_e, projectId: string | undefined, query = '', workspaceRoot?: string) => {
    const current = await loadState()
    const project = projectId
      ? current.projects.find((p) => p.id === projectId)
      : current.projects.find((p) => p.id === current.activeProjectId)
    if (!project) return { ok: false, files: [], error: 'Open a project folder first.' }
    const workspace = await resolveProjectWorkspace(project, workspaceRoot)
    if (!workspace.root) return { ok: false, files: [], error: workspace.error || 'Could not resolve workspace.' }
    return { ok: true, files: await searchProjectFiles(workspace.root, query.trim().toLowerCase()) }
  })

  ipcMain.handle('app:listDirectory', async (_e, projectId: string | undefined, directory = '', workspaceRoot?: string) => {
    const current = await loadState()
    const project = projectId
      ? current.projects.find((p) => p.id === projectId)
      : current.projects.find((p) => p.id === current.activeProjectId)
    if (!project) return { ok: false, entries: [], error: 'Open a project folder first.' }
    try {
      const workspace = await resolveProjectWorkspace(project, workspaceRoot)
      if (!workspace.root) return { ok: false, entries: [], error: workspace.error || 'Could not resolve workspace.' }
      return { ok: true, entries: await listProjectDirectory(workspace.root, directory) }
    } catch (err) {
      return { ok: false, entries: [], error: err instanceof Error ? err.message : 'Could not list folder.' }
    }
  })

  ipcMain.handle('app:watchFiles', async (event, projectId?: string, workspaceRoot?: string) => {
    const current = await loadState()
    const project = projectId
      ? current.projects.find((p) => p.id === projectId)
      : current.projects.find((p) => p.id === current.activeProjectId)
    if (!project) return { ok: false, error: 'Open a project folder first.' }
    const workspace = await resolveProjectWorkspace(project, workspaceRoot)
    if (!workspace.root) return { ok: false, error: workspace.error || 'Could not resolve workspace.' }

    stopProjectWatcher(event.sender.id)
    try {
      const entry: {
        projectId: string
        root: string
        watcher: FSWatcher
        timer: ReturnType<typeof setTimeout> | null
        changedPaths: Set<string>
      } = {
        projectId: project.id,
        root: workspace.root,
        watcher: watch(workspace.root, { recursive: true }, (_kind, filename) => {
          if (ignoredProjectChange(filename)) return
          entry.changedPaths.add(filename ? String(filename).replace(/\\/g, '/') : '')
          if (entry.timer) clearTimeout(entry.timer)
          entry.timer = setTimeout(() => {
            entry.timer = null
            if (!event.sender.isDestroyed()) {
              const paths = [...entry.changedPaths]
              entry.changedPaths.clear()
              event.sender.send('app:filesChanged', { projectId: project.id, paths })
            }
          }, 180)
        }),
        timer: null,
        changedPaths: new Set()
      }
      entry.watcher.on('error', () => stopProjectWatcher(event.sender.id, project.id))
      projectWatchers.set(event.sender.id, entry)
      event.sender.once('destroyed', () => stopProjectWatcher(event.sender.id))
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Could not watch project files.' }
    }
  })

  ipcMain.handle('app:unwatchFiles', (event, projectId?: string) => {
    stopProjectWatcher(event.sender.id, projectId)
    return { ok: true }
  })

  ipcMain.handle('app:readProjectFile', async (_e, projectId: string | undefined, filePath: string, workspaceRoot?: string): Promise<ProjectFileResult> => {
    const resolved = await resolveProjectFile(projectId, filePath, workspaceRoot)
    if (!resolved.path) return { ok: false, error: resolved.error || 'Could not resolve file.' }
    try {
      const info = await stat(resolved.path)
      if (!info.isFile()) return { ok: false, error: 'Only files can be opened.' }
      if (info.size > 20 * 1024 * 1024) return { ok: false, error: 'This file is too large to open here.' }
      const ext = resolved.path.split('.').pop()?.toLowerCase() ?? ''
      const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico']
      if (imageExts.includes(ext)) {
        const buf = await readFile(resolved.path)
        const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : ext === 'ico' ? 'image/x-icon' : 'image/png'
        return { ok: true, content: `data:${mime};base64,${buf.toString('base64')}`, path: resolved.path, relPath: relative(resolved.root!, resolved.path) }
      }
      if (info.size > 4 * 1024 * 1024) return { ok: false, error: 'This file is too large to edit here.' }
      return { ok: true, content: await readFile(resolved.path, 'utf-8'), path: resolved.path, relPath: relative(resolved.root!, resolved.path) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Could not read file.' }
    }
  })

  ipcMain.handle('app:writeProjectFile', async (_e, projectId: string | undefined, filePath: string, content: string, workspaceRoot?: string): Promise<ProjectFileResult> => {
    const resolved = await resolveProjectFile(projectId, filePath, workspaceRoot)
    if (!resolved.path) return { ok: false, error: resolved.error || 'Could not resolve file.' }
    try {
      await mkdir(dirname(resolved.path), { recursive: true })
      await writeFile(resolved.path, content, 'utf-8')
      return { ok: true, content, path: resolved.path, relPath: relative(resolved.root!, resolved.path) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Could not write file.' }
    }
  })

  ipcMain.handle('app:getIsolationStatus', async (_e, projectId?: string): Promise<IsolationStatus> => {
    const current = await loadState()
    const targetProjectId = projectId ?? current.activeProjectId
    const currentProject = current.projects.find((p) => p.id === targetProjectId) ?? current.projects[0]
    if (!currentProject) {
      return { ok: false, git: false, canIsolate: false, hasHead: false, error: 'Open a project folder first.' }
    }
    return isolationStatusFor(currentProject.path)
  })

  ipcMain.handle('app:createChat', async (_e, projectId?: string, options?: CreateChatOptions) => {
    const current = await loadState()
    const targetProjectId = projectId ?? current.activeProjectId
    const currentProject = current.projects.find((p) => p.id === targetProjectId) ?? current.projects[0]
    let isolatedChat: StoredChat | null = null

    if (currentProject && options?.isolate) {
      try {
        isolatedChat = await createIsolatedChat(currentProject)
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Could not create isolated workspace.',
          state: current
        }
      }
    }

    const state = await mutateState((current) => {
      const targetProjectId = projectId ?? current.activeProjectId
      const project = current.projects.find((p) => p.id === targetProjectId) ?? current.projects[0]
      if (!project) return current
      const chat = isolatedChat ?? newChat()
      return {
        ...current,
        activeProjectId: project.id,
        activeChatId: chat.id,
        projects: current.projects.map((p) =>
          p.id === project.id ? { ...p, open: true, chats: [chat, ...p.chats] } : p
        )
      }
    })
    if (!state.activeProjectId) return { ok: false, error: 'Open a project folder first.', state }
    return { ok: true, state }
  })

  ipcMain.handle('app:updateChat', async (_e, projectId: string, chatId: string, patch: UpdateChatPatch) => {
    const messages = Array.isArray(patch?.messages)
      ? patch.messages.map(sanitizeMessage).filter((m): m is StoredMsg => Boolean(m))
      : undefined
    const state = await mutateState((current) => ({
      ...current,
      projects: current.projects.map((project) =>
        project.id !== projectId
          ? project
          : {
              ...project,
              chats: project.chats.map((chat) =>
                chat.id !== chatId
                  ? chat
                  : {
                      ...chat,
                      title: typeof patch?.title === 'string' ? patch.title : chat.title,
                      messages: messages ?? chat.messages,
                      archived: typeof patch?.archived === 'boolean' ? patch.archived : chat.archived,
                      engineId: typeof patch?.engineId === 'string' ? patch.engineId : chat.engineId,
                      modelId: typeof patch?.modelId === 'string' ? patch.modelId : chat.modelId,
                      goal: typeof patch?.goal === 'string' ? patch.goal : chat.goal,
                      runOptions:
                        patch?.runOptions && typeof patch.runOptions === 'object'
                          ? patch.runOptions
                          : chat.runOptions,
                      updatedAt: now()
                    }
              )
            }
      )
    }))
    return { ok: true, state }
  })

  ipcMain.handle('app:setActive', async (_e, projectId: string, chatId: string) => {
    const state = await mutateState((current) =>
      ensureActive({ ...current, activeProjectId: projectId, activeChatId: chatId })
    )
    return { ok: true, state }
  })

  ipcMain.handle('app:setProjectOpen', async (_e, projectId: string, open: boolean) => {
    const state = await mutateState((current) => ({
      ...current,
      projects: current.projects.map((project) =>
        project.id === projectId ? { ...project, open } : project
      )
    }))
    return { ok: true, state }
  })

  ipcMain.handle('app:removeProject', async (_e, projectId: string) => {
    const state = await mutateState((current) => {
      const projects = current.projects.filter((project) => project.id !== projectId)
      return ensureActive({
        ...current,
        projects,
        activeProjectId: current.activeProjectId === projectId ? undefined : current.activeProjectId,
        activeChatId: current.activeProjectId === projectId ? undefined : current.activeChatId
      })
    }, { allowShrink: true, eventType: 'project.remove' })
    return { ok: true, state }
  })

  ipcMain.handle('app:listModifyChats', async () => {
    const state = await mutateModifyChats((current) => {
      const visible = current.chats.filter((chat) => !chat.archived)
      if (visible.length) return current
      const chat = newModifyChat()
      return { chats: [chat, ...current.chats], activeChatId: chat.id }
    }, 'modify.chat.ensure')
    return { ok: true, chats: state.chats.filter((chat) => !chat.archived), activeChatId: state.activeChatId }
  })

  ipcMain.handle('app:createModifyChat', async (_e, seed?: { engineId?: string; modelId?: string; runOptions?: Record<string, unknown> }) => {
    const chat = {
      ...newModifyChat(),
      engineId: typeof seed?.engineId === 'string' ? seed.engineId : undefined,
      modelId: typeof seed?.modelId === 'string' ? seed.modelId : undefined,
      runOptions: seed?.runOptions && typeof seed.runOptions === 'object' ? seed.runOptions : undefined
    }
    const state = await mutateModifyChats((current) => ({
      chats: [chat, ...current.chats],
      activeChatId: chat.id
    }), 'modify.chat.create')
    return { ok: true, chat, chats: state.chats.filter((item) => !item.archived), activeChatId: state.activeChatId }
  })

  ipcMain.handle('app:updateModifyChat', async (_e, chatId: string, patch: UpdateModifyChatPatch) => {
    const messages = Array.isArray(patch?.messages)
      ? patch.messages.map(sanitizeMessage).filter((message): message is StoredMsg => Boolean(message))
      : undefined
    const state = await mutateModifyChats((current) => ({
      ...current,
      chats: current.chats.map((chat) =>
        chat.id !== chatId
          ? chat
          : {
              ...chat,
              title: typeof patch?.title === 'string' ? patch.title : chat.title,
              messages: messages ?? chat.messages,
              archived: typeof patch?.archived === 'boolean' ? patch.archived : chat.archived,
              engineId: typeof patch?.engineId === 'string' ? patch.engineId : chat.engineId,
              modelId: typeof patch?.modelId === 'string' ? patch.modelId : chat.modelId,
              runOptions:
                patch?.runOptions && typeof patch.runOptions === 'object'
                  ? patch.runOptions
                  : chat.runOptions,
              updatedAt: now()
            }
      )
    }), 'modify.chat.update')
    return { ok: true, chats: state.chats.filter((chat) => !chat.archived), activeChatId: state.activeChatId }
  })

  ipcMain.handle('app:setActiveModifyChat', async (_e, chatId: string) => {
    const state = await mutateModifyChats((current) => ({
      ...current,
      activeChatId: current.chats.some((chat) => chat.id === chatId && !chat.archived)
        ? chatId
        : current.activeChatId
    }), 'modify.chat.activate')
    return { ok: true, chats: state.chats.filter((chat) => !chat.archived), activeChatId: state.activeChatId }
  })
}
