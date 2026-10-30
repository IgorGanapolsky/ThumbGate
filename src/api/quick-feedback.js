const crypto = require('node:crypto');
const { buildFeedbackSourceIdentity } = require('../../scripts/feedback-loop');

const REASONS = {
  up: [
    ['solved-task', 'Solved my task'], ['followed-instructions', 'Followed my instructions'],
    ['output-quality', 'Good code / output quality'], ['efficient', 'Fast and efficient'],
    ['useful-autonomy', 'Useful autonomy'], ['other', 'Other'],
  ],
  down: [
    ['unresolved-task', 'Did not solve my task'], ['missed-instructions', 'Missed my instructions'],
    ['poor-output', 'Poor code / output quality'], ['inefficient', 'Slow or inefficient'],
    ['unwanted-autonomy', 'Unwanted autonomy'], ['other', 'Other'],
  ],
};

function invalid(message) {
  throw Object.assign(new Error(message), { statusCode: 400 });
}

function normalizeQuickFeedback(body) {
  if (body.includeConversationContext !== undefined && typeof body.includeConversationContext !== 'boolean') {
    invalid('includeConversationContext must be a boolean');
  }
  if (body.reasonIds === undefined && body.submissionId === undefined) return { ...body, sourceEvent: undefined };
  const allowedFields = ['signal', 'reasonIds', 'submissionId', 'includeConversationContext', 'whatWorked', 'whatWentWrong'];
  if (Object.keys(body).some((field) => !allowedFields.includes(field))) invalid('Unexpected quick feedback field');
  const reasons = Object.hasOwn(REASONS, body.signal) ? REASONS[body.signal] : null;
  if (!reasons || !Array.isArray(body.reasonIds) || body.reasonIds.length > 6
    || body.reasonIds.some((id) => !reasons.some(([allowed]) => id === allowed))) {
    invalid('reasonIds must contain at most six reasons for the selected signal');
  }
  if (typeof body.submissionId !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(body.submissionId)) {
    invalid('submissionId must contain 16 to 100 letters, numbers, underscores or hyphens');
  }
  if (body.includeConversationContext !== false) invalid('Quick feedback must explicitly exclude conversation context');
  const detailField = body.signal === 'up' ? 'whatWorked' : 'whatWentWrong';
  const details = body[detailField] ?? '';
  if (typeof details !== 'string' || details.length > 4000) invalid('Details must be text of at most 4000 characters');
  const reasonIds = [...new Set(body.reasonIds)].sort();
  const normalized = {
    signal: body.signal,
    context: '',
    [detailField]: details.trim(),
    includeConversationContext: false,
    tags: ['quick-feedback', ...reasonIds.map((id) => `feedback-reason:${id}`)],
  };
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
  return {
    ...normalized,
    sourceEvent: buildFeedbackSourceIdentity({
      signal: body.signal,
      promptId: `${body.submissionId}:${fingerprint}`,
      source: 'quick-feedback',
    }),
  };
}

