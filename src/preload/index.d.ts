import type { EditRemoteApi } from '../shared/types'

declare global {
  interface Window {
    api: EditRemoteApi
  }
}

export {}
