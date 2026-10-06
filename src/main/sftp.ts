import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { posix } from 'node:path'
import { dialog, type BrowserWindow } from 'electron'
import { Client, utils, type FileEntry, type SFTPWrapper, type Stats } from 'ssh2'
import {
  MAX_FILE_BYTES,
  type DirEntry,
  type FileBaseline,
  type FileContent,
  type FileStamp,
  type HostStatusEvent,
  type LineEnding,
  type ListResult
} from '../shared/types'
import { findHost, listHosts, readyHosts, setHostKey, setLastDirectory } from './hosts'
import { getProject } from './project'
import { readPassphrase } from './secrets'

type StatusFn = (hostId: string, status: 'disconnected' | 'connecting' | 'connected' | 'failed', error?: string) => void

const MAX_IN_FLIGHT = 8

type Session = {
  client: Client
  sftp: SFTPWrapper
  active: number
  waiters: Array<() => void>
}

const sessions = new Map<string, Session>()
const connecting = new Map<string, Promise<Session>>()

let onStatus: StatusFn = () => {}
let getWindow: () => BrowserWindow | null = () => null

export function bindSessionEvents(status: StatusFn, window: () => BrowserWindow | null): void {
  onStatus = status
  getWindow = window
}

function sshType(key: Buffer): string {
  if (key.length < 4) return 'unknown'
  const len = key.readUInt32BE(0)
  if (len <= 0 || 4 + len > key.length) return 'unknown'
  return key.subarray(4, 4 + len).toString('utf8')
}

function fingerprint(key: Buffer): string {
  const digest = createHash('sha256').update(key).digest('base64').replace(/=+$/, '')
  return `SHA256:${digest}`
}

function parentOf(remotePath: string): string {
  if (remotePath === '/' || remotePath === '.') return '/'
  const parent = posix.dirname(remotePath)
  return parent === '.' ? '/' : parent
}

function call<T>(run: (done: (err: Error | undefined, value: T) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    run((err, value) => {
      if (err) reject(err)
      else resolve(value)
    })
  })
}

function enqueue<T>(session: Session, job: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const start = (): void => {
      session.active += 1
      job().then(resolve, reject).finally(() => {
        session.active -= 1
        session.waiters.shift()?.()
      })
    }
    if (session.active < MAX_IN_FLIGHT) start()
    else session.waiters.push(start)
  })
}

function drop(hostId: string, client: Client): void {
  const current = sessions.get(hostId)
  if (current?.client !== client) return
  sessions.delete(hostId)
  onStatus(hostId, 'disconnected')
}

async function trustHostKey(hostId: string, key: Buffer): Promise<boolean> {
  const host = findHost(hostId)
  const seen = fingerprint(key)
  const kind = sshType(key)
  if (host.hostKeyFingerprint === seen) return true
  const changed = Boolean(host.hostKeyFingerprint)
  const parent = getWindow()
  const choice = await (parent
    ? dialog.showMessageBox(parent, {
    type: 'warning',
    buttons: ['Reject', 'Accept'],
    defaultId: 1,
    cancelId: 0,
    noLink: true,
    message: changed ? `${host.displayName} host key has changed` : `Trust host key for ${host.displayName}?`,
    detail: `${host.username}@${host.hostname}:${host.port}\n${kind}\n${seen}`
  })
    : dialog.showMessageBox({
        type: 'warning',
        buttons: ['Reject', 'Accept'],
        defaultId: 1,
        cancelId: 0,
        noLink: true,
        message: changed ? `${host.displayName} host key has changed` : `Trust host key for ${host.displayName}?`,
        detail: `${host.username}@${host.hostname}:${host.port}\n${kind}\n${seen}`
      }))
  if (choice.response !== 1) return false
  await setHostKey(hostId, seen)
  return true
}

function loadKey(hostId: string, passphrase: string | undefined): Buffer {
  const host = findHost(hostId)
  let raw: Buffer
  try {
    raw = readFileSync(host.keyPath)
  } catch {
    throw new Error(`Could not read the key file ${host.keyPath}`)
  }
  const parsed = utils.parseKey(raw, passphrase)
  const failed = Array.isArray(parsed) ? parsed.find((item) => item instanceof Error) : parsed instanceof Error ? parsed : undefined
  if (failed instanceof Error) {
    if (/passphrase|encrypted|bad password/i.test(failed.message) && !passphrase) {
      throw new Error('This key needs a passphrase. Edit the host and enter it.')
    }
    throw new Error(failed.message)
  }
  return raw
}

