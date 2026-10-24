export type Step = { content: string; status: 'pending' | 'in_progress' | 'completed' }
export type Output = { path: string; isScratch: boolean }
export type Agent = { id: string; agentId?: string; name: string; model: string; tokens: number; ms: number; startedAt: number; isDone: boolean }
export type Mod = { id: string; isOn: boolean; isLoaded: boolean; isBusy: boolean }
export type Card = 'progress' | 'outputs' | 'used' | 'subagents' | 'mods'
export type Collapsed = { progress: boolean; outputs: boolean; used: boolean; subagents: boolean; mods: boolean }

declare module 'claude-code' {
  interface PluginState {
    'session-panel': {
      steps: Step[]
      outputs: Output[]
      used: string[]
      agents: Agent[]
      // USD per subagent id, summed over its model calls; null once a call had a model without a price.
      spend: Record<string, number | null>
      mods: Mod[]
      collapsed: Collapsed
    }
  }
}
