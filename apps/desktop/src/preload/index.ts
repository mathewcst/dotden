import { contextBridge } from 'electron'

const api = {
  platform: process.platform,
  versions: {
    node: process.versions.node,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },
}

contextBridge.exposeInMainWorld('dotden', api)
