import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, normalize } from 'node:path'
import { safeStorage } from 'electron'
import { askConfigDir, knownConfigDir } from './config-home'

type SecretFile = {
  entries: Record<string, string>
}

async function storePath(ask: boolean): Promise<string | null> {
  const dir = ask ? await askConfigDir() : await knownConfigDir()
  if (!dir) return null
  return join(dir, 'secrets.json')
}

function hostKey(hostId: string): string {
  return `host:${hostId}`
}

function legacyKey(projectPath: string, hostId: string): string {
  const norm = process.platform === 'win32' ? normalize(projectPath).toLowerCase() : normalize(projectPath)
  const hash = createHash('sha256').update(norm).digest('hex')
  return `${hash}:${hostId}`
}

async function readStore(): Promise<SecretFile> {
  const path = await storePath(false)
  if (!path) return { entries: {} }
  try {
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw) as SecretFile
    if (!parsed || typeof parsed.entries !== 'object' || parsed.entries === null) return { entries: {} }
    return parsed
  } catch {
    return { entries: {} }
  }
}

async function writeStore(store: SecretFile): Promise<void> {
  const path = await storePath(true)
  if (!path) throw new Error('Choose a folder for settings before saving a passphrase.')
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  await writeFile(tmp, JSON.stringify(store), 'utf8')
  await rename(tmp, path)
}

export function encryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

export async function hasPassphrase(hostId: string): Promise<boolean> {
  const store = await readStore()
  return typeof store.entries[hostKey(hostId)] === 'string'
}

/** Move a passphrase saved against a project file onto the host itself. */
export async function adoptPassphrase(projectPath: string, hostId: string): Promise<void> {
  const store = await readStore()
  const next = hostKey(hostId)
  const previous = legacyKey(projectPath, hostId)
  if (store.entries[next] || !store.entries[previous]) return
  store.entries[next] = store.entries[previous]
  delete store.entries[previous]
  await writeStore(store)
}

export async function savePassphrase(hostId: string, passphrase: string): Promise<void> {
  if (!passphrase) {
    await clearPassphrase(hostId)
    return
  }
  if (!encryptionAvailable()) {
    throw new Error('This system cannot store a key passphrase. Leave the passphrase empty, or use a key that is not encrypted.')
  }
  const store = await readStore()
  store.entries[hostKey(hostId)] = safeStorage.encryptString(passphrase).toString('base64')
  await writeStore(store)
}

export async function clearPassphrase(hostId: string): Promise<void> {
  const store = await readStore()
  delete store.entries[hostKey(hostId)]
  await writeStore(store)
}

export async function readPassphrase(hostId: string): Promise<string | undefined> {
  const store = await readStore()
  const cipher = store.entries[hostKey(hostId)]
  if (!cipher) return undefined
  if (!encryptionAvailable()) {
    throw new Error('The saved key passphrase cannot be unlocked on this system.')
  }
  return safeStorage.decryptString(Buffer.from(cipher, 'base64'))
}
