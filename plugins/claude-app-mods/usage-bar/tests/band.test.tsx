import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'usage-bar',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

const transcript = [
  { type: 'assistant', message: { id: 'a', model: 'claude-opus-5-5', usage: { input_tokens: 600, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
  { type: 'assistant', message: { id: 'a', model: 'claude-opus-5-5', usage: { input_tokens: 600, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
  { type: 'assistant', message: { id: 'b', model: 'claude-haiku-5-5', usage: { input_tokens: 200, output_tokens: 0 } } },
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
  on('session.info', () => ({ value: { transcriptPath: '/t.jsonl' } }))
  on('fs.read', () => ({ value: transcript }))
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: '{"version":"1.50.0"}' } }))
  on('mcp.call', () => ({
    value: { isError: false, content: [{ type: 'text', text: '{"totalPositive":1,"totalNegative":9,"trend":"degrading"}' }] },
  }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'usage-bar-refresh', args: '', origin: { kind: 'human' }, presentation: 'text' } as any)

  for (const surface of ['desktop', 'mobile', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const top = await ui.find({ type: 'Text', text: /This thread/ })
    expect(top?.text).toContain('1k tokens')
    expect(top?.text).toContain('$4.50 at API prices')
    expect(top?.text).toContain('Opus 80% / Haiku 20%')
    const limits = await ui.find({ type: 'Text', text: /context/ })
    expect(limits?.text).toContain('context 19% (191k/1.0M)')
    expect(limits?.text).toContain('weekly limit 83%, resets Mon 12:00 PM ET')
    const tg = await ui.find({ type: 'Text', text: /ThumbGate/ })
    expect(tg?.text).toContain('ThumbGate v1.50.0 · 1👍 9👎 (this machine, degrading)')
    await ui.unmount()
  }
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

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'usage-bar-refresh', args: '', origin: { kind: 'human' }, presentation: 'text' } as any)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
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
