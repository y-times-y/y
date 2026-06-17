import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'path'
import { mkdir, readFile, readdir, stat, writeFile } from 'fs/promises'
import { randomUUID } from 'crypto'

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
const MAX_PROJECT_FILES = 300
const MAX_SCAN_DEPTH = 5
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
    terminalRunning: typeof value.terminalRunning === 'boolean' ? value.terminalRunning : undefined
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

async function listProjectFiles(root: string): Promise<SelectedFile[]> {
  const out: SelectedFile[] = []
  async function walk(dir: string, depth: number): Promise<void> {
    if (out.length >= MAX_PROJECT_FILES || depth > MAX_SCAN_DEPTH) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (out.length >= MAX_PROJECT_FILES) return
      if (entry.name.startsWith('.') && entry.name !== '.env' && entry.name !== '.env.example') {
        if (entry.isDirectory() || IGNORED_FILES.has(entry.name)) continue
      }
      if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(abs, depth + 1)
        continue
      }
      if (!entry.isFile() || IGNORED_FILES.has(entry.name)) continue
      try {
        const info = await stat(abs)
        if (info.size > 2 * 1024 * 1024) continue
        out.push({ name: entry.name, path: abs, relPath: relative(root, abs), size: info.size })
      } catch {
        out.push({ name: entry.name, path: abs, relPath: relative(root, abs) })
      }
    }
  }
  await walk(root, 0)
  return out
}

export function registerAppStateBricks(): void {
  ipcMain.handle('app:getState', () => loadState())

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

  ipcMain.handle('app:listFiles', async (_e, projectId?: string) => {
    const current = await loadState()
    const project =
      current.projects.find((p) => p.id === projectId) ??
      current.projects.find((p) => p.id === current.activeProjectId)
    if (!project) return { ok: false, files: [], error: 'Open a project folder first.' }
    return { ok: true, files: await listProjectFiles(project.path) }
  })

  ipcMain.handle('app:readProjectFile', async (_e, projectId: string | undefined, filePath: string): Promise<ProjectFileResult> => {
    const resolved = await resolveProjectFile(projectId, filePath)
    if (!resolved.path) return { ok: false, error: resolved.error || 'Could not resolve file.' }
    try {
      const info = await stat(resolved.path)
      if (!info.isFile()) return { ok: false, error: 'Only files can be opened.' }
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
