import { test, expect, type BrowserContext } from '@playwright/test';
import { DEFAULT_DIMENSIONS } from '../lib/types/profile';
const stamp = '2026-11-26T01:00:00.000Z';
function history(id: string, title: string, nodeTitle: string) {
  return { id, revision: 1, deletedAt: null as string | null, snapshot: {
    session: { id, profileId: 'profile', title, goal: title, status: 'active', createdAt: stamp, updatedAt: stamp, cloudVersion: 1 },
    path: { id, userId: 'history-browser', goal: title, nodes: [{ id: `node-${id}`, title: nodeTitle, knowledgePoints: [nodeTitle], resources: [], estimatedMinutes: 15, prerequisites: [], status: 'in_progress' }], edges: [], estimatedDays: 1, status: 'active', createdAt: stamp, updatedAt: stamp },
    resources: [], tutorMessages: [], decisions: { logs: [], overrides: {}, feedback: [] },
  } };
}
test('two isolated devices switch/reload learning paths and propagate deletion', async ({ browser }) => {
  test.setTimeout(120_000);
  const records = [history('one', '学习甲', '甲节点'), history('two', '学习乙', '乙节点')];
  const profile = { id: 'profile', userId: 'history-browser', version: 1, dimensions: DEFAULT_DIMENSIONS, updatedAt: stamp, conversationHistory: [] };
  const devices: BrowserContext[] = [];
  async function device() {
    const context = await browser.newContext(); devices.push(context);
    await context.route('**/api/v1/**', async route => {
      const request = route.request(); const url = new URL(request.url()); const path = url.pathname;
      if (path.endsWith('/auth/status')) return route.fulfill({ json: { success: true, data: { mode: 'multi', user: { id: 'history-browser', username: 'History', role: 'user' }, token: 'test-token', hasProfile: true } } });
      if (path.endsWith('/learning-history')) {
        if (request.method() === 'DELETE') { const record = records.find(r => r.id === url.searchParams.get('id')); if (record) record.deletedAt = stamp; return route.fulfill({ json: { success: true, data: { deleted: true } } }); }
        if (request.method() === 'PUT') { const body = request.postDataJSON(); const record = records.find(r => r.id === body.snapshot.session.id); if (record) { record.snapshot = body.snapshot; record.revision++; } return route.fulfill({ json: { success: true, data: { revision: record?.revision ?? 1 } } }); }
        return route.fulfill({ json: { success: true, data: records } });
      }
      if (path.endsWith('/history/profile')) return route.fulfill({ json: { success: true, data: { revision: 1, canonicalVersion: 1, payload: { profile, archivedProfiles: {}, profileHistory: [] } } } });
      if (path.endsWith('/smartlearn/profile')) return route.fulfill({ json: { profile, analytics: { weakTopics: [] }, recentSessions: [] } });
      if (path.endsWith('/settings')) return route.fulfill({ json: { success: true, data: { revision: 0, pptMaxPages: null, enablePptInteractive: true, enablePptQuiz: true } } });
      return route.fulfill({ json: { success: true, data: [] } });
    });
    const page = await context.newPage();
    await page.addInitScript(() => { localStorage.setItem('learning-sessions-storage', JSON.stringify({ state: { sessions: [{ id: 'legacy', title: '旧本机记录' }] } })); });
    await page.goto('/smartlearn');
    await expect(page.getByRole('combobox', { name: '学习历史' })).toBeVisible();
    return page;
  }
  try {
    const a = await device(), b = await device();
    await expect(a.getByRole('combobox', { name: '学习历史' }).locator('option')).toHaveCount(3);
    await a.getByRole('combobox', { name: '学习历史' }).selectOption('two');
    await expect(a.getByRole('combobox', { name: '学习历史' })).toHaveValue('two');
    await expect(a.getByRole('heading', { name: '当前节点：乙节点', exact: true })).toBeVisible();
    await expect(a.getByRole('heading', { name: '当前节点：甲节点', exact: true })).toHaveCount(0);
    await expect(b.getByRole('heading', { name: '当前节点：甲节点', exact: true })).toBeVisible();
    await a.getByRole('combobox', { name: '学习历史' }).selectOption('');
    await a.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(a.getByRole('combobox', { name: '学习历史' })).toHaveValue('');
    await a.getByRole('combobox', { name: '学习历史' }).selectOption('two');
    await expect(a.getByRole('combobox', { name: '学习历史' })).toHaveValue('two');
    records[0].snapshot.path.nodes[0].title = '甲节点已更新'; records[0].revision++;
    await b.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(b.getByRole('heading', { name: '当前节点：甲节点已更新', exact: true })).toBeVisible();
    a.once('dialog', dialog => dialog.accept());
    await a.getByRole('button', { name: '删除', exact: true }).click();
    await expect.poll(() => records[1].deletedAt).not.toBeNull();
    await b.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(b.getByRole('combobox', { name: '学习历史' }).locator('option')).toHaveCount(2);
    await expect(b.getByRole('combobox', { name: '学习历史' }).locator('option[value="two"]')).toHaveCount(0);
    await b.reload();
    await expect(b.getByRole('heading', { name: '当前节点：甲节点已更新', exact: true })).toBeVisible();
    await expect(b.getByRole('combobox', { name: '学习历史' }).locator('option[value="legacy"]')).toHaveCount(0);
  } finally { for (const context of devices) await context.close(); }
});