async function openSession(hostId: string): Promise<Session> {
  await readyHosts()
  const host = findHost(hostId)
  onStatus(hostId, 'connecting')
  const passphrase = await readPassphrase(hostId)
  const privateKey = loadKey(hostId, passphrase)
  const client = new Client()

  const ready = new Promise<void>((resolve, reject) => {
    client.once('ready', () => resolve())
    client.once('error', (err) => reject(err))
    client.connect({
      host: host.hostname,
      port: host.port,
      username: host.username,
      privateKey,
      passphrase,
      readyTimeout: 20000,
      keepaliveInterval: 10000,
      hostVerifier: (key, callback) => {
        const material = Buffer.isBuffer(key) ? key : Buffer.from(key, 'hex')
        void trustHostKey(hostId, material).then(
          (ok) => callback(ok),
          () => callback(false)
        )
      }
    })
  })

  try {
    await ready
    const sftp = await call<SFTPWrapper>((done) => client.sftp(done))
    const session: Session = { client, sftp, active: 0, waiters: [] }
    client.on('close', () => drop(hostId, client))
    client.on('end', () => drop(hostId, client))
    sessions.set(hostId, session)
    onStatus(hostId, 'connected')
    return session
  } catch (err) {
    client.end()
    const message = err instanceof Error ? err.message : String(err)
    onStatus(hostId, 'failed', message)
    throw err instanceof Error ? err : new Error(message)
  }
}

async function ensure(hostId: string): Promise<Session> {
  const existing = sessions.get(hostId)
  if (existing) return existing
  let pending = connecting.get(hostId)
  if (!pending) {
    pending = openSession(hostId).finally(() => connecting.delete(hostId))
    connecting.set(hostId, pending)
  }
  return pending
}

export function connectionStatuses(): HostStatusEvent[] {
  const events: HostStatusEvent[] = []
  for (const hostId of sessions.keys()) events.push({ hostId, status: 'connected' })
  for (const hostId of connecting.keys()) {
    if (!sessions.has(hostId)) events.push({ hostId, status: 'connecting' })
  }
  return events
}

export async function connectHost(hostId: string): Promise<void> {
  if (sessions.has(hostId)) {
    onStatus(hostId, 'connected')
    return
  }
  await ensure(hostId)
}

export async function disconnectHost(hostId: string): Promise<void> {
  const session = sessions.get(hostId)
  if (!session) {
    onStatus(hostId, 'disconnected')
    return
  }
  sessions.delete(hostId)
  session.client.end()
  onStatus(hostId, 'disconnected')
}

export async function disconnectAll(): Promise<void> {
  for (const id of [...sessions.keys()]) await disconnectHost(id)
}

function isDir(entry: FileEntry): boolean {
  return (entry.attrs.mode & 0o170000) === 0o040000
}

async function listDirectory(session: Session, directory: string): Promise<DirEntry[]> {
  const rows = await call<FileEntry[]>((done) => session.sftp.readdir(directory, done))
  const entries: DirEntry[] = []
  for (const row of rows) {
    if (row.filename === '.' || row.filename === '..') continue
    const path = directory === '/' ? `/${row.filename}` : posix.join(directory, row.filename)
    entries.push({ name: row.filename, path, kind: isDir(row) ? 'dir' : 'file' })
  }
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return entries
}

export async function listRemote(hostId: string, requested: string): Promise<ListResult> {
  await readyHosts()
  const session = await ensure(hostId)
  return enqueue(session, async () => {
    const start = requested.trim() || findHost(hostId).lastDirectory || findHost(hostId).defaultDirectory || '.'
    const resolved = await call<string>((done) => session.sftp.realpath(start, done))
    const stats = await call<{ isFile: () => boolean; isDirectory: () => boolean }>((done) => session.sftp.stat(resolved, done))
    const finish = async (directory: string, file?: string): Promise<ListResult> => {
      const entries = await listDirectory(session, directory)
      await setLastDirectory(hostId, directory)
      return { path: directory, entries, file, project: getProject(), hosts: await listHosts() }
    }
    if (stats.isFile()) return finish(parentOf(resolved), resolved)
    return finish(resolved)
  })
}

function detectLineEnding(text: string): LineEnding {
  const crlf = text.includes('\r\n')
  const rest = text.replaceAll('\r\n', '')
  const lf = rest.includes('\n')
  const cr = rest.includes('\r')
  if ([crlf, lf, cr].filter(Boolean).length > 1) return 'Mixed'
  if (crlf) return 'CRLF'
  if (cr) return 'CR'
  return 'LF'
}

function stampOf(stats: Stats): { size: number | null; mtime: number | null; mode: number } {
  return {
    size: Number.isFinite(stats.size) ? stats.size : null,
    mtime: stats.mtime ? stats.mtime : null,
    mode: stats.mode || 0
  }
}

function ownerCanWrite(mode: number): boolean {
  if (!mode) return true
  return (mode & 0o200) !== 0
}

function when(mtime: number | null): string {
  if (mtime === null) return 'unknown'
  return new Date(mtime * 1000).toISOString()
}

