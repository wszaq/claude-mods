export type Deliverable = { path: string; recordedAt: number }

declare module 'claude-code' {
  interface PluginState {
    'deliverable-dock': { files: Deliverable[] }
  }
}