function renderQuickFeedback(signal) {
  const positive = signal === 'up';
  const chips = REASONS[signal].map(([id, label]) => `<label class="chip"><input type="checkbox" name="reason" value="${id}"><span>${label}</span></label>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><title>Share feedback | ThumbGate</title>
<style>
:root{color-scheme:dark;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#f2f5f6;background:#090d11}*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:24px}main{width:100%;max-width:580px;background:#141b22;border:1px solid #33404b;border-radius:24px;padding:32px;box-shadow:0 22px 80px #0005}.brand{color:#81e7cd;font-size:12px;font-weight:750;letter-spacing:.13em;text-transform:uppercase}.heading{display:flex;align-items:center;gap:14px;margin-top:24px}.icon{display:grid;place-items:center;background:#223c36;border-radius:16px;width:52px;height:52px;font-size:27px;flex-shrink:0}h1{font-size:27px;letter-spacing:-.035em;margin:0}p,.hint{color:#b9c5ce;font-size:14px;line-height:1.6}fieldset{border:0;padding:0;margin:26px 0}legend{font-size:14px;margin-bottom:12px}.chips{display:flex;flex-wrap:wrap;gap:9px}.chip{position:relative;cursor:pointer}.chip input{position:absolute;opacity:0;width:1px;height:1px}.chip span{display:block;border:1px solid #56636e;border-radius:999px;padding:11px 15px;font-size:14px;line-height:20px}.chip input:checked+span{background:#a5f3da;color:#10241e;border-color:#a5f3da}.chip input:checked+span:before{content:'✓ ';font-weight:bold}.chip input:focus-visible+span{outline:3px solid #e4fff6;outline-offset:4px}label.field{display:block;font-size:14px;margin:20px 0 8px}textarea,input[type=password]{display:block;width:100%;background:#0d1319;border:1px solid #56636e;border-radius:12px;color:inherit;padding:13px;font:inherit;font-size:16px}textarea{resize:vertical;min-height:108px}textarea:focus-visible,input:focus-visible,a:focus-visible,button:focus-visible{outline:3px solid #a5f3da;outline-offset:3px}.hint{font-size:12px;margin:8px 0}.actions{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:24px}a{color:#c1cdd6;text-underline-offset:4px}button{font:inherit;font-weight:700;min-height:46px;border:0;border-radius:999px;padding:12px 22px;background:#a5f3da;color:#10241e;cursor:pointer}button:disabled{opacity:.6;cursor:wait}#status{margin:16px 0 0;overflow-wrap:anywhere}#status:empty{display:none}[data-state=error] #status{color:#ffb9b9}[data-state=saved] #status{color:#a5f3da}#receipt{display:block;font-size:12px;color:#b9c5ce;overflow-wrap:anywhere;margin-top:10px}[hidden]{display:none!important}@media(max-width:480px){body{padding:16px}main{padding:24px 20px;border-radius:20px}h1{font-size:24px}.chip span{padding:10px 13px}}
</style></head><body><main data-state="idle">
<div class="brand">ThumbGate · Feedback</div>
<div class="heading"><span class="icon" aria-hidden="true">${positive ? '👍' : '👎'}</span><h1>${positive ? 'What worked well?' : 'What could be better?'}</h1></div>
<p>Your feedback helps identify what to repeat and what to improve.</p>
<form id="feedbackForm">
<fieldset><legend>Choose any that apply (optional)</legend><div class="chips">${chips}</div></fieldset>
<label class="field" for="details">Details (optional)</label><textarea id="details" maxlength="4000" placeholder="${positive ? 'What made this response useful?' : 'What went wrong, and what would help next time?'}" aria-describedby="detailsHint"></textarea>
<p class="hint" id="detailsHint">Only what you enter here is included. Conversation history is not attached.</p>
<label class="field" for="apiKey">API key</label><input id="apiKey" type="password" autocomplete="off" spellcheck="false" aria-describedby="keyHint">
<p class="hint" id="keyHint">Required if this server uses authentication. Used for this submission only.</p>
<div class="actions"><a href="/dashboard">Cancel</a><button type="submit" id="submit">Send feedback</button></div>
</form>
<p id="status" role="status" aria-live="polite" tabindex="-1"></p><span id="receipt"></span><a id="done" href="/dashboard" hidden>Back to dashboard</a>
<noscript><p>JavaScript is required to submit feedback securely. No feedback has been recorded.</p></noscript>
</main><script>
const form = document.getElementById('feedbackForm');
const card = document.querySelector('main');
const status = document.getElementById('status');
const submit = document.getElementById('submit');
const apiKey = document.getElementById('apiKey');
let state = 'idle';
let submission = null;
function setState(next, message) {
  state = next;
  card.dataset.state = next;
  submit.disabled = next === 'saving' || next === 'saved';
  for (const input of form.querySelectorAll('input, textarea')) input.disabled = next === 'saving' || next === 'saved';
  submit.textContent = next === 'saving' ? 'Saving…' : 'Send feedback';
  form.setAttribute('aria-busy', String(next === 'saving'));
  status.textContent = message;
}
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (state === 'saving' || state === 'saved') return;
  const payload = {
    signal: '${signal}',
    reasonIds: [...form.querySelectorAll('input[name=reason]:checked')].map((input) => input.value).sort(),
    ${positive ? 'whatWorked' : 'whatWentWrong'}: document.getElementById('details').value.trim(),
    includeConversationContext: false,
  };
  const fingerprint = JSON.stringify(payload);
  if (!submission || submission.fingerprint !== fingerprint) submission = { fingerprint, id: crypto.randomUUID() };
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey.value.trim()) headers.Authorization = 'Bearer ' + apiKey.value.trim();
  setState('saving', 'Saving your feedback…');
  try {
    const response = await fetch('/v1/feedback/capture', { method: 'POST', headers, body: JSON.stringify({ ...payload, submissionId: submission.id }) });
    const result = await response.json();
    const feedbackId = result.feedbackEvent && result.feedbackEvent.id;
    const saved = feedbackId && ((response.ok && result.accepted === true) || (response.status === 422 && result.signalLogged === true));
    if (!saved) {
      const message = response.status === 401 || response.status === 403
        ? 'Check your API key, then try again.'
        : 'Could not confirm that your feedback was saved. Please try again.';
      setState('error', message + ' Your choices and details are still here.');
      status.focus();
      return;
    }
    apiKey.value = '';
    form.hidden = true;
    setState('saved', response.ok && result.promoted === true ? 'Feedback saved. A reusable lesson was created.' : 'Feedback saved. No reusable lesson was created.');
    document.getElementById('receipt').textContent = 'Feedback ID: ' + feedbackId;
    document.getElementById('done').hidden = false;
    status.focus();
  } catch {
    setState('error', 'Could not confirm that your feedback was saved. Your choices and details are still here. Please try again.');
    status.focus();
  }
});
</script></body></html>`;
}

module.exports = { normalizeQuickFeedback, renderQuickFeedback };
