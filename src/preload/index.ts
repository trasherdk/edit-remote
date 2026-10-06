import { contextBridge, ipcRenderer } from 'electron'
import type { EditRemoteApi, HostInput, HostStatusEvent, ListResult, MenuCommand, Project, RememberedFile } from '../shared/types'

const api: EditRemoteApi = {
  encryptionAvailable: () => ipcRenderer.invoke('app:encryptionAvailable'),
  app: {
    version: () => ipcRenderer.invoke('app:version'),
    checkForUpdates: () => ipcRenderer.invoke('app:checkForUpdates')
  },
  project: {
    create: () => ipcRenderer.invoke('project:create'),
    open: () => ipcRenderer.invoke('project:open'),
    restore: () => ipcRenderer.invoke('project:restore'),
    setOpenFiles: (files: RememberedFile[], active: RememberedFile | null) =>
      ipcRenderer.invoke('project:openFiles', files, active),
    setCollapsed: (collapsed: RememberedFile[]) => ipcRenderer.invoke('project:collapsed', collapsed)
  },
  pickKeyFile: () => ipcRenderer.invoke('dialog:keyFile'),
  sshHosts: () => ipcRenderer.invoke('ssh:hosts'),
  onMenu: (cb) => {
    const listener = (_event: unknown, command: MenuCommand): void => cb(command)
    ipcRenderer.on('menu:command', listener)
    return () => ipcRenderer.removeListener('menu:command', listener)
  },
  host: {
    save: (input: HostInput) => ipcRenderer.invoke('host:save', input),
    duplicate: (id) => ipcRenderer.invoke('host:duplicate', id),
    remove: (id) => ipcRenderer.invoke('host:remove', id),
    statuses: () => ipcRenderer.invoke('host:statuses') as Promise<HostStatusEvent[]>,
    connect: (id) => ipcRenderer.invoke('host:connect', id),
    disconnect: (id) => ipcRenderer.invoke('host:disconnect', id),
    list: (id, directory) => ipcRenderer.invoke('host:list', id, directory) as Promise<ListResult>,
    onStatus: (cb) => {
      const listener = (_event: unknown, payload: HostStatusEvent): void => cb(payload)
      ipcRenderer.on('host:status', listener)
      return () => ipcRenderer.removeListener('host:status', listener)
    }
  },
  file: {
    read: (hostId, path) => ipcRenderer.invoke('file:read', hostId, path),
    write: (hostId, path, text) => ipcRenderer.invoke('file:write', hostId, path, text),
    remember: (hostId, path) => ipcRenderer.invoke('file:remember', hostId, path) as Promise<Project>,
    forget: (hostId, path) => ipcRenderer.invoke('file:forget', hostId, path) as Promise<Project>
  }
}

contextBridge.exposeInMainWorld('api', api)
