import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { BandMode, ModelTokens, ThumbSnap, UsageSnap } from '../types'

const usage = atom({ plugin: 'usage-bar', key: 'usage' } as const, null, {
  shape: 'usage-1',
})
const thumbs = atom({ plugin: 'usage-bar', key: 'thumbs' } as const, null, {
  shape: 'thumbs-1',
})

const DASHBOARD = 'https://thumbgate.ai/dashboard'
// Where ThumbGate's feedback_stats tool lives: the local server this repo's
// .mcp.json registers, then the same server reached through the Claude app.
const STATS_ROUTES: ReadonlyArray<readonly [string, string]> = [
  ['thumbgate', 'feedback_stats'],
  ['remote-devices', 'thumbgate__feedback_stats'],
]
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

// API list prices per million tokens: input, output, cache read, 5-minute
// cache write, 1-hour cache write. The plan is flat-rate; this is what the
// same tokens would cost on the API.
const PRICES: Record<string, [number, number, number, number, number]> = {
  Fable: [8, 40, 0.2, 10, 16],
  Opus: [4, 20, 0.2, 5, 8],
  Sonnet: [2, 10, 0.1, 2.5, 4],
  Haiku: [0.1, 0.5, 0.01, 0.125, 0.2],
}

export function priceOf(model: string, u: any): number {
  const p = PRICES[model]
  if (!p) return 0
  const cc = u.cache_creation ?? {}
  const w1h = cc.ephemeral_1h_input_tokens ?? 0
  const w5m =
    cc.ephemeral_5m_input_tokens ?? Math.max(0, (u.cache_creation_input_tokens ?? 0) - w1h)
  return (
    ((u.input_tokens ?? 0) * p[0] +
      (u.output_tokens ?? 0) * p[1] +
      (u.cache_read_input_tokens ?? 0) * p[2] +
      w5m * p[3] +
      w1h * p[4]) /
    1e6
  )
}

// Midnight in New York on the day of `now`, as epoch ms.
export function easternMidnight(now: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(now))
  const n = (t: string) => Number(parts.find(x => x.type === t)?.value ?? 0)
  // Some engines print midnight as hour 24.
  const hour = n('hour') % 24
  return now - ((hour * 60 + n('minute')) * 60 + n('second')) * 1000 - (now % 1000)
}

type Row = { model: string; tokens: number; usd: number }
type FileSum = { mtime: number; size: number; rows: Map<string, Row> }
const fileCache = new Map<string, FileSum>()

