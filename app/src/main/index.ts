import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { transform } from 'esbuild'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

// ---- Userland lives in a writable folder, NOT inside the app bundle ----
// It sits under Electron's per-user data dir. The app reads it at runtime,
// which is what makes self-modification possible (the app bundle stays sealed).
const DEFAULT_PANEL = `export default function Panel() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>Hello from Userland — as real code</h1>
      <p style={{ opacity: 0.7 }}>
        This panel is a live React component, compiled at runtime by esbuild and
        rendered into the slot. Edit this file and hit "Reload Userland" to run your
        changes.
      </p>
    </div>
  )
}
`

function userlandDir(): string {
  return join(app.getPath('userData'), 'userland')
}

function userlandFile(): string {
  return join(userlandDir(), 'panel.tsx')
}

// Snapshot history lives in a git repo INSIDE the Userland folder — fully
// separate from the project repo. We pass identity via -c flags so we never
// touch the user's global git config, and always run with cwd = userlandDir.
const runFile = promisify(execFile)

async function git(args: string[]): Promise<string> {
  const { stdout } = await runFile('git', args, { cwd: userlandDir() })
  return stdout.trim()
}

async function gitCommit(message: string): Promise<void> {
  await git(['add', '-A'])
  await git(['-c', 'user.name=y', '-c', 'user.email=y@localhost', 'commit', '-m', message])
}

async function ensureUserlandRepo(): Promise<void> {
  try {
    await git(['rev-parse', '--git-dir'])
    return // already a repo
  } catch {
    // not a repo yet → init and make the first save point
  }
  await git(['init'])
  await gitCommit('initial userland')
}

async function ensureUserland(): Promise<void> {
  await mkdir(userlandDir(), { recursive: true })
  try {
    await readFile(userlandFile())
  } catch {
    // File doesn't exist yet → seed it with the default content.
    await writeFile(userlandFile(), DEFAULT_PANEL, 'utf-8')
  }
  await ensureUserlandRepo()
}

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.y.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Make sure the writable Userland folder + seed file exist before the UI loads.
  await ensureUserland()

  // ---- y's first real "bricks": two-way IPC the renderer can call ----
  // ipcMain.handle returns a value back to the caller (unlike ipcMain.on,
  // which is fire-and-forget). The renderer calls these via ipcRenderer.invoke.
  ipcMain.handle('userland:read', () => readFile(userlandFile(), 'utf-8'))
  ipcMain.handle('userland:path', () => userlandFile())

  // Compile the Userland .tsx into runnable JS (CommonJS) with esbuild.
  // We externalize react/jsx-runtime via the output's require() calls — the
  // renderer fills those in with the host's React (see UserlandHost).
  ipcMain.handle('userland:compile', async () => {
    try {
      const src = await readFile(userlandFile(), 'utf-8')
      const out = await transform(src, {
        loader: 'tsx',
        jsx: 'automatic',
        format: 'cjs',
        target: 'es2020'
      })
      return { ok: true, code: out.code }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Snapshot = a git commit of the current Userland state (a save point).
  // No-ops cleanly when nothing changed.
  ipcMain.handle('userland:snapshot', async () => {
    try {
      const dirty = (await git(['status', '--porcelain'])).length > 0
      if (dirty) await gitCommit(`snapshot ${new Date().toISOString()}`)
      const hash = await git(['rev-parse', '--short', 'HEAD'])
      const count = Number(await git(['rev-list', '--count', 'HEAD']))
      return { ok: true, hash, count }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Revert = one step of "undo":
  //  - uncommitted edits present → throw them away, restore the last snapshot
  //  - already clean             → step back to the previous snapshot
  ipcMain.handle('userland:revert', async () => {
    try {
      const dirty = (await git(['status', '--porcelain'])).length > 0
      if (dirty) {
        await git(['reset', '--hard', 'HEAD'])
      } else {
        const have = Number(await git(['rev-list', '--count', 'HEAD']))
        if (have <= 1) return { ok: false, error: 'No earlier snapshot to revert to.' }
        await git(['reset', '--hard', 'HEAD~1'])
      }
      const hash = await git(['rev-parse', '--short', 'HEAD'])
      const count = Number(await git(['rev-list', '--count', 'HEAD']))
      return { ok: true, hash, count }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
