import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { app, dialog, type BrowserWindow } from 'electron'

let chosen: string | null = null
let pending: Promise<string | null> | null = null
let windowForDialog: () => BrowserWindow | null = () => null

export function bindConfigWindow(getWindow: () => BrowserWindow | null): void {
  windowForDialog = getWindow
}

function pointerPath(): string {
  return join(app.getPath('userData'), 'config-location.json')
}

async function readPointer(): Promise<string | null> {
  try {
    const parsed = JSON.parse(await readFile(pointerPath(), 'utf8')) as { dir?: unknown }
    if (typeof parsed.dir !== 'string' || !existsSync(parsed.dir)) return null
    return parsed.dir
  } catch {
    return null
  }
}

async function writePointer(dir: string): Promise<void> {
  const path = pointerPath()
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  await writeFile(tmp, JSON.stringify({ dir }), 'utf8')
  await rename(tmp, path)
}

async function moveLegacyFile(name: string, dir: string): Promise<void> {
  const from = join(app.getPath('userData'), name)
  const to = join(dir, name)
  if (!existsSync(from) || existsSync(to)) return
  await copyFile(from, to)
  await unlink(from)
}

/** Folder the user chose for session and secrets. Does not prompt. */
export async function knownConfigDir(): Promise<string | null> {
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
