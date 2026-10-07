import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { app, dialog, type BrowserWindow } from 'electron'
import { installedUserDataDir } from './user-data'

let chosen: string | null = null
let pending: Promise<string | null> | null = null
let windowForDialog: () => BrowserWindow | null = () => null

export function bindConfigWindow(getWindow: () => BrowserWindow | null): void {
  windowForDialog = getWindow
}

function launchedExeDir(): string | null {
  if (process.env.PORTABLE_EXECUTABLE_DIR) return process.env.PORTABLE_EXECUTABLE_DIR
  if (app.isPackaged) return dirname(app.getPath('exe'))
  return null
}

function devProjectDir(): string {
  return join(__dirname, '../..')
}

function pointerPath(): string {
  const home = launchedExeDir()
  if (home) return join(home, 'config-location.json')
  return join(devProjectDir(), 'config-location.json')
}

/** Dev used to store its pointer in an app-data folder. */
async function migrateDevPointer(): Promise<void> {
  if (launchedExeDir()) return
  const next = pointerPath()
  const previous = [join(app.getPath('userData'), 'config-location.json'), join(installedUserDataDir(), 'config-location.json')]
  for (const from of previous) {
    if (from === next || !existsSync(from)) continue
    if (!existsSync(next)) {
      await mkdir(dirname(next), { recursive: true })
      await copyFile(from, next)
    }
    await unlink(from)
  }
}

function resolvePointedDir(dir: string): string {
  if (isAbsolute(dir)) return dir
  return join(launchedExeDir() ?? devProjectDir(), dir)
}

async function readPointer(): Promise<string | null> {
  await migrateDevPointer()
  try {
    const parsed = JSON.parse(await readFile(pointerPath(), 'utf8')) as { dir?: unknown }
    if (typeof parsed.dir !== 'string' || !parsed.dir) return null
    const dir = resolvePointedDir(parsed.dir)
    if (!existsSync(dir)) return null
    return dir
  } catch {
    return null
  }
}

async function writePointer(dir: string): Promise<void> {
  await migrateDevPointer()
  const path = pointerPath()
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  await writeFile(tmp, JSON.stringify({ dir }), 'utf8')
  await rename(tmp, path)
}

async function moveLegacyFile(name: string, dir: string): Promise<void> {
  const from = join(installedUserDataDir(), name)
  const to = join(dir, name)
  if (!existsSync(from) || existsSync(to)) return
  await copyFile(from, to)
  await unlink(from)
}

/** Folder the user chose for session and secrets. Does not prompt. */
export async function knownConfigDir(): Promise<string | null> {
  const home = launchedExeDir()
  if (home) {
    if (chosen && existsSync(chosen)) return chosen
    const pointed = await readPointer()
    if (pointed) {
      chosen = pointed
      return pointed
    }
    const dir = join(home, 'config')
    await mkdir(dir, { recursive: true })
    await writePointer('config')
    chosen = dir
    return dir
  }
  if (chosen && existsSync(chosen)) return chosen
  chosen = await readPointer()
  return chosen
}

/** Ask once for a settings folder, then reuse it. Cancel returns null. */
export function askConfigDir(parent?: BrowserWindow | null): Promise<string | null> {
  if (!pending) {
    pending = chooseConfigDir(parent).finally(() => {
      pending = null
    })
  }
  return pending
}

async function chooseConfigDir(parent?: BrowserWindow | null): Promise<string | null> {
  const existing = await knownConfigDir()
  if (existing) return existing
  const owner = parent === undefined ? windowForDialog() : parent
  const options = {
    title: 'Choose a folder for edit-remote settings',
    buttonLabel: 'Use this folder',
    defaultPath: app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>
  }
  const picked = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
  const dir = picked.filePaths[0]
  if (picked.canceled || !dir) return null
  await mkdir(dir, { recursive: true })
  await moveLegacyFile('session.json', dir)
  await moveLegacyFile('secrets.json', dir)
  await writePointer(dir)
  chosen = dir
  return dir
}
