export type Facts = {
  at: number
  changed: number
  ahead: number
  behind: number
  worktrees: number
  ports: string[]
  claim: string
  openItems: number
  git: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'close-gate': { facts: Facts | null; hidden: boolean }
  }
}
