/// <reference types="vite/client" />

declare module '@fontsource-variable/geist'
declare module '@fontsource-variable/geist-mono'

interface Window {
  dotden: {
    platform: NodeJS.Platform
    versions: {
      node: string
      electron: string
      chrome: string
    }
  }
}
