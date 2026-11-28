export type ModelTokens = { model: string; tokens: number; usd?: number }

export type UsageSnap = {
  tokens: number
  usd: number | null
  today: { tokens: number; usd: number; models: ModelTokens[]; files: number } | null
  models: ModelTokens[]
  contextPercent: number | null
  contextTokens: number | null
  contextWindow: number
  weeklyPercent: number | null
  weeklyResetsAt: string | null
  fiveHourPercent: number | null
  readAt: number
}

export type BandMode = 'full' | 'compact' | 'off'

export type ThumbSnap = {
  version: string | null
  up: number | null
  down: number | null
  trend: string | null
  source: string
  readAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'usage-bar': { usage: Shaped<UsageSnap | null>; thumbs: Shaped<ThumbSnap | null> }
  }
}
