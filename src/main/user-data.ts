import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

const APP_DATA_NAME = 'edit-remote'

/** Roaming folder an installed build uses for its Chromium cache. */
export function installedUserDataDir(): string {
  return join(app.getPath('appData'), APP_DATA_NAME)
}

function useCacheDir(dir: string): void {
  mkdirSync(dir, { recursive: true })
  app.setPath('userData', dir)
  app.setPath('sessionData', dir)
}

if (!app.isPackaged) {
  useCacheDir(join(app.getPath('appData'), `${APP_DATA_NAME}-dev`))
} else if (process.env.PORTABLE_EXECUTABLE_DIR) {
  useCacheDir(join(app.getPath('appData'), `${APP_DATA_NAME}-portable`))
}
