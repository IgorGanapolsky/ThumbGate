import { expect, test } from 'claude-code/testing'

import { easternMidnight } from '../hooks/register'

const BAND = {
  plugin: 'usage-bar',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

const T = '2026-11-27T21:00:00Z'
const transcript = [
  { type: 'assistant', timestamp: '2026-11-26T12:00:00Z', message: { id: 'old', model: 'claude-opus-5-5', usage: { input_tokens: 0, output_tokens: 0 } } },
  { type: 'assistant', timestamp: T, message: { id: 'a', model: 'claude-opus-5-5', usage: { input_tokens: 600, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
  { type: 'assistant', timestamp: T, message: { id: 'a', model: 'claude-opus-5-5', usage: { input_tokens: 600, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
  { type: 'assistant', timestamp: T, message: { id: 'b', model: 'claude-haiku-5-5', usage: { input_tokens: 200, output_tokens: 0 } } },
].map(r => JSON.stringify(r)).join('\n')

test('the band shows usage, limits and ThumbGate counts', async ($, on) => {
  on('command.register', () => ({ value: { command: 'usage-bar-refresh' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens: 191000, window: 1000000, percent: 19 },
      rateLimits: [
        { kind: 'seven_day', percentUsed: 83, resetsAt: '2026-11-30T17:00:00Z' },
        { kind: 'five_hour', percentUsed: 12 },
      ],
      cost: { usd: 4.5 },
    },
  }))
  on('clock.now', () => ({ value: Date.parse('2026-11-27T21:12:39Z') }))
  on('clock.every', () => ({ value: undefined }))
  on('session.info', () => ({ value: { transcriptPath: '/p/proj/t.jsonl' } }))
  on('fs.list', (_, e: any) => ({
    value:
      String(e.path ?? e) === '/p'
        ? [{ name: 'proj', kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false }]
        : [
            { name: 't.jsonl', kind: 'file', size: 10, mtimeMs: Date.parse(T), isLink: false },
            { name: 'stale.jsonl', kind: 'file', size: 10, mtimeMs: Date.parse('2026-11-25T12:00:00Z'), isLink: false },
          ],
  }))
  on('fs.read', () => ({ value: transcript }))
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: '{"version":"1.50.0"}' } }))
  on('mcp.call', () => ({
    value: { isError: false, content: [{ type: 'text', text: '{"totalPositive":1,"totalNegative":9,"trend":"degrading"}' }] },
  }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'usage-bar-refresh', args: '', origin: { kind: 'human' }, presentation: 'text' } as any)

  for (const surface of ['desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const top = await ui.find({ type: 'Text', text: /Today/ })
    // opus 600 in + 200 out = $0.0064, haiku 200 in = $0.00002
    expect(top?.text).toContain('Today: 1k tokens · $0.01 at API prices (plan is flat-rate) · Opus 80% / Haiku 20% · this machine')
    expect(top?.text).toContain('this session 1k tokens $4.50')
    const limits = await ui.find({ type: 'Text', text: /context/ })
    expect(limits?.text).toContain('context 19% (191k/1.0M)')
    expect(limits?.text).toContain('weekly limit 83%, resets Mon 12:00 PM ET')
    const tg = await ui.find({ type: 'Text', text: /ThumbGate/ })
    expect(tg?.text).toContain('ThumbGate v1.50.0 · 1👍 9👎 (this machine, degrading)')
    await ui.unmount()
  }

  const term = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await term.find({ type: 'Text', text: /ThumbGate/ })).toBeFalsy()
  await term.unmount()
})

test('a local thumbgate server is read first', async ($, on) => {
  const asked: string[] = []
  on('command.register', () => ({ value: { command: 'usage-bar-refresh' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: [] } }))
  on('clock.now', () => ({ value: 0 }))
  on('clock.every', () => ({ value: undefined }))
  on('session.info', () => ({ value: { transcriptPath: '/t.jsonl' } }))
  on('fs.read', () => ({ value: '' }))
  on('http.fetch', () => ({ value: { status: 500, ok: false, headers: {}, text: '' } }))
  on('mcp.call', (_, e: any) => {
    asked.push(`${e.server}/${e.tool}`)
    return { value: { isError: false, content: [{ type: 'text', text: '{"totalPositive":2,"totalNegative":3}' }] } }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'usage-bar-refresh', args: '', origin: { kind: 'human' }, presentation: 'text' } as any)

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /ThumbGate/ }))?.text).toContain('2👍 3👎 (this machine)')
  expect(asked[0]).toBe('thumbgate/feedback_stats')
  await ui.unmount()
})

test('in a cloud session the counts come from the project copy', async ($, on) => {
  on('command.register', () => ({ value: { command: 'usage-bar-refresh' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: [] } }))
  on('clock.now', () => ({ value: 0 }))
  on('clock.every', () => ({ value: undefined }))
  on('session.info', () => ({ value: { transcriptPath: '/t.jsonl' } }))
  on('fs.read', (_, e: any) =>
    String(e.path ?? e).includes('thumbgate.json')
      ? { value: '{"up":1,"down":9,"trend":"degrading","readAt":"2026-11-27T21:30:00Z"}' }
      : { value: '' },
  )
  on('http.fetch', () => ({ value: { status: 500, ok: false, headers: {}, text: '' } }))
  on('mcp.call', () => {
    throw new Error("A mod can't call tools of MCP server 'remote-devices' in a cloud session")
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'usage-bar-refresh', args: '', origin: { kind: 'human' }, presentation: 'text' } as any)

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const tg = await ui.find({ type: 'Text', text: /ThumbGate/ })
  expect(tg?.text).toContain('1👍 9👎 (your Mac, 4:30 PM ET, degrading)')
  expect((await ui.find({ type: 'Text', text: /weekly/ }))?.text).toContain('weekly limit: no reading yet')
  await ui.unmount()
})

