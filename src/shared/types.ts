export const MAX_FILE_BYTES = 5 * 1024 * 1024

export type HostStatus = 'disconnected' | 'connecting' | 'connected' | 'failed'

export type HostProfile = {
  id: string
  displayName: string
  hostname: string
  port: number
  username: string
  keyPath: string
  defaultDirectory: string
  lastDirectory: string
  hostKeyFingerprint: string | null
  hasPassphrase: boolean
}

export type RememberedFile = {
  hostId: string
  path: string
}

export type Project = {
  name: string
  filePath: string
  files: RememberedFile[]
}

export type RestoredSession = {
  hosts: HostProfile[]
  project: Project | null
  openFiles: RememberedFile[]
  activeFile: RememberedFile | null
  collapsed: RememberedFile[]
}

export type SshConfigHost = {
  alias: string
  hostname: string
  port: number
  username: string
  keyPath: string
}

export type HostChange = {
  hosts: HostProfile[]
  project: Project | null
}

export type HostInput = {
  id?: string
  displayName: string
  hostname: string
  port: number
  username: string
  keyPath: string
  /** Empty keeps the saved passphrase when editing. */
  passphrase: string
  clearPassphrase: boolean
  defaultDirectory: string
}

export type DirEntry = {
  name: string
  path: string
  kind: 'dir' | 'file'
}

export type ListResult = {
  path: string
  entries: DirEntry[]
  /** Set when the requested path was a file, so the dialog can open it. */
  file?: string
  project: Project | null
  hosts: HostProfile[]
}

export type HostStatusEvent = {
  hostId: string
  status: HostStatus
  error?: string
}

export type EditRemoteApi = {
  encryptionAvailable: () => Promise<boolean>
  app: {
    version: () => Promise<string>
    checkForUpdates: () => Promise<void>
  }
  project: {
    create: () => Promise<Project | null>
    open: () => Promise<{ project: Project; hosts: HostProfile[]; collapsed: RememberedFile[] } | null>
    restore: () => Promise<RestoredSession | null>
    setOpenFiles: (files: RememberedFile[], active: RememberedFile | null) => Promise<void>
    setCollapsed: (collapsed: RememberedFile[]) => Promise<void>
  }
  pickKeyFile: () => Promise<string | null>
  sshHosts: () => Promise<SshConfigHost[]>
  host: {
    save: (input: HostInput) => Promise<HostProfile[]>
    remove: (id: string) => Promise<HostChange>
    statuses: () => Promise<HostStatusEvent[]>
    connect: (id: string) => Promise<void>
    disconnect: (id: string) => Promise<void>
    list: (id: string, directory: string) => Promise<ListResult>
    onStatus: (cb: (event: HostStatusEvent) => void) => () => void
  }
  file: {
    read: (hostId: string, path: string) => Promise<{ text: string }>
    write: (hostId: string, path: string, text: string) => Promise<void>
    remember: (hostId: string, path: string) => Promise<Project>
    forget: (hostId: string, path: string) => Promise<Project>
  }
}
