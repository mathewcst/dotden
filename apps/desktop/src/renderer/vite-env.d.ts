/// <reference types="vite/client" />

declare module '@fontsource-variable/geist'
declare module '@fontsource-variable/geist-mono'

interface RemoteDiagnostics {
  readonly host: string
  readonly scheme: string
  readonly exitCode?: number
  readonly stderr: string
  readonly help: string
}

interface PreflightResult {
  readonly reachable: boolean
  readonly gitCommand: string
  readonly diagnostics?: RemoteDiagnostics
}

interface ConnectResult {
  readonly gitCommand: string
  readonly sourceDir: string
}

interface Window {
  dotden: {
    platform: NodeJS.Platform
    versions: {
      node: string
      electron: string
      chrome: string
    }
    remote: {
      preflight(url: string): Promise<PreflightResult>
      connect(url: string): Promise<ConnectResult>
      latestSha(url: string, branch?: string): Promise<string | null>
    }
  }
}
