import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { HostInput, HostProfile } from '../shared/types'
import { askConfigDir, knownConfigDir } from './config-home'
import { adoptPassphrase, clearPassphrase, copyPassphrase, hasPassphrase, savePassphrase } from './secrets'

export type StoredHost = Omit<HostProfile, 'hasPassphrase'>

let catalog: StoredHost[] = []
let loadedDir: string | null = null

function byName(a: StoredHost, b: StoredHost): number {
  return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' })
}

function sortCatalog(): void {
  catalog.sort(byName)
}

function copyName(base: string): string {
  const taken = new Set(catalog.map((host) => host.displayName.trim().toLowerCase()))
  let name = `${base} copy`
  let n = 2
  while (taken.has(name.toLowerCase())) {
    name = `${base} copy ${n}`
    n += 1
  }
  return name
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function parseStoredHost(value: unknown): StoredHost {
  if (!isRecord(value)) throw new Error('Host entry is invalid')
  const port = Number(value.port)
  if (!value.id || !value.hostname || !value.username || !value.keyPath || !Number.isInteger(port)) {
    throw new Error('Host entry is missing a field')
  }
  return {
    id: String(value.id),
    displayName: String(value.displayName || value.hostname),
    hostname: String(value.hostname),
    port,
    username: String(value.username),
    keyPath: String(value.keyPath),
    defaultDirectory: String(value.defaultDirectory || ''),
    lastDirectory: String(value.lastDirectory || ''),
    hostKeyFingerprint: value.hostKeyFingerprint ? String(value.hostKeyFingerprint) : null
  }
}

async function catalogPath(ask: boolean): Promise<string | null> {
  const dir = ask ? await askConfigDir() : await knownConfigDir()
  if (!dir) return null
  return join(dir, 'hosts.json')
}

export async function readyHosts(): Promise<void> {
  const dir = await knownConfigDir()
  if (!dir) {
    catalog = []
    loadedDir = null
    return
  }
  if (loadedDir === dir) return
  const path = join(dir, 'hosts.json')
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
    const rows = isRecord(parsed) && Array.isArray(parsed.hosts) ? parsed.hosts : []
    catalog = rows.map(parseStoredHost)
  } catch {
    catalog = []
  }
  sortCatalog()
  loadedDir = dir
}

async function writeCatalog(): Promise<void> {
  const path = await catalogPath(true)
  if (!path) throw new Error('Choose a folder for settings before saving a host.')
  sortCatalog()
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  await writeFile(tmp, JSON.stringify({ hosts: catalog }, null, 2), 'utf8')
  await rename(tmp, path)
  loadedDir = dirname(path)
}

async function present(host: StoredHost): Promise<HostProfile> {
  return { ...host, hasPassphrase: await hasPassphrase(host.id) }
}

export async function listHosts(): Promise<HostProfile[]> {
  await readyHosts()
  const hosts: HostProfile[] = []
  for (const host of catalog) hosts.push(await present(host))
  return hosts
}

export function findHost(id: string): StoredHost {
  const host = catalog.find((item) => item.id === id)
  if (!host) throw new Error('That host is not in settings')
  return host
}

export async function importLegacyHosts(projectPath: string, incoming: StoredHost[]): Promise<void> {
  await readyHosts()
  let changed = false
  for (const host of incoming) {
    if (!catalog.some((item) => item.id === host.id)) {
      catalog.push(host)
      changed = true
    }
    await adoptPassphrase(projectPath, host.id)
  }
  if (changed) await writeCatalog()
}

export async function saveHost(input: HostInput): Promise<HostProfile[]> {
  await readyHosts()
  const hostname = input.hostname.trim()
  const username = input.username.trim()
  const keyPath = input.keyPath.trim()
  const port = Number(input.port)
  if (!hostname || !username || !keyPath) throw new Error('Hostname, username, and key file are required')
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be between 1 and 65535')

  const id = input.id ?? randomUUID()
  const existing = catalog.find((host) => host.id === id)
  if (input.id && !existing) throw new Error('That host is not in settings')

  const next: StoredHost = {
    id,
    displayName: input.displayName.trim() || hostname,
    hostname,
    port,
    username,
    keyPath,
    defaultDirectory: input.defaultDirectory.trim(),
    lastDirectory: existing?.lastDirectory || input.defaultDirectory.trim(),
    hostKeyFingerprint: existing?.hostKeyFingerprint ?? null
  }
  const sameConnection = catalog.find(
    (host) =>
      host.id !== id &&
      host.hostname.trim().toLowerCase() === hostname.toLowerCase() &&
      host.port === port &&
      host.username.trim() === username
  )
  if (sameConnection) {
    throw new Error(
      `A host for ${sameConnection.username}@${sameConnection.hostname}:${sameConnection.port} is already in the list.`
    )
  }
  const sameName = catalog.find((host) => host.id !== id && host.displayName.trim().toLowerCase() === next.displayName.toLowerCase())
  if (sameName) throw new Error(`A host named ${sameName.displayName} is already in the list.`)

  if (input.clearPassphrase) await clearPassphrase(id)
  else if (input.passphrase) await savePassphrase(id, input.passphrase)
  catalog = existing ? catalog.map((host) => (host.id === id ? next : host)) : [...catalog, next]
  await writeCatalog()
  return listHosts()
}

export async function duplicateHost(id: string): Promise<{ hosts: HostProfile[]; host: HostProfile }> {
  await readyHosts()
  const host = findHost(id)
  const copy: StoredHost = {
    ...host,
    id: randomUUID(),
    displayName: copyName(host.displayName)
  }
  await copyPassphrase(host.id, copy.id)
  catalog = [...catalog, copy]
  await writeCatalog()
  const hosts = await listHosts()
  const presented = hosts.find((item) => item.id === copy.id)
  if (!presented) throw new Error('The copied host was not saved')
  return { hosts, host: presented }
}

export async function deleteHost(id: string): Promise<HostProfile[]> {
  await readyHosts()
  if (!catalog.some((host) => host.id === id)) throw new Error('That host is not in settings')
  catalog = catalog.filter((host) => host.id !== id)
  await clearPassphrase(id)
  await writeCatalog()
  return listHosts()
}

export async function setHostKey(id: string, fingerprint: string): Promise<void> {
  await readyHosts()
  const host = findHost(id)
  host.hostKeyFingerprint = fingerprint
  await writeCatalog()
}

export async function setLastDirectory(id: string, directory: string): Promise<void> {
  await readyHosts()
  const host = findHost(id)
  if (host.lastDirectory === directory) return
  host.lastDirectory = directory
  await writeCatalog()
}
