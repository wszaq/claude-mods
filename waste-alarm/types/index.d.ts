export type Tip = { category: string; title: string; body: string }

declare module 'claude-code' {
  interface PluginState {
    'waste-alarm': { tips: Tip[] }
  }
}
