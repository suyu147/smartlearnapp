import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { config } from 'dotenv';
config({ quiet: true });
vi.mock('@/lib/deeptutor/services/auth-middleware', () => ({ withAuth: async (request: Request, handler: (request: Request, context: { user: { id: string } }) => Promise<Response>) => handler(request, { user: { id: request.headers.get('x-test-user')! } }) }));
import { NextRequest } from 'next/server';
import prisma from '@/lib/utils/database';
import { writeLearningHistory, listLearningHistory, deleteLearningHistory, HistoryConflict } from '../server';
import { saveResources, loadResources, deleteResources } from '@/lib/api/server/resource-persistence';
import { GET as getSessions, POST as createSession } from '@/app/api/v1/sessions/route';
import { GET as getSession, PUT as renameSession, DELETE as deleteChatSession } from '@/app/api/v1/sessions/[id]/route';
import { PUT as putProfile, GET as getProfile } from '@/app/api/v1/history/profile/route';
import { PUT as putSettings, GET as getSettings } from '@/app/api/v1/settings/route';
import { POST as submitQuiz } from '@/app/api/v1/quiz-attempts/route';
import { NotebookServiceImpl } from '@/lib/deeptutor/services/notebook';
import { GET as listMobileNotebooks } from '@/app/api/v1/mobile/notebooks/route';
import { GET as getMobileNotebook, PUT as saveMobileNote } from '@/app/api/v1/mobile/notebooks/[id]/route';
import { DELETE as deleteMobileNote } from '@/app/api/v1/mobile/notebooks/[id]/records/[recordId]/route';
import { GET as getWebNotebook } from '@/app/api/v1/notebook/[id]/route';
import { GET as listCareerResumes, POST as uploadCareerResume } from '@/app/api/v1/career/resumes/route';
import { GET as getCareerTask } from '@/app/api/v1/career/tasks/[taskId]/route';
import { PUT as confirmCareerResume } from '@/app/api/v1/career/resumes/[resumeId]/confirmation/route';
import { DELETE as deleteCareerResume } from '@/app/api/v1/career/resumes/[resumeId]/route';
import { POST as matchCareerResume } from '@/app/api/v1/career/matching/manual/route';
import { resetTokenCacheForTest } from '@/lib/career/insight-proxy';
import { CowriterDbService } from '@/lib/deeptutor/services/cowriter-db-service';
import { ensureSession, addMessage } from '@/lib/deeptutor/services/session';
import { mutateBook } from '../book-mutation';
import { DEFAULT_DIMENSIONS } from '@/lib/types/profile';
import type { LearningHistorySnapshot } from '../types';
const enabled = process.env.HISTORY_INTEGRATION === '1';
const a = `history-test-${crypto.randomUUID()}`, b = `history-test-${crypto.randomUUID()}`;
const stamp = new Date().toISOString();
function req(path: string, user = a, method = 'GET', body?: unknown, extra?: Record<string, string>) { return new NextRequest(`http://localhost${path}`, { method, headers: { 'x-test-user': user, 'Content-Type': 'application/json', ...extra }, ...(body ? { body: JSON.stringify(body) } : {}) }); }
function snapshot(id = crypto.randomUUID()): LearningHistorySnapshot { return {
  session: { id, title: '学习历史', goal: '树', profileId: 'profile', status: 'active', createdAt: stamp, updatedAt: stamp, cloudVersion: 1 },
  path: { id, userId: a, goal: '树', nodes: [{ id: 'n1', title: '树', knowledgePoints: ['树'], prerequisites: [], resources: [], estimatedMinutes: 15, status: 'in_progress' }], edges: [], estimatedDays: 1, status: 'active', createdAt: stamp, updatedAt: stamp },
  resources: [{ id: crypto.randomUUID(), userId: a, type: 'ppt', title: '树的课件', content: 'slides', metadata: { pptData: [] }, status: 'ready', sourceAgent: 'ppt', createdAt: stamp }],
  tutorMessages: [{ id: 'm1', role: 'user', content: '解释一下树' }, { id: 'm2', role: 'assistant', content: '树由节点组成' }],
  decisions: { logs: [], overrides: {}, feedback: [{ nodeId: 'n1', acceptedTypes: ['ppt'], rejectedTypes: [], clickedTypes: ['ppt'], viewedTypes: ['ppt'], dwellMsByType: { ppt: 2000 }, quizScore: 80, quizCompleted: true, updatedAt: stamp }] },
}; }
describe.skipIf(!enabled)('cross-device history against PostgreSQL', () => {
  beforeAll(async () => { await prisma.user.createMany({ data: [{ id: a, name: 'Fixture A' }, { id: b, name: 'Fixture B' }] }); });
  afterAll(async () => {
    await prisma.pathNodeResource.deleteMany({ where: { path: { userId: { in: [a, b] } } } });
    await prisma.resource.deleteMany({ where: { userId: { in: [a, b] } } });
    await prisma.learningPath.deleteMany({ where: { userId: { in: [a, b] } } });
    await prisma.learningProfile.deleteMany({ where: { userId: { in: [a, b] } } });
    await prisma.user.deleteMany({ where: { id: { in: [a, b] } } });
    await prisma.$disconnect();
  });
  it('round-trips path, resources, tutor messages and feedback into device B without mixing sessions', async () => {
    const first = snapshot(), second = snapshot();
    await writeLearningHistory(a, 0, first); await writeLearningHistory(a, 0, second);
    const onB = await listLearningHistory(a);
    expect(onB.find(r => r.id === first.session.id)?.snapshot.tutorMessages).toEqual(first.tutorMessages);
    expect(onB.find(r => r.id === first.session.id)?.snapshot.decisions).toEqual(first.decisions);
    const filtered = await loadResources(a, first.session.id);
    expect(filtered.map(r => r.id)).toEqual(first.resources.map(r => r.id));
    expect(await listLearningHistory(b)).toEqual([]);
    expect(await loadResources(b, first.session.id)).toEqual([]);
  });
  it('rejects stale overwrites and stale resurrection after delete, atomically', async () => {
    const state = snapshot(); await writeLearningHistory(a, 0, state);
    const update = structuredClone(state); update.path!.nodes[0].status = 'completed';
    await writeLearningHistory(a, 1, update);
    await expect(writeLearningHistory(a, 1, state)).rejects.toBeInstanceOf(HistoryConflict);
    await expect(writeLearningHistory(b, 2, state)).rejects.toBeInstanceOf(HistoryConflict);
    await deleteLearningHistory(a, state.session.id, 2);
    await expect(writeLearningHistory(a, 0, state)).rejects.toBeInstanceOf(HistoryConflict);
    await expect(writeLearningHistory(a, 2, state)).rejects.toBeInstanceOf(HistoryConflict);
    expect(await loadResources(a, state.session.id)).toEqual([]);
  });
  it('replaces path IDs safely, supports null/deleted paths and propagates independent resource deletion', async () => {
    const state = snapshot(); await writeLearningHistory(a, 0, state);
    state.path!.id = crypto.randomUUID(); await writeLearningHistory(a, 1, state);
    state.path = null; await writeLearningHistory(a, 2, state);
    expect((await listLearningHistory(a)).find(r => r.id === state.session.id)?.snapshot.path).toBeNull();
    await deleteResources(a, [state.resources[0].id]);
    await expect(writeLearningHistory(a, 3, state)).rejects.toBeInstanceOf(HistoryConflict);
    expect((await listLearningHistory(a)).find(r => r.id === state.session.id)?.snapshot.resources).toEqual([]);
  });
  it('keeps standalone resources independent and prevents overwrites/resurrection with stale revisions', async () => {
    const resource = snapshot().resources[0];
    const [created] = await saveResources(a, [resource]);
    expect(created.sessionId).toBeNull(); expect(created.revision).toBe(1);
    const [updated] = await saveResources(a, [{ ...created, content: 'new' }]); expect(updated.revision).toBe(2);
    await expect(saveResources(a, [created])).rejects.toBeInstanceOf(HistoryConflict);
    await expect(saveResources(b, [updated])).rejects.toBeInstanceOf(HistoryConflict);
    await deleteResources(a, [created.id]);
    await expect(saveResources(a, [updated])).rejects.toBeInstanceOf(HistoryConflict);
  });
  it('loads newest chat messages in pages, supports rename and denies foreign session access', async () => {
    const create = await createSession(req('/api/v1/sessions', a, 'POST', { title: '对话' }));
    const session = (await create.json()).data;
    for (let i = 0; i < 105; i++) await addMessage(session.id, a, i % 2 ? 'assistant' : 'user', `message ${i}`, { metadata: { renderMode: 'mermaid' }, ...(i === 0 ? { attachments: [{ type: 'image', base64: 'aW1hZ2U=', mimeType: 'image/png' }] } : {}) });
    const params = { params: Promise.resolve({ id: session.id }) };
    const latest = await (await getSession(req(`/api/v1/sessions/${session.id}?limit=100`), params)).json();
    expect(latest.data.messages).toHaveLength(100); expect(latest.data.messages.at(-1).content).toBe('message 104'); expect(latest.data.hasMore).toBe(true);
    const older = await (await getSession(req(`/api/v1/sessions/${session.id}?limit=100&before=${latest.data.nextBefore}`), params)).json();
    expect(older.data.messages).toHaveLength(5); expect(older.data.messages[0].attachments[0].base64).toBe('aW1hZ2U=');
    expect((await getSession(req(`/api/v1/sessions/${session.id}`, b), params)).status).toBe(404);
    expect((await renameSession(req(`/api/v1/sessions/${session.id}`, b, 'PUT', { title: 'hijacked', expectedRevision: 0 }), params)).status).toBe(409);
    expect((await renameSession(req(`/api/v1/sessions/${session.id}`, a, 'PUT', { title: 'renamed', expectedRevision: 0 }), params)).status).toBe(200);
    expect((await deleteChatSession(req(`/api/v1/sessions/${session.id}`, a, 'DELETE'), params)).status).toBe(200);
    await expect(ensureSession(session.id, a)).rejects.toThrow();
    const list = await (await getSessions(req('/api/v1/sessions'))).json(); expect(list.data.some((s: { id: string }) => s.id === session.id)).toBe(false);
  });
  it('stores all PPT switches including null defaults and rejects stale settings', async () => {
    const put = await putSettings(req('/api/v1/settings', a, 'PUT', { expectedRevision: 0, pptMaxPages: 12, enablePptInteractive: false, enablePptQuiz: false, generatePptImages: true, maxTurns: '60' }));
    expect(put.status).toBe(200);
    const read = (await (await getSettings(req('/api/v1/settings'))).json()).data;
    expect(read).toMatchObject({ revision: 1, pptMaxPages: 12, enablePptInteractive: false, enablePptQuiz: false, generatePptImages: true, maxTurns: '60' });
    expect((await putSettings(req('/api/v1/settings', a, 'PUT', { expectedRevision: 0, pptMaxPages: 5 }))).status).toBe(409);
    expect((await putSettings(req('/api/v1/settings', a, 'PUT', { expectedRevision: 1, pptMaxPages: null }))).status).toBe(200);
    expect((await (await getSettings(req('/api/v1/settings'))).json()).data.pptMaxPages).toBeNull();
  });
  it('persists profile conversation, archives and canonical version changes without lost updates', async () => {
    const payload = { profile: { id: 'profile', userId: a, version: 1, dimensions: DEFAULT_DIMENSIONS, updatedAt: stamp, conversationHistory: [{ id: 'p1', role: 'user', content: 'I study trees' }] }, archivedProfiles: {}, profileHistory: [] };
    const first = await putProfile(req('/api/v1/history/profile', a, 'PUT', { expectedRevision: 0, expectedProfileVersion: 0, payload })); expect(first.status).toBe(200);
    const loaded = (await (await getProfile(req('/api/v1/history/profile'))).json()).data;
    expect(loaded.payload.profile.conversationHistory).toHaveLength(1); expect(loaded.payload.profileHistory).toHaveLength(1);
    expect((await putProfile(req('/api/v1/history/profile', a, 'PUT', { expectedRevision: 0, expectedProfileVersion: 0, payload }))).status).toBe(409);
    const foreign = (await (await getProfile(req('/api/v1/history/profile', b))).json()).data;
    expect(foreign.payload.profile).toBeNull();
  });
  it('updates a note in place, rejects stale editors and never revives deleted notebooks', async () => {
    const service = new NotebookServiceImpl(); const notebook = await service.createNotebook(a, 'Notes');
    const note = await service.addRecord(a, notebook.id, { title: 'Tree', type: 'note', summary: '', content: 'old', metadata: {} });
    await service.updateRecord(a, notebook.id, note.id, note.updatedAt, { content: 'new' });
    expect(await service.getRecords(a, notebook.id)).toHaveLength(1);
    await expect(service.updateRecord(a, notebook.id, note.id, note.updatedAt, { content: 'stale' })).rejects.toBeInstanceOf(HistoryConflict);
    expect(await service.getRecords(b, notebook.id)).toEqual([]);
    await service.deleteNotebook(a, notebook.id);
    await expect(service.addRecord(a, notebook.id, { title: '', type: 'note', summary: '', content: 'revive', metadata: {} })).rejects.toBeInstanceOf(HistoryConflict);
  });
  it('prevents a stale co-writer edit from replacing a newer document', async () => {
    const service = new CowriterDbService(); const doc = await service.createDocument(a, { title: 'Doc', content: 'old' });
    expect(doc).not.toBeNull();
    await service.updateDocument(doc!.id, { content: 'new' }, doc!.version);
    await expect(service.updateDocument(doc!.id, { content: 'stale' }, doc!.version)).rejects.toBeInstanceOf(HistoryConflict);
    expect((await service.getDocument(doc!.id))?.content).toBe('new');
  });
  it('reuses the shared resume parser while isolating its tasks and resumes by account', async () => {
    vi.stubEnv('CAREER_INSIGHT_BASE_URL', 'https://career.test');
    vi.stubEnv('CAREER_INSIGHT_USERNAME', 'fixture');
    vi.stubEnv('CAREER_INSIGHT_PASSWORD', 'fixture');
    resetTokenCacheForTest();
    const record = { resumeId: 'resume-1', skills: [], fileName: 'resume.txt' };
    const upstream = vi.fn(async (input: string | URL, options: RequestInit) => {
      const url = new URL(input);
      const reply = (data: unknown) => Response.json({ code: 0, data });
      switch (url.pathname) {
        case '/api/v1/auth/login': return reply({ accessToken: 'fixture-token' });
        case '/api/v1/resumes': {
          const file = (options.body as FormData).get('file') as File;
          expect(file.name).toBe('resume.txt');
          expect(await file.text()).toBe('Skills: SQL');
          return reply({ taskId: 'task-1', progress: 0 });
        }
        case '/api/v1/tasks/task-1': return reply({ status: 'completed', progress: 100, result: record });
        case '/api/v1/me/resumes': return reply({ items: [record, { resumeId: 'older-unassigned' }], total: 2 });
        case '/api/v1/resumes/resume-1/confirmation': return reply({ resumeId: record.resumeId, confirmed: true });
        case '/api/v1/matching/manual': return reply({ reportId: 'match-1' });
        case '/api/v1/me/resumes/resume-1': return reply({ resumeId: record.resumeId, deleted: true });
        default: throw new Error('Unexpected career route ' + url.pathname);
      }
    });
    vi.stubGlobal('fetch', upstream);
    const base = '/api/v1/career';
    const resumePath = base + '/resumes/resume-1';
    const resumeParams = { params: Promise.resolve({ resumeId: record.resumeId }) };
    const taskPath = base + '/tasks/task-1';
    const taskParams = { params: Promise.resolve({ taskId: 'task-1' }) };
    try {
      const form = new FormData();
      form.append('file', new File(['Skills: SQL'], 'resume.txt', { type: 'text/plain' }));
      const upload = new NextRequest('http://localhost' + base + '/resumes', {
        method: 'POST', body: form, headers: { 'x-test-user': a },
      });
      const uploaded = await uploadCareerResume(upload);
      expect(uploaded.status, await uploaded.text()).toBe(200);
      expect((await getCareerTask(req(taskPath, b), taskParams)).status).toBe(404);
      expect((await getCareerTask(req(taskPath), taskParams)).status).toBe(200);
      expect((await (await listCareerResumes(req(base + '/resumes'))).json()).data.items).toEqual([record]);
      expect((await (await listCareerResumes(req(base + '/resumes', b))).json()).data.items).toEqual([]);
      const confirmation = resumePath + '/confirmation';
      expect((await confirmCareerResume(req(confirmation, b, 'PUT', { skills: ['SQL'] }), resumeParams)).status).toBe(404);
      expect((await confirmCareerResume(req(confirmation, a, 'PUT', { skills: ['SQL'] }), resumeParams)).status).toBe(200);
      const match = { targetRoleId: 'analyst', resumeId: record.resumeId };
      expect((await matchCareerResume(req(base + '/matching/manual', b, 'POST', match))).status).toBe(404);
      expect((await matchCareerResume(req(base + '/matching/manual', a, 'POST', match))).status).toBe(200);
      expect((await deleteCareerResume(req(resumePath, a, 'DELETE'), resumeParams)).status).toBe(200);
      expect((await getCareerTask(req(taskPath), taskParams)).status).toBe(404);
    } finally {
      resetTokenCacheForTest();
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
  it('shares existing notebooks and mobile notes with the web account', async () => {
    const notebook = await new NotebookServiceImpl().createNotebook(a, 'Shared notes');
    const parent = { params: Promise.resolve({ id: notebook.id }) };
    const mobile = '/api/v1/mobile/notebooks';
    const detail = mobile + '/' + notebook.id;
    const web = '/api/v1/notebook/' + notebook.id;
    const list = await listMobileNotebooks(req(mobile));
    expect((await list.json()).data).toContainEqual(expect.objectContaining({ id: notebook.id }));
    expect((await getMobileNotebook(req(detail, b), parent)).status).toBe(404);

    const content = '    preserve Markdown indentation\n';
    const response = await saveMobileNote(req(detail, a, 'PUT', {
      title: 'App lecture', content, metadata: { source: 'document', resourceId: 'lecture-1' },
    }), parent);
    expect(response.status).toBe(200);
    const { data: note } = await response.json();
    const readOnWeb = () => getWebNotebook(req(web, a, 'GET', undefined, { 'x-user-id': a }), parent);
    expect((await (await readOnWeb()).json()).data.records).toEqual([
      expect.objectContaining({ id: note.id, content, metadata: { source: 'document', resourceId: 'lecture-1' } }),
    ]);
    const deletePath = detail + '/records/' + note.id;
    const record = { params: Promise.resolve({ id: notebook.id, recordId: note.id }) };
    expect((await deleteMobileNote(req(deletePath, b, 'DELETE'), record)).status).toBe(409);
    expect((await deleteMobileNote(req(deletePath, a, 'DELETE'), record)).status).toBe(200);
    expect((await (await readOnWeb()).json()).data.records).toEqual([]);
  });
  it('saves quiz submissions idempotently without requiring AI evaluation', async () => {
    const body = { attemptId: crypto.randomUUID(), title: 'Quiz', answers: [{ questionId: 'q1', topic: 'tree', question: 'root?', userAnswer: 'A', correctAnswer: 'B', correct: false }] };
    expect((await submitQuiz(req('/api/v1/quiz-attempts', a, 'POST', body))).status).toBe(200);
    expect((await submitQuiz(req('/api/v1/quiz-attempts', a, 'POST', body))).status).toBe(200);
    expect(await prisma.learningQuizAttempt.count({ where: { userId: a, question: 'root?' } })).toBe(1);
  });
  it('serializes book mutations and rejects stale revisions', async () => {
    const book = await prisma.book.create({ data: { userId: a, title: 'Book' } });
    const request = req('/api/v1/book/test', a, 'POST', {}, { 'x-book-revision': '0' });
    await mutateBook(request, a, book.id, async () => true);
    await expect(mutateBook(request, a, book.id, async () => true)).rejects.toBeInstanceOf(HistoryConflict);
    const stored = await prisma.book.findUniqueOrThrow({ where: { id: book.id } }); expect(stored.mutationToken).toBeNull(); expect(stored.revision).toBe(1);
  });
});
