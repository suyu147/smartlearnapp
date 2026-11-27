import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import prisma from '@/lib/utils/database';
import { POST as startPath, GET as getPath } from '@/app/api/v1/smartlearn/route';
import { POST as retryResource } from '@/app/api/v1/smartlearn/resources/route';
import { POST as evaluate } from '@/app/api/v1/smartlearn/evaluate/route';
import { GET as listCourseware, POST as generateCourseware, DELETE as deleteCourseware } from '@/app/api/v1/smartlearn/courseware/route';
import { GET as getCourseware } from '@/app/api/v1/smartlearn/courseware/[id]/route';
import { GET as listResources, DELETE as deleteResources } from '@/app/api/v1/resources/sync/route';
import { GET as downloadPpt } from '@/app/api/v1/smartlearn/ppt/route';
import { DEFAULT_DIMENSIONS } from '@/lib/types/profile';
import type { StreamEvent } from '@/lib/deeptutor/core/types';

const mocks = vi.hoisted(() => ({ plan: vi.fn(), deck: vi.fn(), generate: vi.fn(), evaluate: vi.fn() }));
vi.mock('@/lib/deeptutor/services/auth-middleware', () => ({
  withAuth: (req: Request, handler: (request: Request, ctx: { user: { id: string } }) => Promise<Response>) =>
    handler(req, { user: { id: req.headers.get('x-fixture-user')! } }),
}));
vi.mock('@/lib/deeptutor/services/learner-profile', () => ({
  getLearnerProfileService: () => ({ getProfile: async () => ({ dimensions: DEFAULT_DIMENSIONS }) }),
}));
vi.mock('@/lib/learning-graph/nodes/plan-node', () => ({ planNode: mocks.plan }));
vi.mock('@/lib/learning-graph/helpers/resource-generators', () => ({ generateResource: mocks.generate }));
vi.mock('@/lib/learning-graph/helpers/evaluate', () => ({ evaluateQuizResults: mocks.evaluate }));
vi.mock('@/lib/generation/standard-ppt', async original => ({
  ...await original<typeof import('@/lib/generation/standard-ppt')>(),
  generateStandardPptOutline: vi.fn(), generateStandardPptDeck: mocks.deck,
}));
vi.mock('@/lib/learning-graph/helpers/ppt-generator', () => ({
  generatePptScenes: async (...args: unknown[]) => {
    const scene = { id: 'page-1', order: 0, type: 'slide', title: 'Fixture' };
    (args[5] as (scene: unknown, completed: number, total: number) => void)(scene, 1, 1);
    return [scene];
  },
}));

