export type Session = { state: string; id: string; workspace: string; age: string; claim: string; raw?: string }
export type Board = { sessions: Session[]; raw: string[]; at: number; error?: string }
export type Repo = { name: string; behind: number; ahead: number; dirty: number; fetchedAt?: number; at: number }
export type Radar = { local: Board; peer: Board; repos: Repo[]; vault?: { result: string; active: string; blocked: boolean; at: number }; platform: string; host: string; at: number }

declare module 'claude-code' {
  interface PluginState {
    'peer-radar': { radar: Radar | null }
  }
}
