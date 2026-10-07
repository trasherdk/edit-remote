import './user-data'
import { existsSync } from 'node:fs'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { join } from 'node:path'
import type { HostInput, HostStatusEvent, UpdateChannel } from '../shared/types'
import { deleteHost, duplicateHost, listHosts, saveHost } from './hosts'
import { installMenu } from './menu'
import {
  createProject,
  forgetFile,
  forgetHostFiles,
  getProject,
  getWindowBounds,
  openProject,
  rememberFile,
  collapsedForCurrent,
  restoreProject,
  saveCollapsed,
  saveOpenFiles,
  saveWindowBounds,
  getUpdateChannel,
  setUpdateChannel
} from './project'
import { readSshConfig } from './ssh-config'
import { bindConfigWindow } from './config-home'
import { encryptionAvailable } from './secrets'
import { bindSessionEvents, connectHost, connectionStatuses, disconnectAll, disconnectHost, listRemote, readRemote, writeRemote } from './sftp'
import { checkForUpdates, startAutoUpdate } from './updater'

let mainWindow: BrowserWindow | null = null

function sendStatus(event: HostStatusEvent): void {
  const window = mainWindow
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return
  window.webContents.send('host:status', event)
}

function windowIcon(): string | undefined {
  const path = join(__dirname, '../../build/icon.png')
  return existsSync(path) ? path : undefined
}

function createWindow(): void {
  void getWindowBounds().then((bounds) => {
    mainWindow = new BrowserWindow({
      icon: windowIcon(),
      width: bounds?.width ?? 1200,
      height: bounds?.height ?? 800,
      x: bounds?.x,
      y: bounds?.y,
      minWidth: 880,
      minHeight: 560,
      show: false,
      autoHideMenuBar: false,
      title: 'edit-remote',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false
      }
    })

    mainWindow.on('ready-to-show', () => mainWindow?.show())
    let allowClose = false
    mainWindow.on('close', (event) => {
      if (allowClose || !mainWindow) return
      event.preventDefault()
      const bounds = mainWindow.getBounds()
      void saveWindowBounds(bounds).finally(() => {
        allowClose = true
        mainWindow?.close()
      })
    })

    if (process.env['ELECTRON_RENDERER_URL']) {
      void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
      void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
    }
  })
}

function setTitle(): void {
  const project = getProject()
  mainWindow?.setTitle(project ? `${project.name} — edit-remote` : 'edit-remote')
}

type IpcResult<T> = { ok: true; value: T } | { ok: false; message: string }

/** Resolve with a failure payload. A rejected handler is printed by Electron even when the window catches it. */
function wrap<T>(fn: () => Promise<T> | T): Promise<IpcResult<T>> {
  return Promise.resolve()
    .then(fn)
    .then((value) => ({ ok: true as const, value }))
    .catch((err: unknown) => ({ ok: false as const, message: err instanceof Error ? err.message : String(err) }))
}