// Every assistant response on this machine since midnight ET, across all
// Claude Code transcripts (sessions and their subagents), once per message id.
// A file is re-read only when its size or mtime changed.
async function todayOnMachine($: any, now: number): Promise<UsageSnap['today']> {
  const { transcriptPath } = await $.session.info()
  const segs = String(transcriptPath).split('/')
  const root = segs.slice(0, segs.length - 2).join('/')
  const since = easternMidnight(now)
  const files: Array<{ path: string; mtime: number; size: number }> = []
  const addDir = async (dir: string, depth: number): Promise<void> => {
    let entries: any[] = []
    try {
      entries = await $.fs.list(dir)
    } catch {
      return
    }
    for (const e of entries) {
      const path = `${dir}/${e.name}`
      if (e.kind === 'file' && e.name.endsWith('.jsonl') && (e.mtimeMs ?? 0) >= since) {
        files.push({ path, mtime: e.mtimeMs ?? 0, size: e.size ?? 0 })
      } else if (e.kind === 'dir' && depth > 0) {
        await addDir(path, depth - 1)
      }
    }
  }
  let projects: any[] = []
  try {
    projects = await $.fs.list(root)
  } catch {
    return null
  }
  for (const p of projects) if (p.kind === 'dir') await addDir(`${root}/${p.name}`, 2)

  const all = new Map<string, Row>()
  for (const f of files) {
    let sum = fileCache.get(f.path)
    if (!sum || sum.mtime !== f.mtime || sum.size !== f.size) {
      const rows = new Map<string, Row>()
      try {
        const text: string = await $.fs.read(f.path)
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
          if (!(Date.parse(row.timestamp ?? '') >= since)) continue
          const model = shortModel(msg.model)
          const tokens =
            (u.input_tokens ?? 0) +
            (u.output_tokens ?? 0) +
            (u.cache_creation_input_tokens ?? 0) +
            (u.cache_read_input_tokens ?? 0)
          rows.set(msg.id ?? row.uuid, { model, tokens, usd: priceOf(model, u) })
        }
      } catch {
        continue
      }
      sum = { mtime: f.mtime, size: f.size, rows }
      fileCache.set(f.path, sum)
    }
    for (const [id, r] of sum.rows) all.set(id, r)
  }
  let tokens = 0
  let usd = 0
  const perModel = new Map<string, { tokens: number; usd: number }>()
  for (const r of all.values()) {
    tokens += r.tokens
    usd += r.usd
    const m = perModel.get(r.model) ?? { tokens: 0, usd: 0 }
    perModel.set(r.model, { tokens: m.tokens + r.tokens, usd: m.usd + r.usd })
  }
  const models = [...perModel.entries()]
    .map(([model, m]) => ({ model, tokens: m.tokens, usd: m.usd }))
    .sort((a, b) => b.tokens - a.tokens)
  return { tokens, usd, models, files: files.length }
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
    today: null,
    readAt: await $.clock.now(),
  }
  try {
    snap.today = await todayOnMachine($, snap.readAt)
  } catch {
    snap.today = null
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
  for (const [server, tool] of STATS_ROUTES) {
    try {
      const res = await $.mcp.call(server, tool, {})
      const block = res.content.find((c: any) => c.type === 'text') as any
      if (res.isError || !block) continue
      const stats = JSON.parse(block.text)
      if (typeof stats.totalPositive !== 'number') continue
      up = stats.totalPositive
      down = stats.totalNegative ?? null
      trend = stats.trend ?? null
      source = server === 'thumbgate' ? 'this machine' : 'your Mac'
      break
    } catch {
      // not connected here, or refused in a cloud session: try the next route
    }
  }
  if (up === null) source = '👍/👎 live on your Mac only'
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

let started = false

function safe(p: Promise<void>): void {
  p.catch(() => undefined)
}

// Read once at once, then every minute (tokens) and every 5 minutes (thumbs).
function start($: any): void {
  if (started) return
  started = true
  safe(refreshUsage($))
  safe(refreshThumbs($))
  $.clock.every(60_000, () => safe(refreshUsage($)))
  $.clock.every(5 * 60_000, () => safe(refreshThumbs($)))
}

const PANE = 'usage'
const MODES: readonly BandMode[] = ['full', 'compact', 'off']

async function modeOf($: any): Promise<BandMode> {
  try {
    const m = await $.store.get('mode')
    return MODES.includes(m as BandMode) ? (m as BandMode) : 'full'
  } catch {
    return 'full'
  }
}

export const register: Register = on => {

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    start($)
    await $.command.register({
      name: 'usage-bar-refresh',
      description: 'Re-read token usage and ThumbGate stats now',
      immediate: true,
    })
    await $.command.register({
      name: 'usage',
      description: "Open today's tokens and cost by model, limits and ThumbGate in a pane",
      immediate: true,
    })
    await $.command.register({
      name: 'usage-bar',
      description: 'Set the band above the prompt: full, compact or off',
      argumentHint: '[full|compact|off]',
      immediate: true,
    })
    return result
  })

  on('command.run', { command: 'usage-bar-refresh' }, async $ => {
    await refreshUsage($)
    await refreshThumbs($)
    return { text: 'Usage bar refreshed.' }
  })

  on('command.run', { command: 'usage' }, async $ => {
    start($)
    const opened = await $.ui.open({ id: PANE, title: 'Usage', closeOnEscape: true })
    return { text: opened.isPlaced ? 'Usage pane open.' : `Usage pane waiting: ${opened.reason}` }
  })

  on('command.run', { command: 'usage-bar' }, async ($, e) => {
    const want = String(e.args ?? '').trim().toLowerCase()
    if (!MODES.includes(want as BandMode)) {
      return { text: `Band is ${await modeOf($)}. Use /usage-bar full, compact or off.` }
    }
    await $.store.set('mode', want)
    $.ui.invalidate('ui.render')
    return { text: `Band set to ${want}.` }
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) safe(refreshUsage($))
    return result
  })

  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    safe(refreshUsage($))
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // The terminal already has the person's own status line.
    if (e.props.hasSurvey || e.surface === 'terminal') return next(e)
    start($)
    const mode = await modeOf($)
    if (mode === 'off') return next(e)
    const u = await read($, usage)
    const t = await read($, thumbs)
    const { Box, Text, Link } = $.ui.resolve(e)

    const line1: string[] = []
    const line2: string[] = []
    if (u) {
      const mix = (ms: ModelTokens[]) => {
        const sum = ms.reduce((n, m) => n + m.tokens, 0)
        return sum > 0
          ? ms
              .slice(0, 3)
              .map(m => `${m.model} ${Math.round((m.tokens / sum) * 100)}%`)
              .join(' / ')
          : ''
      }
      const parts: string[] = []
      if (u.today) {
        parts.push(`Today: ${compact(u.today.tokens)} tokens`)
        parts.push(`$${u.today.usd.toFixed(2)} at API prices (plan is flat-rate)`)
        const m = mix(u.today.models)
        if (m) parts.push(m)
        parts.push('this machine')
      }
      const here = [`this session ${compact(u.tokens)} tokens`]
      if (u.usd !== null) here.push(`$${u.usd.toFixed(2)}`)
      if (!u.today) {
        const m = mix(u.models)
        if (m) here.push(m)
      }
      parts.push(here.join(' '))
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

    // Narrow windows and compact mode get one line: today's cost, tokens,
    // weekly limit and the thumbs.
    if (mode === 'compact' || e.props.bodyColumns < 90) {
      const bits: string[] = []
      if (u?.today) bits.push(`Today $${u.today.usd.toFixed(2)} · ${compact(u.today.tokens)} tokens`)
      else if (u) bits.push(`${compact(u.tokens)} tokens`)
      if (u?.weeklyPercent != null) bits.push(`weekly ${Math.round(u.weeklyPercent)}%`)
      if (t && t.up !== null && t.down !== null) bits.push(`ThumbGate ${t.up}👍 ${t.down}👎`)
      return <Text dimColor>{bits.join(' · ') || 'Reading token usage…'}</Text>
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

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    start($)
    const u = await read($, usage)
    const t = await read($, thumbs)
    const { Box, Text, Link } = $.ui.resolve(e)
    const usd = (n: number) => `$${n.toFixed(2)}`
    const thumbsLine =
      t && t.up !== null && t.down !== null
        ? `${t.up}👍 ${t.down}👎${t.trend ? ` (${t.trend})` : ''}`
        : (t?.source ?? 'ThumbGate: reading…')

    // The desktop's minimized pane: one glance, no clicks.
    if (e.props.placement === 'widget') {
      return (
        <Box flexDirection="column">
          <Text bold>{u?.today ? `Today ${usd(u.today.usd)}` : 'Today …'}</Text>
          <Text dimColor>{u?.today ? `${compact(u.today.tokens)} tokens` : ''}</Text>
          <Text color="cyan">{thumbsLine}</Text>
        </Box>
      )
    }

    const rows: string[] = []
    if (u?.today) {
      rows.push(`Today on this machine (since midnight ET): ${compact(u.today.tokens)} tokens, ${usd(u.today.usd)} at API prices`)
      for (const m of u.today.models) {
        rows.push(`  ${m.model.padEnd(7)} ${compact(m.tokens).padStart(6)} tokens  ${usd(m.usd ?? 0).padStart(8)}`)
      }
      rows.push(`  from ${u.today.files} transcript file${u.today.files === 1 ? '' : 's'}; your plan is flat-rate, so this is not a bill`)
    }
    if (u) {
      rows.push(`This session: ${compact(u.tokens)} tokens${u.usd !== null ? `, ${usd(u.usd)}` : ''}`)
      if (u.contextPercent !== null) {
        rows.push(`Context: ${u.contextPercent}% (${compact(u.contextTokens ?? 0)} of ${compact(u.contextWindow)})`)
      }
      rows.push(
        u.weeklyPercent !== null
          ? `Weekly limit: ${Math.round(u.weeklyPercent)}%${u.weeklyResetsAt ? `, resets ${eastern(Date.parse(u.weeklyResetsAt), true)} ET` : ''}`
          : 'Weekly limit: no reading yet',
      )
      if (u.fiveHourPercent !== null) rows.push(`5-hour limit: ${Math.round(u.fiveHourPercent)}%`)
      rows.push(`Read ${eastern(u.readAt, false)} ET, every minute`)
    } else {
      rows.push('Reading token usage…')
    }

    return (
      <Box flexDirection="column">
        {rows.map((r, i) => (
          <Text key={String(i)} dimColor={i > 0 && r.startsWith('  ')}>
            {r}
          </Text>
        ))}
        <Box>
          <Text color="cyan">
            ThumbGate {t?.version ? `v${t.version} · ` : ''}
            {thumbsLine}
            {t && t.up !== null ? ` · ${t.source}` : ''} ·{' '}
          </Text>
          <Link href={DASHBOARD} label="Dashboard" />
        </Box>
        <Text dimColor>/usage-bar full | compact | off sets the band above the prompt</Text>
      </Box>
    )
  })
}