test('today starts at midnight Eastern', async () => {
  // 4:50 PM EST (minute and second past 24) and 12:00:30 AM EST
  expect(easternMidnight(Date.parse('2026-11-27T21:50:59Z'))).toBe(Date.parse('2026-11-27T05:00:00Z'))
  expect(easternMidnight(Date.parse('2026-11-28T05:00:30Z'))).toBe(Date.parse('2026-11-28T05:00:00Z'))
  // daylight time: 11:59 PM EDT on Jul 4
  expect(easternMidnight(Date.parse('2026-07-05T03:59:00Z'))).toBe(Date.parse('2026-07-04T04:00:00Z'))
})

function wire(on: any) {
  on('command.register', (_: unknown, e: any) => ({ value: { command: e.name } }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens: 191000, window: 1000000, percent: 19 },
      rateLimits: [{ kind: 'seven_day', percentUsed: 83, resetsAt: '2026-11-30T17:00:00Z' }],
      cost: { usd: 4.5 },
    },
  }))
  on('clock.now', () => ({ value: Date.parse('2026-11-27T21:12:39Z') }))
  on('clock.every', () => ({ value: undefined }))
  on('session.info', () => ({ value: { transcriptPath: '/p/proj/t.jsonl' } }))
  on('fs.list', (_: unknown, e: any) => ({
    value:
      String(e.path ?? e) === '/p'
        ? [{ name: 'proj', kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false }]
        : [{ name: 't.jsonl', kind: 'file', size: 10, mtimeMs: Date.parse(T), isLink: false }],
  }))
  on('fs.read', () => ({ value: transcript }))
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: '{"version":"1.50.0"}' } }))
  on('mcp.call', () => ({
    value: { isError: false, content: [{ type: 'text', text: '{"totalPositive":1,"totalNegative":9}' }] },
  }))
}

const PANE_PROPS = { title: 'Usage', isFocused: false, bodyColumns: 80, anchors: [] }
const run = (command: string, args = '') =>
  ({ command, args, origin: { kind: 'human' }, presentation: 'text' }) as any

test('/usage-pane opens a pane with cost by model, and a glance form as a desktop widget', async ($, on) => {
  wire(on)
  const opened: any[] = []
  on('ui.open', (_: unknown, e: any) => (opened.push(e), { value: { isPlaced: true } }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run(run('usage-bar-refresh'))
  await $.command.run(run('usage-pane'))
  expect(opened[0]?.id).toBe('usage')

  const pane = await $.ui.mount({
    plugin: 'usage-bar',
    surface: 'desktop',
    component: 'Pane',
    requestId: 'usage',
    props: { ...PANE_PROPS, placement: 'dock' },
  } as any)
  expect((await pane.find({ type: 'Text', text: /^Today on this machine/ }))?.text).toContain('1k tokens, $0.01 at API prices')
  expect((await pane.find({ type: 'Text', text: /Opus/ }))?.text).toMatch(/Opus +800 tokens +\$0\.01/)
  expect((await pane.find({ type: 'Text', text: /Weekly limit/ }))?.text).toContain('83%')
  await pane.unmount()

  const widget = await $.ui.mount({
    plugin: 'usage-bar',
    surface: 'desktop',
    component: 'Pane',
    requestId: 'usage',
    props: { ...PANE_PROPS, placement: 'widget' },
  } as any)
  expect((await widget.find({ type: 'Text', text: /^Today/ }))?.text).toBe('Today $0.01')
  expect((await widget.find({ type: 'Text', text: /👍/ }))?.text).toBe('1👍 9👎')
  await widget.unmount()
})

test('/usage-bar compact and off change the band, and narrow windows get one line', async ($, on) => {
  wire(on)
  const store = new Map<string, unknown>()
  on('store.get', (_: unknown, e: any) => ({ value: store.get(String(e.key ?? e)) }))
  on('store.set', (_: unknown, e: any) => (store.set(String(e.key), e.value), { value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run(run('usage-bar-refresh'))

  const narrow = await $.ui.mount({ ...BAND, surface: 'desktop', props: { ...BAND.props, bodyColumns: 60 } })
  expect((await narrow.find({ type: 'Text', text: /Today/ }))?.text).toBe(
    'Today $0.01 · 1k tokens · weekly 83% · ThumbGate 1👍 9👎',
  )
  await narrow.unmount()

  await $.command.run(run('usage-bar', 'compact'))
  const small = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await small.find({ type: 'Text', text: /Today/ }))?.text).toBe('Today $0.01 · 1k tokens · weekly 83% · ThumbGate 1👍 9👎')
  await small.unmount()

  await $.command.run(run('usage-bar', 'off'))
  const off = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await off.find({ type: 'Text', text: /Today/ })).toBeFalsy()
  await off.unmount()
})