function registerIpc(): void {
  ipcMain.handle('app:encryptionAvailable', () => encryptionAvailable())

  ipcMain.handle('project:create', () =>
    wrap(async () => {
      const project = await createProject(mainWindow)
      setTitle()
      return project
    })
  )

  ipcMain.handle('project:open', () =>
    wrap(async () => {
      const project = await openProject(mainWindow)
      setTitle()
      if (!project) return null
      return { project, hosts: await listHosts(), collapsed: await collapsedForCurrent() }
    })
  )

  ipcMain.handle('project:restore', () =>
    wrap(async () => {
      const restored = await restoreProject()
      setTitle()
      return restored
    })
  )

  ipcMain.handle('project:openFiles', (_event, files: unknown, active: unknown) =>
    wrap(() => {
      const openFiles = Array.isArray(files)
        ? files.flatMap((file) => {
            if (!file || typeof file !== 'object') return []
            const row = file as { hostId?: unknown; path?: unknown }
            if (typeof row.hostId !== 'string' || typeof row.path !== 'string') return []
            return [{ hostId: row.hostId, path: row.path }]
          })
        : []
      const activeFile =
        active && typeof active === 'object'
          ? (() => {
              const row = active as { hostId?: unknown; path?: unknown }
              return typeof row.hostId === 'string' && typeof row.path === 'string'
                ? { hostId: row.hostId, path: row.path }
                : null
            })()
          : null
      return saveOpenFiles(openFiles, activeFile)
    })
  )

  ipcMain.handle('project:collapsed', (_event, collapsed: unknown) =>
    wrap(() => {
      const rows = Array.isArray(collapsed)
        ? collapsed.flatMap((file) => {
            if (!file || typeof file !== 'object') return []
            const row = file as { hostId?: unknown; path?: unknown }
            if (typeof row.hostId !== 'string' || typeof row.path !== 'string') return []
            return [{ hostId: row.hostId, path: row.path }]
          })
        : []
      return saveCollapsed(rows)
    })
  )

  ipcMain.handle('ssh:hosts', () => wrap(() => readSshConfig()))

  ipcMain.handle('dialog:keyFile', async () => {
    const picked = await (mainWindow ? dialog.showOpenDialog(mainWindow, {
      title: 'Private key',
      properties: ['openFile']
    }) : dialog.showOpenDialog({
      title: 'Private key',
      properties: ['openFile']
    }))
    return picked.canceled ? null : (picked.filePaths[0] ?? null)
  })

  ipcMain.handle('host:save', (_event, input: HostInput) =>
    wrap(async () => {
      const project = await saveHost(input)
      setTitle()
      return project
    })
  )

  ipcMain.handle('host:duplicate', (_event, id: string) => wrap(() => duplicateHost(id)))

  ipcMain.handle('host:remove', (_event, id: string) =>
    wrap(async () => {
      await disconnectHost(id)
      const hosts = await deleteHost(id)
      const project = await forgetHostFiles(id)
      return { hosts, project }
    })
  )

  ipcMain.handle('host:statuses', () => wrap(() => connectionStatuses()))
  ipcMain.handle('host:connect', (_event, id: string) => wrap(() => connectHost(id)))
  ipcMain.handle('host:disconnect', (_event, id: string) => wrap(() => disconnectHost(id)))
  ipcMain.handle('host:list', (_event, id: string, directory: string) => wrap(() => listRemote(id, directory)))

  ipcMain.handle('file:read', (_event, hostId: string, path: string) => wrap(() => readRemote(hostId, path)))
  ipcMain.handle('file:write', (_event, hostId: string, path: string, text: string, baseline: unknown) =>
    wrap(() => {
      const row = baseline && typeof baseline === 'object' ? (baseline as { size?: unknown; mtime?: unknown }) : {}
      return writeRemote(hostId, path, text, {
        size: typeof row.size === 'number' ? row.size : null,
        mtime: typeof row.mtime === 'number' ? row.mtime : null
      })
    })
  )
  ipcMain.handle('file:remember', (_event, hostId: string, path: string) => wrap(() => rememberFile(hostId, path)))
  ipcMain.handle('file:forget', (_event, hostId: string, path: string) => wrap(() => forgetFile(hostId, path)))

  ipcMain.handle('app:version', () => {
    const version = app.getVersion()
    if (!app.isPackaged) return `${version} dev`
    if (process.env.PORTABLE_EXECUTABLE_DIR) return `${version} portable`
    return version
  })
  ipcMain.handle('app:checkForUpdates', () => wrap(() => checkForUpdates(true)))

  ipcMain.handle('settings:get', () => wrap(async () => ({ updateChannel: await getUpdateChannel() })))
  ipcMain.handle('settings:save', (_event, input: unknown) =>
    wrap(async () => {
      const row = input && typeof input === 'object' ? (input as { updateChannel?: unknown }) : {}
      const channel: UpdateChannel = row.updateChannel === 'beta' || row.updateChannel === 'rc' ? row.updateChannel : 'stable'
      await setUpdateChannel(channel)
    })
  )
}

bindConfigWindow(() => mainWindow)

bindSessionEvents(
  (hostId, status, error) => sendStatus({ hostId, status, error }),
  () => mainWindow
)

app.whenReady().then(() => {
  installMenu(() => mainWindow)
  registerIpc()
  startAutoUpdate(() => mainWindow)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  void disconnectAll().catch(() => undefined)
})
