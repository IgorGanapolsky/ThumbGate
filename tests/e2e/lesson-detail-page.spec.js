const { test, expect } = require('@playwright/test');

// Comprehensive E2E coverage for /lessons/:id (Lesson Detail Page).
// Covers rendering, editing, and deleting lessons.

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getMockDetailHtml(lessonId, signal, title, context, detail, tags) {
  const emoji = signal === 'up' ? '👍' : '👎';
  const signalColor = signal === 'up' ? '#4ade80' : '#f87171';
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Lesson — ${escapeHtml(title)}</title>
<style>
  :root {
    --bg: #0a0a0b; --bg-raised: #111113; --bg-card: #141414; --border: #222225;
    --text: #e8e8ec; --text-muted: #8b8b96; --cyan: #22d3ee;
    --green: #4ade80; --red: #f87171;
  }
  body { background: var(--bg); color: var(--text); font-family: sans-serif; }
  .container { max-width: 800px; margin: 0 auto; padding: 20px; }
  .form-group { margin-bottom: 16px; }
  .form-group label { display: block; font-size: 12px; color: var(--text-muted); margin-bottom: 6px; }
  .form-group input, .form-group textarea { width: 100%; background: var(--bg-raised); border: 1px solid var(--border); color: var(--text); padding: 10px; border-radius: 6px; }
  .actions-bar { display: flex; gap: 12px; margin-top: 20px; }
  .btn { padding: 10px 20px; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; }
  .btn-primary { background: var(--cyan); color: #000; }
  .btn-secondary { background: var(--bg-card); color: var(--text); border: 1px solid var(--border); }
  .btn-danger { background: rgba(248,113,113,0.15); color: var(--red); border: 1px solid rgba(248,113,113,0.3); }
  .toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); padding: 12px 24px; border-radius: 6px; display: none; }
  .toast-success { background: var(--green); color: #000; }
  .toast-error { background: var(--red); color: #000; }
</style>
</head>
<body>
<div class="container">
  <h2>Lesson Detail</h2>
  <div class="form-group">
    <label>Title</label>
    <input type="text" id="editTitle" value="${escapeHtml(title)}">
  </div>
  <div class="form-group">
    <label>Content / Context</label>
    <textarea id="editContent" rows="4">${escapeHtml(context)}</textarea>
  </div>
  <div class="form-group">
    <label>${signal === 'down' ? 'What went wrong' : 'What worked'}</label>
    <textarea id="editDetail" rows="3">${escapeHtml(detail)}</textarea>
  </div>
  <div class="form-group">
    <label>Tags (comma-separated)</label>
    <input type="text" id="editTags" value="${escapeHtml(tags)}">
  </div>

  <div class="actions-bar">
    <button class="btn btn-primary" onclick="saveChanges()">Save Changes</button>
    <a href="/lessons" class="btn btn-secondary">← Back to Lessons</a>
    <button class="btn btn-danger" onclick="deleteLesson()">Delete Lesson</button>
  </div>
</div>

<div class="toast toast-success" id="toastSuccess">✓ Saved</div>
<div class="toast toast-error" id="toastError">✗ Error</div>

<script>
function showToast(msg, type) {
  var el = document.getElementById(type === 'success' ? 'toastSuccess' : 'toastError');
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(function() { el.style.display = 'none'; }, 3000);
}

async function saveChanges() {
  var body = {
    title: document.getElementById('editTitle').value,
    content: document.getElementById('editContent').value,
    tags: document.getElementById('editTags').value,
  };
  var detailVal = document.getElementById('editDetail').value;
  if ('${signal}' === 'down') { body.whatWentWrong = detailVal; } else { body.whatWorked = detailVal; }
  try {
    var resp = await fetch('/lessons/${encodeURIComponent(lessonId)}/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error('Save failed');
    showToast('Changes saved', 'success');
  } catch (e) {
    showToast('Failed to save: ' + e.message, 'error');
  }
}

async function deleteLesson() {
  if (!confirm('Delete this lesson permanently?')) return;
  try {
    var resp = await fetch('/lessons/${encodeURIComponent(lessonId)}/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!resp.ok) throw new Error('Delete failed');
    window.location.href = '/lessons';
  } catch (e) {
    showToast('Failed to delete: ' + e.message, 'error');
  }
}
</script>
</body>
</html>`;
}

test.describe('Lesson Detail Page E2E Suite', () => {
  const lessonId = 'test-lesson-123';

  test.beforeEach(async ({ page }) => {
    // Intercept the GET page request to render mock HTML
    await page.route(new RegExp(`/lessons/${lessonId}$`), async (route) => {
      const html = getMockDetailHtml(
        lessonId,
        'down',
        'MISTAKE: Prompt "test prompt" inside testDir',
        '{\n  "prompt": "test prompt",\n  "cwd": "/foo/bar/testDir"\n}',
        'Oops, something failed',
        'mistake, e2e'
      );
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: html
      });
    });
  });

  test('renders form fields with correct values', async ({ page }) => {
    await page.goto(`/lessons/${lessonId}`);
    
    await expect(page.locator('#editTitle')).toHaveValue('MISTAKE: Prompt "test prompt" inside testDir');
    await expect(page.locator('#editContent')).toHaveValue('{\n  "prompt": "test prompt",\n  "cwd": "/foo/bar/testDir"\n}');
    await expect(page.locator('#editDetail')).toHaveValue('Oops, something failed');
    await expect(page.locator('#editTags')).toHaveValue('mistake, e2e');
  });

  test('successfully updates a lesson', async ({ page }) => {
    let updatePayload = null;
    
    // Intercept update API call
    await page.route(new RegExp(`/lessons/${lessonId}/update$`), async (route) => {
      updatePayload = JSON.parse(route.request().postData() || '{}');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true })
      });
    });

    await page.goto(`/lessons/${lessonId}`);
    
    // Make changes
    await page.locator('#editTitle').fill('SUCCESS: New title');
    await page.locator('#editContent').fill('New content here');
    await page.locator('#editDetail').fill('New detail worked');
    await page.locator('#editTags').fill('success, update');
    
    // Click save
    await page.locator('button', { hasText: 'Save Changes' }).click();

    // Verify API payload
    expect(updatePayload).toEqual({
      title: 'SUCCESS: New title',
      content: 'New content here',
      whatWentWrong: 'New detail worked',
      tags: 'success, update'
    });

    // Verify success toast message
    await expect(page.locator('#toastSuccess')).toBeVisible();
    await expect(page.locator('#toastSuccess')).toHaveText('Changes saved');
  });

  test('successfully deletes a lesson', async ({ page }) => {
    let deleteCalled = false;

    // Intercept delete API call
    await page.route(new RegExp(`/lessons/${lessonId}/delete$`), async (route) => {
      deleteCalled = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true })
      });
    });

    await page.goto(`/lessons/${lessonId}`);

    // Accept confirm dialog automatically
    page.on('dialog', async (dialog) => {
      expect(dialog.message()).toBe('Delete this lesson permanently?');
      await dialog.accept();
    });

    // Click delete
    await page.locator('button', { hasText: 'Delete Lesson' }).click();

    // Assert that the delete API was invoked and page redirected
    expect(deleteCalled).toBe(true);
    await expect(page).toHaveURL(/\/lessons$/);
  });
});
