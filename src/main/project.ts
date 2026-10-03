import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, join, normalize } from 'node:path'
import { app, dialog, type BrowserWindow } from 'electron'
import type { Project, RememberedFile, RestoredSession } from '../shared/types'
import { askConfigDir, knownConfigDir } from './config-home'
import { findHost, importLegacyHosts, listHosts, parseStoredHost, readyHosts } from './hosts'

type StoredTree = {
  project: string
  collapsed: RememberedFile[]
}

type SessionFile = {
  lastProject?: string
  openFiles?: RememberedFile[]
  activeFile?: RememberedFile | null
  bounds?: { x: number; y: number; width: number; height: number }
  trees?: StoredTree[]
}

type StoredProject = {
  name: string
  files: RememberedFile[]
}

let current: Project | null = null

async function sessionPath(): Promise<string | null> {
  const dir = await knownConfigDir()
  if (!dir) return null
  return join(dir, 'session.json')
}

async function requireConfigDir(parent?: BrowserWindow | null): Promise<void> {
  const dir = await askConfigDir(parent)
  if (!dir) throw new Error('Choose a folder for settings before continuing.')
}

function asRemembered(value: unknown): RememberedFile | null {
  if (!isRecord(value) || !value.hostId || !value.path) return null
  return { hostId: String(value.hostId), path: String(value.path) }
}

function samePath(a: string, b: string): boolean {
  const left = normalize(a)
  const right = normalize(b)
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}

function sameFile(a: RememberedFile, b: RememberedFile): boolean {
  return a.hostId === b.hostId && a.path === b.path
}