const owner = `courseware-${crypto.randomUUID()}`;
const other = `${owner}-other`;
function request(path: string, method = 'GET', body?: unknown, user = owner) {
  return new NextRequest(`http://localhost/api/v1/${path}`, {
    method, headers: { 'Content-Type': 'application/json', 'x-fixture-user': user },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function streamed(response: Response): Promise<StreamEvent[]> {
  expect(response.status).toBe(200);
  return (await response.text()).split('\n').filter(line => line.startsWith('data: '))
    .map(line => JSON.parse(line.slice(6)));
}
const eventNames = (events: StreamEvent[]) => events.map(event => event.metadata.learnEventType ?? event.type);

describe.skipIf(process.env.HISTORY_INTEGRATION !== '1')('courseware and paths with PostgreSQL', () => {
  beforeAll(async () => {
    await prisma.user.createMany({ data: [{ id: owner, name: owner }, { id: other, name: other }] });
  });
  afterAll(async () => {
    await prisma.pathNodeResource.deleteMany({ where: { path: { userId: owner } } });
    await prisma.resource.deleteMany({ where: { userId: owner } });
    await prisma.learningPath.deleteMany({ where: { userId: owner } });
    await prisma.learningQuizAttempt.deleteMany({ where: { userId: owner } });
    await prisma.learningMasterySession.deleteMany({ where: { userId: owner } });
    await prisma.learningSkillMastery.deleteMany({ where: { userId: owner } });
    await prisma.learningScheduleEntry.deleteMany({ where: { userId: owner } });
    await prisma.user.deleteMany({ where: { id: { in: [owner, other] } } });
    await prisma.$disconnect();
  });

  it('keeps courseware private and protects it from resource-center deletes', async () => {
    const events = await streamed(await generateCourseware(request('smartlearn/courseware', 'POST', { topic: '二叉树' })));
    expect(eventNames(events)).toEqual(['scene_ready', 'ppt_ready', 'done']);
    const { id } = events[1].metadata.courseware as { id: string };
    const params = { params: Promise.resolve({ id }) };
    const detail = `smartlearn/courseware/${id}`;
    const deletion = `smartlearn/courseware?id=${id}`;
    const history = (await (await listCourseware(request('smartlearn/courseware'))).json()).data.history;
    expect(history).toEqual([{ id, title: '二叉树', createdAt: expect.any(String) }]);
    expect((await (await listCourseware(request('smartlearn/courseware', 'GET', undefined, other))).json()).data.history).toEqual([]);
    expect((await getCourseware(request(detail, 'GET', undefined, other), params)).status).toBe(404);
    expect((await deleteCourseware(request(deletion, 'DELETE', undefined, other))).status).toBe(404);
    expect((await (await listResources(request('resources/sync'))).json()).data.resources).toEqual([]);
    await deleteResources(request(`resources/sync?ids=${id}`, 'DELETE'));
    await deleteResources(request('resources/sync', 'DELETE'));
    expect((await (await getCourseware(request(detail), params)).json()).data.scenes).toHaveLength(1);
    expect((await deleteCourseware(request(deletion, 'DELETE'))).status).toBe(200);
    expect((await getCourseware(request(detail), params)).status).toBe(404);
  });

  it('keeps successful resources, retries PPT alone, downloads it, and grades a quiz without advancing', async () => {
    mocks.plan.mockResolvedValue({
      currentNode: { id: 'fixture-node', title: '二叉树', knowledgePoints: ['二叉树'], resources: [],
        prerequisites: [], estimatedMinutes: 20, status: 'in_progress' },
    });
    mocks.generate.mockResolvedValue({ title: '二叉树', content: '测试资源' });
    mocks.deck.mockRejectedValueOnce(new Error('Fixture PPT failure')).mockResolvedValue({
      format: 'standard_pptx_v1', title: '二叉树', topic: '二叉树', style: 'professional', language: 'zh-CN',
      generatedAt: new Date().toISOString(), slides: [{ title: '二叉树', layout: 'title', bullets: [] }],
    });
    const started = await streamed(await startPath(request('smartlearn', 'POST', {
      action: 'start', goal: '树', nodeDecisionOverrides: { 'fixture-node': ['document', 'quiz', 'ppt'] },
    })));
    const sessionId = started[0].sessionId;
    expect(started.find(event => event.metadata.learnEventType === 'resource_failed')?.metadata.resourceType).toBe('ppt');
    expect(eventNames(started)).not.toContain('ppt_ready');
    const retry = () => retryResource(request('smartlearn/resources', 'POST', { sessionId, currentNodeId: 'fixture-node', resourceType: 'ppt' }));
    const retried = await streamed(await retry());
    await streamed(await retry());
    expect(mocks.generate.mock.calls.map(call => call[0]).sort()).toEqual(['document', 'quiz']);
    expect(mocks.deck).toHaveBeenCalledTimes(2);
    const ppt = retried.find(event => event.metadata.learnEventType === 'resource_delta')?.metadata.resource as { id: string };
    const download = `smartlearn/ppt?id=${ppt.id}`;
    const result = await downloadPpt(request(download));
    expect(result.status).toBe(200);
    expect(Buffer.from(await result.arrayBuffer()).subarray(0, 2).toString()).toBe('PK');
    expect((await downloadPpt(request(download, 'GET', undefined, other))).status).toBe(404);
    mocks.evaluate.mockResolvedValue({ evaluation: { strongPoints: [], weakPoints: [], suggestedFocus: [], feedback: '完成', profileUpdate: null }, score: 100, text: '' });
    const quiz = await streamed(await evaluate(request('smartlearn/evaluate', 'POST', {
      sessionId, mode: 'quiz', quizResults: [{
        questionId: 'one', question: '什么是二叉树？', knowledgePoints: ['二叉树'],
        correct: true, userAnswer: '树', correctAnswer: '树', difficulty: 1,
      }],
    })));
    expect(eventNames(quiz)).toContain('evaluation_result');
    expect(mocks.plan).toHaveBeenCalledTimes(1);
    await deleteResources(request(`resources/sync?ids=${ppt.id}`, 'DELETE'));
    expect(await prisma.pathNodeResource.count({ where: { resourceId: ppt.id } })).toBe(0);
    const path = (await (await getPath(request(`smartlearn?sessionId=${sessionId}`))).json()).data.path;
    expect(path.nodes[0].resources.map((resource: { type: string }) => resource.type).sort()).toEqual(['document', 'quiz']);
    expect(path.nodes[0].status).toBe('in_progress');
    mocks.plan.mockResolvedValueOnce({
      currentNode: { id: 'fixture-next', title: '二叉搜索树', knowledgePoints: ['二叉搜索树'], resources: [],
        prerequisites: ['fixture-node'], estimatedMinutes: 20, status: 'in_progress' },
    });
    await streamed(await startPath(request('smartlearn', 'POST', {
      action: 'node_complete', sessionId, currentNodeId: 'fixture-node',
      nodeDecisionOverrides: { 'fixture-next': ['mindmap', 'video', 'code', 'reading'] },
    })));
    const updated = (await (await getPath(request(`smartlearn?sessionId=${sessionId}`))).json()).data.path;
    expect(updated.nodes.map((node: { status: string }) => node.status)).toEqual(['completed', 'in_progress']);
    expect(updated.nodes[1].resources.map((item: { type: string }) => item.type).sort()).toEqual(['code', 'mindmap', 'reading', 'video']);
    expect(updated.edges).toEqual([{ from: 'fixture-node', to: 'fixture-next' }]);
  });
});