test('AI chat loads the selected server history instead of global browser messages', async ({ page }) => {
  test.setTimeout(90_000);
  const sessions = ['a', 'b'].map(id => ({ id, title: `历史 ${id}`, mode: 'chat', revision: 0, status: 'active', createdAt: stamp, updatedAt: stamp }));
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url()); const path = url.pathname;
    if (path.endsWith('/auth/status')) return route.fulfill({ json: { success: true, data: { mode: 'multi', user: { id: 'chat-browser', username: 'Chat', role: 'user' }, token: 'test-token', hasProfile: true } } });
    if (path.endsWith('/history/profile')) return route.fulfill({ json: { success: true, data: { revision: 0, canonicalVersion: 0, payload: { profile: null, archivedProfiles: {}, profileHistory: [] } } } });
    if (path.endsWith('/settings')) return route.fulfill({ json: { success: true, data: { revision: 0 } } });
    if (path.endsWith('/sessions')) return route.fulfill({ json: { success: true, data: sessions } });
    if (/\/sessions\/[^/]+$/.test(path)) {
      const id = path.split('/').at(-1); const session = sessions.find(s => s.id === id);
      return route.fulfill({ json: { success: true, data: { session, messages: [{ id: id === 'a' ? 1 : 2, role: 'assistant', content: id === 'a' ? '来自会话甲的内容' : '来自会话乙的内容', createdAt: stamp }], hasMore: false, nextBefore: null } } });
    }
    return route.fulfill({ json: { success: true, data: [] } });
  });
  await page.goto('/chat');
  await expect(page.getByText('来自会话甲的内容')).toBeVisible();
  await page.getByRole('combobox', { name: 'AI 对话历史' }).selectOption('b');
  await expect(page.getByText('来自会话乙的内容')).toBeVisible();
  await expect(page.getByText('来自会话甲的内容')).toHaveCount(0);
});


test('co-writer flushes pending edits before switching documents and leaving the page', async ({ page }) => {
  const docs = ['a', 'b'].map(id => ({ id, title: `Doc ${id}`, content: `Content ${id}`, preview: `Content ${id}`, version: 1, createdAt: stamp, updatedAt: stamp }));
  await page.route('**/api/v1/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (path.endsWith('/auth/status')) return route.fulfill({ json: { success: true, data: { mode: 'multi', user: { id: 'writer-browser', username: 'Writer', role: 'user' }, token: 'test-token', hasProfile: true } } });
    if (path.endsWith('/history/profile')) return route.fulfill({ json: { success: true, data: { revision: 0, canonicalVersion: 0, payload: { profile: null, archivedProfiles: {}, profileHistory: [] } } } });
    if (path.endsWith('/settings')) return route.fulfill({ json: { success: true, data: { revision: 0 } } });
    if (path.endsWith('/co-writer')) return route.fulfill({ json: { success: true, data: docs } });
    if (/\/co-writer\/[^/]+$/.test(path)) {
      const doc = docs.find(d => d.id === path.split('/').at(-1))!;
      if (request.method() === 'PUT') {
        const body = request.postDataJSON();
        expect(body.expectedVersion).toBe(doc.version);
        doc.content = body.content; doc.version++;
      }
      return route.fulfill({ json: { success: true, data: doc } });
    }
    return route.fulfill({ json: { success: true, data: [] } });
  });
  await page.goto('/co-writer');
  await page.getByRole('button', { name: /Doc a/ }).click();
  await expect(page.locator('textarea')).toHaveValue('Content a');
  await page.locator('textarea').fill('Edited before switching');
  await page.getByRole('button', { name: /Doc b/ }).click();
  await expect(page.locator('textarea')).toHaveValue('Content b');
  expect(docs[0].content).toBe('Edited before switching');
  await page.locator('textarea').fill('Edited before navigation');
  await page.locator('a[href="/chat"]').first().click();
  await expect.poll(() => docs[1].content).toBe('Edited before navigation');
});
