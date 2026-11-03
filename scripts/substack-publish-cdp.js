const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');

const HOME = require('os').homedir();
const postContent = fs.readFileSync(
  `${HOME}/Documents/AI-Agent-Sync/Email-Drafts/2026-10-26-substack-post-stolen-infra-patterns.md`, 'utf-8'
);

// Get Substack tab
http.get('http://localhost:9111/json/list', (res) => {
  let data = '';
  res.on('data', d => data += d);
  res.on('end', () => {
    const tabs = JSON.parse(data);
    const tab = tabs.find(t => t.url && t.url.includes('substack.com') && t.url.includes('activity'));
    if (!tab) { console.error('No Substack tab found'); process.exit(1); }
    console.log('Found Substack tab:', tab.url.slice(0, 60));

    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    let msgId = 1;
    const messages = [];

    ws.on('open', () => {
      console.log('CDP connected, enabling domains...');
      // Enable Page and Runtime
      ws.send(JSON.stringify({ id: msgId++, method: 'Page.enable' }));
      ws.send(JSON.stringify({ id: msgId++, method: 'Runtime.enable' }));

      // Navigate to Substack publish page
      setTimeout(() => {
        console.log('Navigating to Substack new post...');
        ws.send(JSON.stringify({
          id: msgId++,
          method: 'Page.navigate',
          params: { url: 'https://thumbgate.substack.com/publish' },
        }));
      }, 500);
    });

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.id) messages.push(msg);

      // Wait for navigation to complete
      if (msg.method === 'Page.loadEventFired' || msg.method === 'Page.frameStoppedLoading') {
        console.log('Page loaded, waiting for editor...');

        // Wait a bit more then try to find the editor
        setTimeout(async () => {
          console.log('Attempting to interact with editor...');
          // Try to find the title input and content area
          const titleResult = await evaluate(ws, 'document.querySelector("input[type=\\"text\\"], input[aria-label*=Title], h1")');
          console.log('Title element:', titleResult ? 'found' : 'not found');

          const contentResult = await evaluate(ws, 'document.querySelector("div[contenteditable], textarea, div.prose")');
          console.log('Content element:', contentResult ? 'found' : 'not found');

          // If we find elements, fill them
          if (titleResult && contentResult) {
            await runJS(ws, `document.querySelector("input[type=\\"text\\"], input[aria-label*=Title]").value = "How to Build a Self-Improving AI Firewall: 8 Infrastructure Patterns Stolen from Big Tech"`);
            console.log('Title filled');

            await runJS(ws, `document.querySelector("div[contenteditable], textarea, div.prose").innerHTML = '<p>${postContent.split("\\n").map(l => l.startsWith('#') ? '' : l).join('<br>').substring(0, 3000)}</p>'`);
            console.log('Content filled');

            // Find and click the "New post" button or save as draft
            await runJS(ws, `
              const btns = document.querySelectorAll('button');
              for (const b of btns) {
                const txt = b.textContent.toLowerCase();
                if (txt.includes('draft') || txt.includes('save') || txt.includes('publish')) {
                  b.click();
                  break;
                }
              }
            `);
            console.log('Clicked draft/publish button');
          }

          setTimeout(() => {
            console.log('Done. Post should be drafted.');
            ws.close();
            process.exit(0);
          }, 3000);
        }, 3000);
      }
    });

    ws.on('error', (e) => {
      console.error('WebSocket error:', e.message);
    });
  });
}).on('error', (e) => {
  console.error('HTTP error:', e.message);
});

function evaluate(ws, expression) {
  return new Promise((resolve) => {
    const id = Date.now();
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression } }));
    ws.once('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.id === id) {
        resolve(msg.result?.result?.value);
      }
    });
  });
}

function runJS(ws, code) {
  return new Promise((resolve) => {
    const id = Date.now() + 1;
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: code } }));
    ws.once('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.id === id) resolve(msg.result?.result?.value);
    });
  });
}