async function ask(message: string, detail: string, confirm: string): Promise<boolean> {
  const parent = getWindow()
  const options = {
    type: 'warning' as const,
    buttons: ['Cancel', confirm],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    message,
    detail
  }
  const choice = await (parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options))
  return choice.response === 1
}

async function confirmReplace(hostId: string, remotePath: string, baseline: FileBaseline, current: FileBaseline): Promise<void> {
  const host = findHost(hostId)
  const label = `${host.displayName}:${remotePath}`
  const haveSize = baseline.size !== null && current.size !== null
  const haveMtime = baseline.mtime !== null && current.mtime !== null
  if (!haveSize && !haveMtime) {
    const ok = await ask(
      `Overwrite ${label}?`,
      'The server did not report a size or modification time, so this save cannot check for outside changes.',
      'Overwrite'
    )
    if (!ok) throw new Error('Save cancelled.')
    return
  }
  const sizeChanged = haveSize && baseline.size !== current.size
  const timeChanged = haveMtime && baseline.mtime !== current.mtime
  if (!sizeChanged && !timeChanged) return
  const ok = await ask(
    `${label} changed on the server`,
    `Size ${baseline.size ?? 'unknown'} → ${current.size ?? 'unknown'}\nModified ${when(baseline.mtime)} → ${when(current.mtime)}\nOverwrite it with the text in the editor?`,
    'Overwrite'
  )
  if (!ok) throw new Error('Save cancelled.')
}

function decodeText(buf: Buffer): string {
  if (buf.includes(0)) throw new Error('This file looks binary. The editor opens text only.')
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    throw new Error('This file is not valid UTF-8.')
  }
}

export async function readRemote(hostId: string, remotePath: string): Promise<FileContent> {
  const session = await ensure(hostId)
  return enqueue(session, async () => {
    const stats = await call<Stats>((done) => session.sftp.stat(remotePath, done))
    if (stats.isDirectory()) throw new Error('That path is a directory')
    if (stats.size > MAX_FILE_BYTES) throw new Error('That file is larger than 5 MB')
    const data = await call<Buffer>((done) => session.sftp.readFile(remotePath, done))
    const text = decodeText(data)
    const meta = stampOf(stats)
    return {
      text,
      lineEnding: detectLineEnding(text),
      writable: ownerCanWrite(meta.mode),
      size: meta.size,
      mtime: meta.mtime
    }
  })
}

function failWrite(done: (err: Error | undefined, value: void) => void): (err: Error | null | undefined) => void {
  return (err) => done(err ?? undefined, undefined as void)
}

export async function writeRemote(hostId: string, remotePath: string, text: string, baseline: FileBaseline): Promise<FileStamp> {
  const session = await ensure(hostId)
  const body = Buffer.from(text, 'utf8')
  if (body.length > MAX_FILE_BYTES) throw new Error('That file is larger than 5 MB')
  return enqueue(session, async () => {
    const before = await call<Stats>((done) => session.sftp.stat(remotePath, done))
    const current = stampOf(before)
    await confirmReplace(hostId, remotePath, baseline, current)
    const tempPath = posix.join(parentOf(remotePath), `.${posix.basename(remotePath)}.${randomUUID()}.ertmp`)
    const options = current.mode ? { mode: current.mode } : {}
    let renamed = false
    let inPlace = false
    try {
      try {
        await call<void>((done) => session.sftp.writeFile(tempPath, body, options, failWrite(done)))
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        throw new Error(`Save failed before replacing the file. The remote file was not changed. ${detail}`)
      }
      try {
        await call<void>((done) => session.sftp.ext_openssh_rename(tempPath, remotePath, failWrite(done)))
        renamed = true
      } catch {
        try {
          await call<void>((done) => session.sftp.rename(tempPath, remotePath, failWrite(done)))
          renamed = true
        } catch {
          try {
            await call<void>((done) => session.sftp.writeFile(remotePath, body, options, failWrite(done)))
            inPlace = true
          } catch (err) {
            const detail = err instanceof Error ? err.message : String(err)
            throw new Error(`Save failed while overwriting in place. The remote file may be incomplete. ${detail}`)
          }
        }
      }
      if (current.mode) {
        await call<void>((done) => session.sftp.chmod(remotePath, current.mode, failWrite(done))).catch(() => undefined)
      }
      try {
        const after = stampOf(await call<Stats>((done) => session.sftp.stat(remotePath, done)))
        return { size: after.size, mtime: after.mtime, inPlace }
      } catch {
        return { size: body.length, mtime: null, inPlace }
      }
    } finally {
      if (!renamed) {
        await call<void>((done) => session.sftp.unlink(tempPath, failWrite(done))).catch(() => undefined)
      }
    }
  })
}
