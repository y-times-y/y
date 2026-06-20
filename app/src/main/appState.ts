import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'path'
import { mkdir, readFile, readdir, stat, writeFile } from 'fs/promises'
import { watch, type FSWatcher } from 'fs'
import { randomUUID } from 'crypto'
import { captureCheckpoint, restoreCheckpoint } from './userlandGit'

type StoredMsg = {
  role: 'user' | 'assistant' | 'tool' | 'thinking'
  text?: string
  name?: string
  id?: string
  verb?: string
  target?: string
  body?: string
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

const STATE_VERSION = 1
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

function now(): string {
  return new Date().toISOString()
}

function newChat(title = 'New chat', messages: StoredMsg[] = []): StoredChat {
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

async function loadState(): Promise<AppState> {
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

async function saveState(state: AppState): Promise<AppState> {
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(stateFile(), JSON.stringify(state, null, 2), 'utf-8')
  return state
}

function broadcastState(state: AppState): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('app:stateChanged', state)
  }
}

async function mutateState(fn: (state: AppState) => AppState): Promise<AppState> {
  const next = await saveState(fn(await loadState()))
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

async function resolveProjectFile(projectId: string | undefined, filePath: string): Promise<{ project?: StoredProject; path?: string; error?: string }> {
  const current = await loadState()
  const project =
    current.projects.find((p) => p.id === projectId) ??
    current.projects.find((p) => p.id === current.activeProjectId)
  if (!project) return { error: 'Open a project folder first.' }
  const root = resolve(project.path)
  const abs = resolve(filePath)
  if (!isInside(root, abs)) return { error: 'That file is outside the selected project.' }
  return { project, path: abs }
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

  ipcMain.handle('app:searchFiles', async (_e, projectId: string | undefined, query = '') => {
    const current = await loadState()
    const project = projectId
      ? current.projects.find((p) => p.id === projectId)
      : current.projects.find((p) => p.id === current.activeProjectId)
    if (!project) return { ok: false, files: [], error: 'Open a project folder first.' }
    return { ok: true, files: await searchProjectFiles(project.path, query.trim().toLowerCase()) }
  })

  ipcMain.handle('app:listDirectory', async (_e, projectId: string | undefined, directory = '') => {
    const current = await loadState()
    const project = projectId
      ? current.projects.find((p) => p.id === projectId)
      : current.projects.find((p) => p.id === current.activeProjectId)
    if (!project) return { ok: false, entries: [], error: 'Open a project folder first.' }
    try {
      return { ok: true, entries: await listProjectDirectory(project.path, directory) }
    } catch (err) {
      return { ok: false, entries: [], error: err instanceof Error ? err.message : 'Could not list folder.' }
    }
  })

  ipcMain.handle('app:watchFiles', async (event, projectId?: string) => {
    const current = await loadState()
    const project = projectId
      ? current.projects.find((p) => p.id === projectId)
      : current.projects.find((p) => p.id === current.activeProjectId)
    if (!project) return { ok: false, error: 'Open a project folder first.' }

    stopProjectWatcher(event.sender.id)
    try {
      const entry: {
        projectId: string
        watcher: FSWatcher
        timer: ReturnType<typeof setTimeout> | null
        changedPaths: Set<string>
      } = {
        projectId: project.id,
        watcher: watch(project.path, { recursive: true }, (_kind, filename) => {
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

  ipcMain.handle('app:readProjectFile', async (_e, projectId: string | undefined, filePath: string): Promise<ProjectFileResult> => {
    const resolved = await resolveProjectFile(projectId, filePath)
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
        return { ok: true, content: `data:${mime};base64,${buf.toString('base64')}` }
      }
      if (info.size > 4 * 1024 * 1024) return { ok: false, error: 'This file is too large to edit here.' }
      return { ok: true, content: await readFile(resolved.path, 'utf-8') }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Could not read file.' }
    }
  })

  ipcMain.handle('app:writeProjectFile', async (_e, projectId: string | undefined, filePath: string, content: string): Promise<ProjectFileResult> => {
    const resolved = await resolveProjectFile(projectId, filePath)
    if (!resolved.path) return { ok: false, error: resolved.error || 'Could not resolve file.' }
    try {
      await mkdir(dirname(resolved.path), { recursive: true })
      await writeFile(resolved.path, content, 'utf-8')
      return { ok: true, content }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Could not write file.' }
    }
  })

  ipcMain.handle('app:createChat', async (_e, projectId?: string) => {
    const state = await mutateState((current) => {
      const targetProjectId = projectId ?? current.activeProjectId
      const project = current.projects.find((p) => p.id === targetProjectId) ?? current.projects[0]
      if (!project) return current
      const chat = newChat()
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
}
