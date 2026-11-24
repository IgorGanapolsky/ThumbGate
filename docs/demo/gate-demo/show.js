'use strict';
// Reads Claude Code stream-json on stdin; prints the agent's Bash calls, the tool results and the final text.
const rl = require('readline').createInterface({ input: process.stdin });
const D = '\x1b[2m', R = '\x1b[0m', RED = '\x1b[31m', GRN = '\x1b[32m';
rl.on('line', (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.type === 'assistant') {
    for (const c of m.message.content || []) {
      if (c.type === 'tool_use' && c.name === 'Bash') console.log(`${GRN}agent runs:${R} ${c.input.command}`);
      if (c.type === 'text' && c.text.trim()) { const first = c.text.trim().split('\n')[0]; console.log(`${D}agent says:${R} ${first.length > 130 ? first.slice(0, 127) + '...' : first}`); }
    }
  }
  if (m.type === 'user') {
    for (const c of (m.message.content || [])) {
      if (c.type === 'tool_result') {
        const t = (Array.isArray(c.content) ? c.content.map((x) => x.text || '').join('') : String(c.content || '')).trim();
        const lines = t.split('\n').slice(0, 5).map((l) => (l.length > 98 ? l.slice(0, 95) + '...' : l)).join('\n');
        console.log(`${c.is_error ? RED : D}result:${R} ${lines || '(no output)'}`);
      }
    }
  }
});
