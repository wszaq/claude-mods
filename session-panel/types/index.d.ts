export type Step = { content: string; status: 'pending' | 'in_progress' | 'completed' }
export type Output = { path: string; isScratch: boolean }
export type Agent = { id: string; agentId?: string; name: string; model: string; tokens: number; ms: number; startedAt: number; isDone: boolean }
export type Mod = { id: string; isOn: boolean }
export type Card = 'progress' | 'outputs' | 'used' | 'subagents' | 'mods'
export type Collapsed = { progress: boolean; outputs: boolean; used: boolean; subagents: boolean; mods: boolean }

declare module 'claude-code' {
  interface PluginState {
    'session-panel': {
      steps: Step[]
      outputs: Output[]
      used: string[]
      agents: Agent[]
      mods: Mod[]
      collapsed: Collapsed
    }
  }
}
