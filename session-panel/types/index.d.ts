export type Step = { content: string; status: 'pending' | 'in_progress' | 'completed' }
export type Output = { path: string; isScratch: boolean }
export type Card = 'progress' | 'outputs' | 'used'
export type Collapsed = { progress: boolean; outputs: boolean; used: boolean }

declare module 'claude-code' {
  interface PluginState {
    'session-panel': {
      steps: Step[]
      outputs: Output[]
      used: string[]
      collapsed: Collapsed
    }
  }
}
