import { contextBridge, ipcRenderer } from 'electron'
import type { AppSettings, EditRemoteApi, HostInput, HostStatusEvent, ListResult, MenuCommand, Project, RememberedFile } from '../shared/types'

type IpcResult<T> = { ok: true; value: T } | { ok: false; message: string }

function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args).then((result: unknown) => {
    if (!result || typeof result !== 'object' || !('ok' in result)) throw new Error('Unexpected IPC result')
    const row = result as IpcResult<T>
    if (!row.ok) throw new Error(row.message)
    return row.value
  })
}

const api: EditRemoteApi = {
  encryptionAvailable: () => ipcRenderer.invoke('app:encryptionAvailable'),
  app: {
    version: () => ipcRenderer.invoke('app:version'),
    checkForUpdates: () => call('app:checkForUpdates')
  },
  settings: {
    get: () => call<AppSettings>('settings:get'),
    save: (settings: AppSettings) => call('settings:save', settings)
  },
  project: {
    create: () => call('project:create'),
    open: () => call('project:open'),
    restore: () => call('project:restore'),
    setOpenFiles: (files: RememberedFile[], active: RememberedFile | null) =>
      call('project:openFiles', files, active),
    setCollapsed: (collapsed: RememberedFile[]) => call('project:collapsed', collapsed)
  },
  pickKeyFile: () => ipcRenderer.invoke('dialog:keyFile'),
  sshHosts: () => call('ssh:hosts'),
  onMenu: (cb) => {
    const listener = (_event: unknown, command: MenuCommand): void => cb(command)
    ipcRenderer.on('menu:command', listener)
    return () => ipcRenderer.removeListener('menu:command', listener)
  },
  host: {
    save: (input: HostInput) => call('host:save', input),
    duplicate: (id) => call('host:duplicate', id),
    remove: (id) => call('host:remove', id),
    statuses: () => call<HostStatusEvent[]>('host:statuses'),
    connect: (id) => call('host:connect', id),
    disconnect: (id) => call('host:disconnect', id),
    list: (id, directory) => call<ListResult>('host:list', id, directory),
    onStatus: (cb) => {
      const listener = (_event: unknown, payload: HostStatusEvent): void => cb(payload)
      ipcRenderer.on('host:status', listener)
      return () => ipcRenderer.removeListener('host:status', listener)
    }
  },
  file: {
    read: (hostId, path) => call('file:read', hostId, path),
    write: (hostId, path, text, baseline) => call('file:write', hostId, path, text, baseline),
    remember: (hostId, path) => call<Project>('file:remember', hostId, path),
    forget: (hostId, path) => call<Project>('file:forget', hostId, path)
  }
}

contextBridge.exposeInMainWorld('api', api)
