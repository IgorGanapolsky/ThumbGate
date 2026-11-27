import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { ModelTokens, ThumbSnap, UsageSnap } from '../types'

const usage = atom({ plugin: 'usage-bar', key: 'usage' } as const, null, {
  shape: 'usage-1',
})
const thumbs = atom({ plugin: 'usage-bar', key: 'thumbs' } as const, null, {
  shape: 'thumbs-1',
})

const DASHBOARD = 'https://thumbgate.ai/dashboard'
const MAC_SERVER = 'remote-devices'
const MAC_STATS_TOOL = 'thumbgate__feedback_stats'
// In a cloud session a mod can't reach tools on the person's computer, so a
// project task copies the Mac's counts here; the band reads the copy.
const BRIDGE = '/mnt/project-files/usage-bar/thumbgate.json'
function shortModel(id: string): string {
  const m = id.toLowerCase()
  for (const name of ['opus', 'sonnet', 'haiku', 'fable']) {
    if (m.includes(name)) return name.charAt(0).toUpperCase() + name.slice(1)
  }
  return id.replace(/^claude-/, '')
}

function compact(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`
  return String(n)
}

function eastern(ms: number, withDay: boolean): string {
  try {
    return new Date(ms).toLocaleString('en-US', {
      timeZone: 'America/New_York',
      ...(withDay ? { weekday: 'short' } : {}),
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return new Date(ms).toISOString().slice(11, 16) + ' UTC'
  }
}

// Sums every assistant response in this session's transcript, once per
// message id, so the totals include turns from before the mod loaded.
async function transcriptTokens($: any): Promise<{ total: number; models: ModelTokens[] }> {
  const byId = new Map<string, { model: string; tokens: number }>()
  try {
    const { transcriptPath } = await $.session.info()
    const text: string = await $.fs.read(transcriptPath)
    for (const line of text.split('\n')) {
      if (!line.includes('"usage"')) continue
      let row: any
      try {
        row = JSON.parse(line)
      } catch {
        continue
      }
      const msg = row?.message
      const u = msg?.usage
      if (row?.type !== 'assistant' || !u || !msg?.model) continue
      const tokens =
        (u.input_tokens ?? 0) +
        (u.output_tokens ?? 0) +
        (u.cache_creation_input_tokens ?? 0) +
        (u.cache_read_input_tokens ?? 0)
      byId.set(msg.id ?? row.uuid, { model: shortModel(msg.model), tokens })
    }
  } catch {
    // no transcript readable: totals stay 0
  }
  const perModel = new Map<string, number>()
  let total = 0
  for (const { model, tokens } of byId.values()) {
    total += tokens
    perModel.set(model, (perModel.get(model) ?? 0) + tokens)
  }
  const models = [...perModel.entries()]
    .map(([model, tokens]) => ({ model, tokens }))
    .sort((a, b) => b.tokens - a.tokens)
  return { total, models }
}

async function refreshUsage($: any): Promise<void> {
  const u = await $.session.usage()
  const { total, models } = await transcriptTokens($)
  const weekly = u.rateLimits.find((r: any) => r.kind === 'seven_day')
  const five = u.rateLimits.find((r: any) => r.kind === 'five_hour')
  const snap: UsageSnap = {
    tokens: total,
    usd: u.cost?.usd ?? null,
    models,
    contextPercent: u.context.percent ?? null,
    contextTokens: u.context.tokens ?? null,
    contextWindow: u.context.window,
    weeklyPercent: weekly?.percentUsed ?? null,
    weeklyResetsAt: weekly?.resetsAt ?? null,
    fiveHourPercent: five?.percentUsed ?? null,
    readAt: await $.clock.now(),
  }
  await update($, usage, () => snap)
}

async function refreshThumbs($: any): Promise<void> {
  let version: string | null = null
  let up: number | null = null
  let down: number | null = null
  let trend: string | null = null
  let source = 'your Mac'
  try {
    const r = await $.http.fetch('https://registry.npmjs.org/thumbgate/latest')
    if (r.ok) version = JSON.parse(r.text).version ?? null
  } catch {
    // leave version unknown
  }
  try {
    const res = await $.mcp.call(MAC_SERVER, MAC_STATS_TOOL, {})
    const block = res.content.find((c: any) => c.type === 'text') as any
    if (!res.isError && block) {
      const stats = JSON.parse(block.text)
      up = stats.totalPositive ?? null
      down = stats.totalNegative ?? null
      trend = stats.trend ?? null
    } else {
      source = '👍/👎 live on your Mac only'
    }
  } catch {
    source = '👍/👎 live on your Mac only'
  }
  if (up === null) {
    try {
      const copy = JSON.parse(await $.fs.read(BRIDGE))
      if (typeof copy.up === 'number' && typeof copy.down === 'number') {
        up = copy.up
        down = copy.down
        trend = copy.trend ?? null
        source = copy.readAt
          ? `your Mac, ${eastern(Date.parse(copy.readAt), false)} ET`
          : 'your Mac'
      }
    } catch {
      // no copy yet
    }
  }
  const t: ThumbSnap = { version, up, down, trend, source, readAt: Date.now() }
  await update($, thumbs, () => t)

}

export const register: Register = on => {
  let started = false

  const safe = (p: Promise<void>) => p.catch(() => undefined)

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    if (!started) {
      started = true
      void safe(refreshUsage($))
      void safe(refreshThumbs($))
      $.clock.every(60_000, () => void safe(refreshUsage($)))
      $.clock.every(5 * 60_000, () => void safe(refreshThumbs($)))
    }
    await $.command.register({
      name: 'usage-bar-refresh',
      description: 'Re-read token usage and ThumbGate stats now',
    })
    return result
  })

  on('command.run', { command: 'usage-bar-refresh' }, async $ => {
    await refreshUsage($)
    await refreshThumbs($)
    return { text: 'Usage bar refreshed.' }
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) void safe(refreshUsage($))
    return result
  })

  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    void safe(refreshUsage($))
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    if (!started) {
      started = true
      void safe(refreshUsage($))
      void safe(refreshThumbs($))
      $.clock.every(60_000, () => void safe(refreshUsage($)))
      $.clock.every(5 * 60_000, () => void safe(refreshThumbs($)))
    }
    const u = await read($, usage)
    const t = await read($, thumbs)
    const { Box, Text, Link } = $.ui.resolve(e)

    const line1: string[] = []
    const line2: string[] = []
    if (u) {
      const parts = [`This thread: ${compact(u.tokens)} tokens`]
      if (u.usd !== null) parts.push(`$${u.usd.toFixed(2)} at API prices (plan is flat-rate)`)
      const sum = u.models.reduce((n, m) => n + m.tokens, 0)
      if (sum > 0) {
        parts.push(
          u.models
            .slice(0, 3)
            .map(m => `${m.model} ${Math.round((m.tokens / sum) * 100)}%`)
            .join(' / '),
        )
      }
      parts.push(`read ${eastern(u.readAt, false)} ET, every minute`)
      line1.push(parts.join(' · '))

      const limits: string[] = []
      if (u.contextPercent !== null) {
        limits.push(
          `context ${u.contextPercent}% (${compact(u.contextTokens ?? 0)}/${compact(u.contextWindow)})`,
        )
      }
      if (u.weeklyPercent !== null) {
        const reset = u.weeklyResetsAt
          ? `, resets ${eastern(Date.parse(u.weeklyResetsAt), true)} ET`
          : ''
        limits.push(`weekly limit ${Math.round(u.weeklyPercent)}%${reset}`)
      } else {
        limits.push('weekly limit: no reading yet')
      }
      if (u.fiveHourPercent !== null) limits.push(`5-hour ${Math.round(u.fiveHourPercent)}%`)
      line2.push(limits.join(' · '))
    } else {
      line1.push('Reading token usage…')
    }

    const tg: string[] = [`ThumbGate ${t?.version ? `v${t.version}` : ''}`.trim()]
    if (t && t.up !== null && t.down !== null) {
      tg.push(`${t.up}👍 ${t.down}👎 (${t.source}${t.trend ? `, ${t.trend}` : ''})`)
    } else if (t) {
      tg.push(t.source)
    }

    return (
      <Box flexDirection="column">
        <Text dimColor>{line1.join('')}</Text>
        {line2.length > 0 && <Text color="yellow">{line2.join('')}</Text>}
        <Box>
          <Text color="cyan">{tg.join(' · ')} · </Text>
          <Link href={DASHBOARD} label="Dashboard" />
        </Box>
      </Box>
    )
  })
}