async function readSession(): Promise<SessionFile> {
  const path = await sessionPath()
  if (!path) return {}
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
    if (!isRecord(parsed)) return {}
    const openFiles = Array.isArray(parsed.openFiles)
      ? parsed.openFiles.map(asRemembered).filter((file): file is RememberedFile => file !== null)
      : []
    const seen = new Set<string>()
    const uniqueOpenFiles = openFiles.filter((file) => {
      const key = `${file.hostId}\0${file.path}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    const activeFile = asRemembered(parsed.activeFile)
    const bounds = isRecord(parsed.bounds) ? (parsed.bounds as SessionFile['bounds']) : undefined
    const trees = Array.isArray(parsed.trees)
      ? parsed.trees.flatMap((row) => {
          if (!isRecord(row) || typeof row.project !== 'string' || !Array.isArray(row.collapsed)) return []
          const collapsed = row.collapsed.map(asRemembered).filter((file): file is RememberedFile => file !== null)
          return [{ project: row.project, collapsed }]
        })
      : []
    return {
      lastProject: typeof parsed.lastProject === 'string' ? parsed.lastProject : undefined,
      openFiles: uniqueOpenFiles,
      activeFile,
      bounds,
      trees
    }
  } catch {
    return {}
  }
}

let sessionQueue: Promise<void> = Promise.resolve()

function updateSession(change: (prev: SessionFile) => SessionFile): Promise<void> {
  const run = sessionQueue.then(async () => {
    const path = await sessionPath()
    if (!path) return
    const next = change(await readSession())
    await mkdir(dirname(path), { recursive: true })
    const tmp = `${path}.tmp`
    await writeFile(tmp, JSON.stringify(next, null, 2), 'utf8')
    await rename(tmp, path)
  })
  sessionQueue = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

async function rememberLastProject(filePath: string, keepOpenFiles: boolean): Promise<void> {
  await updateSession((prev) => {
    const same = prev.lastProject !== undefined && samePath(prev.lastProject, filePath)
    if (keepOpenFiles && same) return { ...prev, lastProject: filePath }
    return { ...prev, lastProject: filePath, openFiles: [], activeFile: null }
  })
}

function dialogStart(): string {
  return app.getPath('documents')
}

export async function getWindowBounds(): Promise<SessionFile['bounds']> {
  return (await readSession()).bounds
}

export async function saveWindowBounds(bounds: NonNullable<SessionFile['bounds']>): Promise<void> {
  await updateSession((prev) => ({ ...prev, bounds }))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function present(filePath: string, stored: StoredProject): Promise<Project> {
  return {
    name: stored.name,
    filePath,
    files: stored.files
  }
}

async function writeProjectFile(project: Project): Promise<void> {
  const stored: StoredProject = {
    name: project.name,
    files: project.files
  }
  const tmp = `${project.filePath}.tmp`
  await mkdir(dirname(project.filePath), { recursive: true })
  await writeFile(tmp, JSON.stringify(stored, null, 2), 'utf8')
  await rename(tmp, project.filePath)
}

export function getProject(): Project | null {
  return current
}

export async function loadProject(filePath: string, keepOpenFiles = false): Promise<Project> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(filePath, 'utf8'))
  } catch {
    throw new Error(`Could not read project ${filePath}`)
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.files)) {
    throw new Error('That file is not an edit-remote project')
  }
  const legacy = Array.isArray(parsed.hosts) ? parsed.hosts.map(parseStoredHost) : []
  const stored: StoredProject = {
    name: String(parsed.name || basename(filePath, '.erproj')),
    files: parsed.files.map((file) => {
      if (!isRecord(file) || !file.hostId || !file.path) throw new Error('Project file entry is invalid')
      return { hostId: String(file.hostId), path: String(file.path) }
    })
  }
  if (legacy.length > 0) await importLegacyHosts(filePath, legacy)
  current = await present(filePath, stored)
  if (legacy.length > 0) await writeProjectFile(current)
  await rememberLastProject(filePath, keepOpenFiles)
  return current
}

export async function restoreProject(): Promise<RestoredSession | null> {
  if (!(await askConfigDir())) return null
  const session = await readSession()
  if (!session.lastProject) return { hosts: await listHosts(), project: null, openFiles: [], activeFile: null, collapsed: [] }
  try {
    const project = await loadProject(session.lastProject, true)
    const openFiles = (session.openFiles ?? []).filter((file) =>
      project.files.some((known) => sameFile(known, file))
    )
    const activeFile =
      session.activeFile && openFiles.some((file) => sameFile(file, session.activeFile as RememberedFile))
        ? session.activeFile
        : (openFiles[openFiles.length - 1] ?? null)
    return { hosts: await listHosts(), project, openFiles, activeFile, collapsed: collapsedFor(session, project.filePath) }
  } catch {
    await updateSession((prev) => {
      const next = { ...prev }
      delete next.lastProject
      delete next.openFiles
      delete next.activeFile
      return next
    })
    return { hosts: await listHosts(), project: null, openFiles: [], activeFile: null, collapsed: [] }
  }
}

function collapsedFor(session: SessionFile, projectPath: string): RememberedFile[] {
  return session.trees?.find((row) => samePath(row.project, projectPath))?.collapsed ?? []
}

export async function collapsedForCurrent(): Promise<RememberedFile[]> {
  const project = current
  if (!project) return []
  return collapsedFor(await readSession(), project.filePath)
}

export async function saveCollapsed(collapsed: RememberedFile[]): Promise<void> {
  const project = current
  if (!project) return
  const kept = collapsed.filter((dir) =>
    project.files.some((file) => file.hostId === dir.hostId && (file.path === dir.path || file.path.startsWith(`${dir.path}/`)))
  )
  await updateSession((prev) => {
    const trees = (prev.trees ?? []).filter((row) => !samePath(row.project, project.filePath))
    if (kept.length > 0) trees.push({ project: project.filePath, collapsed: kept })
    return { ...prev, trees }
  })
}

export async function saveOpenFiles(files: RememberedFile[], active: RememberedFile | null): Promise<void> {
  const project = current
  if (!project) return
  const known = (file: RememberedFile): boolean => project.files.some((item) => sameFile(item, file))
  const openFiles = files.filter(known)
  const activeFile = active && known(active) ? active : (openFiles[openFiles.length - 1] ?? null)
  await updateSession((prev) => ({ ...prev, openFiles, activeFile }))
}

async function projectDialogPath(): Promise<string> {
  const last = (await readSession()).lastProject
  if (!last) return dialogStart()
  if (existsSync(last)) return last
  return dirname(last)
}

export async function createProject(parent: BrowserWindow | null): Promise<Project | null> {
  await requireConfigDir(parent)
  const start = await projectDialogPath()
  const folder = start.toLowerCase().endsWith('.erproj') ? dirname(start) : start
  const options = {
    title: 'New project',
    defaultPath: join(folder, 'project.erproj'),
    buttonLabel: 'Save',
    filters: [{ name: 'edit-remote project', extensions: ['erproj'] }],
    properties: ['createDirectory', 'showOverwriteConfirmation'] as Array<'createDirectory' | 'showOverwriteConfirmation'>
  }
  const picked = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options)
  if (picked.canceled || !picked.filePath) return null
  const filePath = picked.filePath.toLowerCase().endsWith('.erproj') ? picked.filePath : `${picked.filePath}.erproj`
  const name = basename(filePath).replace(/\.erproj$/i, '') || basename(filePath)
  current = { name, filePath, files: [] }
  await writeProjectFile(current)
  await rememberLastProject(filePath, false)
  return current
}

export async function openProject(parent: BrowserWindow | null): Promise<Project | null> {
  await requireConfigDir(parent)
  const options = {
    title: 'Open project',
    defaultPath: await projectDialogPath(),
    properties: ['openFile'] as 'openFile'[],
    filters: [{ name: 'edit-remote project', extensions: ['erproj'] }]
  }
  const picked = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
  if (picked.canceled || !picked.filePaths[0]) return null
  return loadProject(picked.filePaths[0], false)
}

function requireProject(): Project {
  if (!current) throw new Error('Open a project first')
  return current
}

let projectQueue: Promise<unknown> = Promise.resolve()

function withProject<T>(job: () => Promise<T>): Promise<T> {
  const run = projectQueue.then(job, job)
  projectQueue = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

export async function forgetHostFiles(hostId: string): Promise<Project | null> {
  return withProject(() => forgetHostFilesNow(hostId))
}

async function forgetHostFilesNow(hostId: string): Promise<Project | null> {
  const project = current
  if (!project) return null
  project.files = project.files.filter((file) => file.hostId !== hostId)
  await writeProjectFile(project)
  await updateSession((prev) => ({
    ...prev,
    openFiles: (prev.openFiles ?? []).filter((file) => file.hostId !== hostId),
    activeFile: prev.activeFile?.hostId === hostId ? null : prev.activeFile
  }))
  return project
}

export async function rememberFile(hostId: string, path: string): Promise<Project> {
  return withProject(() => rememberFileNow(hostId, path))
}

async function rememberFileNow(hostId: string, path: string): Promise<Project> {
  const project = requireProject()
  await readyHosts()
  findHost(hostId)
  const exists = project.files.some((file) => file.hostId === hostId && file.path === path)
  if (!exists) {
    project.files = [...project.files, { hostId, path }]
    await writeProjectFile(project)
  }
  return project
}

export async function forgetFile(hostId: string, path: string): Promise<Project> {
  return withProject(() => forgetFileNow(hostId, path))
}

async function forgetFileNow(hostId: string, path: string): Promise<Project> {
  const project = requireProject()
  project.files = project.files.filter((file) => !(file.hostId === hostId && file.path === path))
  await writeProjectFile(project)
  await updateSession((prev) => ({
    ...prev,
    openFiles: (prev.openFiles ?? []).filter((file) => !sameFile(file, { hostId, path })),
    activeFile: prev.activeFile && sameFile(prev.activeFile, { hostId, path }) ? null : prev.activeFile
  }))
  return project
}
