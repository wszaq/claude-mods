export type CheckView = {
  kind: 'running' | 'pass' | 'fail'
  name: string
  exitCode: number
  output: string
  at: number
  flags?: number
}

declare module 'claude-code' {
  interface PluginState {
    'verify-gate': {
      changed: string[]
      enabled: boolean
      view: CheckView | null
      lastFailure: string | null
    }
  }
}
