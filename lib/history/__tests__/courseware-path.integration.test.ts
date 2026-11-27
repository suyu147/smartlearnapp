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
import { GET as listMobilePaths } from '@/app/api/v1/mobile/learning-paths/route';
import { GET as listMobileResources } from '@/app/api/v1/mobile/resources/route';
import { GET as getPractice } from '@/app/api/v1/mobile/practice/[resourceId]/route';
import { POST as submitPractice } from '@/app/api/v1/mobile/practice/[resourceId]/attempts/route';
import { GET as getReport } from '@/app/api/v1/mobile/practice/attempts/[attemptId]/route';
import { GET as listReview } from '@/app/api/v1/mobile/review/route';
import { GET as getReview, POST as submitReview } from '@/app/api/v1/mobile/review/[resourceId]/route';
import { GET as getBatch, POST as submitBatch } from '@/app/api/v1/mobile/review/batch/route';
import { GET as getMobileStats } from '@/app/api/v1/mobile/stats/route';
import { localDay } from '@/lib/mobile/calendar';
import { DEFAULT_DIMENSIONS } from '@/lib/types/profile';
import type { StreamEvent } from '@/lib/deeptutor/core/types';
import type { LearningPathNode } from '@/lib/types/learning-path';

const mocks = vi.hoisted(() => ({ plan: vi.fn(), stages: vi.fn(), deck: vi.fn(), generate: vi.fn(), evaluate: vi.fn() }));
vi.mock('@/lib/deeptutor/services/auth-middleware', () => ({
  withAuth: (req: Request, handler: (request: Request, ctx: { user: { id: string } }) => Promise<Response>) =>
    handler(req, { user: { id: req.headers.get('x-fixture-user')! } }),
}));
vi.mock('@/lib/deeptutor/services/learner-profile', () => ({
  getLearnerProfileService: () => ({ getProfile: async () => ({ dimensions: DEFAULT_DIMENSIONS }) }),
}));
vi.mock('@/lib/learning-graph/nodes/plan-node', () => ({ planNode: mocks.plan }));
vi.mock('@/lib/mobile/path-planner', () => ({ planMobileStages: mocks.stages }));
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

  it('shares mobile node resources and records a graded attempt once before advancing', async () => {
    const mobileNode = {
      id: 'mobile-intro', title: '导论', knowledgePoints: ['算法概览'], resources: [],
      prerequisites: [], estimatedMinutes: 20, status: 'in_progress',
    };
    mocks.plan.mockResolvedValueOnce({ currentNode: mobileNode });
    let finishQuiz!: () => void;
    const quizPending = new Promise<void>(resolve => { finishQuiz = resolve; });
    mocks.generate.mockImplementation(async (type: string) => {
      if (type === 'quiz') await quizPending;
      return { title: type, content: type === 'quiz' ? JSON.stringify([{
        type: 'choice', question: '哪项为常数时间？', options: ['按索引读数组', '遍历数组'],
        answer: '按索引读数组', explanation: '索引直接定位。', knowledgePoints: ['算法概览'],
      }]) : '讲解' };
    });
    const response = await startPath(request('smartlearn', 'POST', {
      action: 'start', client: 'mobile', goal: '学算法',
    }));
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const events: StreamEvent[] = [];
    async function readEvent() {
      const chunk = await reader.read();
      if (chunk.done) return false;
      const line = decoder.decode(chunk.value);
      if (line.startsWith('data: ')) events.push(JSON.parse(line.slice(6)));
      return true;
    }
    try {
      while (!events.some(event => event.metadata.learnEventType === 'resource_delta' &&
        (event.metadata.resource as { type?: string })?.type === 'document') && await readEvent()) {
        if (events.at(-1)?.type === 'error') throw new Error(events.at(-1)?.content);
      }
      expect(eventNames(events)).toContain('path_update');
      expect(eventNames(events)).not.toContain('practice_ready');
      expect(eventNames(events)).not.toContain('done');
      const earlySessionId = events[0].sessionId;
      const resources = (await (await listMobileResources(request('mobile/resources?sessionId=' + earlySessionId))).json()).data.resources;
      expect(resources).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'document', content: '讲解' })]));
    } finally {
      finishQuiz();
      while (await readEvent()) { /* Drain the remaining resource events. */ }
      reader.releaseLock();
    }
    const sessionId = events[0].sessionId;
    expect(events.some(event => (event.metadata.resource as { type?: string } | undefined)?.type === 'quiz')).toBe(false);
    expect(events.find(event => event.metadata.learnEventType === 'practice_ready')?.metadata.practice)
      .toMatchObject({ type: 'quiz', content: '', metadata: { nodeId: mobileNode.id } });

    const paths = (await (await listMobilePaths(request('mobile/learning-paths'))).json()).data.items;
    expect(paths).toEqual([expect.objectContaining({ sessionId, currentNode: { id: mobileNode.id, title: mobileNode.title } })]);
    const otherPaths = (await (await listMobilePaths(request('mobile/learning-paths', 'GET', undefined, other))).json()).data.items;
    expect(otherPaths).toEqual([]);
    const web = (await (await listResources(request('resources/sync?sessionId=' + sessionId))).json()).data.resources;
    expect(web).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'document', metadata: expect.objectContaining({ origin: 'learning-path', nodeId: mobileNode.id }) }),
      expect.objectContaining({ type: 'quiz', metadata: expect.objectContaining({ origin: 'learning-path', nodeId: mobileNode.id }) }),
    ]));
    const resourceId = web.find((resource: { type: string }) => resource.type === 'quiz').id;
    const resume = async () => (await (await listMobilePaths(request('mobile/learning-paths?resume=1'))).json()).data.resume;
    expect(await resume()).toMatchObject({ sessionId, nodeId: mobileNode.id, quiz: { id: resourceId, revision: 1 }, attemptId: null });
    const mobile = (await (await listMobileResources(request('mobile/resources?sessionId=' + sessionId))).json()).data.resources;
    expect(mobile.find((resource: { id: string }) => resource.id === resourceId).content).toBe('');
    const quizParams = { params: Promise.resolve({ resourceId }) };
    const practice = (await (await getPractice(request('mobile/practice'), quizParams)).json()).data;
    expect(practice.questions).toEqual([{ id: '1', type: 'choice', question: '哪项为常数时间？', options: ['按索引读数组', '遍历数组'] }]);
    expect((await getPractice(request('mobile/practice', 'GET', undefined, other), quizParams)).status).toBe(404);
    const advance = () => startPath(request('smartlearn', 'POST', {
      action: 'node_complete', sessionId, currentNodeId: mobileNode.id,
    }));
    expect((await advance()).status).toBe(409);

    const attemptId = crypto.randomUUID();
    const body = { attemptId, version: practice.version, answers: { '1': '按索引读数组' } };
    const submit = () => submitPractice(request('mobile/practice', 'POST', body), quizParams);
    const [first, second] = await Promise.all([submit(), submit()]);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual(await second.json());
    const reportParams = { params: Promise.resolve({ attemptId }) };
    const report = (await (await getReport(request('mobile/practice/attempts'), reportParams)).json()).data;
    expect(report).toMatchObject({ attemptId, score: 100, correctCount: 1, total: 1 });
    expect(await resume()).toMatchObject({ attemptId });
    expect((await getReport(request('mobile/practice/attempts', 'GET', undefined, other), reportParams)).status).toBe(404);
    expect(await prisma.learningSkillMastery.findUnique({ where: { userId_topic: { userId: owner, topic: '算法概览' } } })).toMatchObject({ reviewCount: 1 });

    mocks.plan.mockResolvedValueOnce({ currentNode: { ...mobileNode, id: 'mobile-next', prerequisites: [mobileNode.id] } });
    await streamed(await advance());
    const updated = (await (await getPath(request('smartlearn?sessionId=' + sessionId))).json()).data.path;
    expect(updated.nodes.map((node: { status: string }) => node.status)).toEqual(['completed', 'in_progress']);
    expect(await prisma.learningSkillMastery.findUnique({ where: { userId_topic: { userId: owner, topic: '算法概览' } } })).toMatchObject({ reviewCount: 1 });
  });

  it('plans mobile stages upfront, starts tasks out of order and preserves reports when replanning', async () => {
    function task(id: string, stageId: string): LearningPathNode {
      return {
        id, title: id, stage: { id: stageId, title: stageId }, resources: [], knowledgePoints: [id],
        estimatedMinutes: 30, status: 'locked', prerequisites: [],
      };
    }
    const first = task('树结构', '基础');
    const second = task('哈希结构', '基础');
    const third = task('索引设计', '应用');
    const fourth = task('综合实践', '进阶');
    mocks.stages.mockResolvedValueOnce([first, second, third, fourth]);
    mocks.generate.mockClear().mockImplementation(async (type: string) => ({
      title: type,
      content: type === 'quiz' ? JSON.stringify([{ type: 'fill', question: '写出数组第一个索引', answer: '0' }]) : '讲解',
    }));
    mocks.deck.mockRejectedValue(new Error('Fixture optional PPT disabled'));

    const events = await streamed(await startPath(request('smartlearn', 'POST', {
      action: 'start', client: 'mobile', planMode: 'staged', goal: '理解数据结构',
    })));
    expect(eventNames(events)).toContain('path_update');
    expect(eventNames(events)).toContain('done');
    expect(mocks.generate).not.toHaveBeenCalled();
    const sessionId = events[0].sessionId;
    const detail = async () => (await (await getPath(request('smartlearn?sessionId=' + sessionId))).json()).data.path as {
      status: string; nodes: LearningPathNode[];
    };
    const statuses = async () => (await detail()).nodes.map(node => node.status);
    const generate = (currentNodeId: string) =>
      retryResource(request('smartlearn/resources', 'POST', { sessionId, currentNodeId }));
    expect(await statuses()).toEqual(['available', 'available', 'locked', 'locked']);
    expect((await generate(third.id)).status).toBe(409);

    async function complete(nodeId: string, answer: string) {
      const generated = await streamed(await generate(nodeId));
      expect(eventNames(generated)).toContain('practice_ready');
      const resourceId = (await detail()).nodes.find(node => node.id === nodeId)!.resources.find(row => row.type === 'quiz')!.resourceId;
      const attemptId = crypto.randomUUID();
      const response = await submitPractice(request('mobile/practice', 'POST', {
        attemptId, version: 1, answers: { '1': answer },
      }), { params: Promise.resolve({ resourceId }) });
      expect(response.status).toBe(200);
      return attemptId;
    }

    const attemptId = await complete(second.id, '1');
    expect(await statuses()).toEqual(['available', 'completed', 'locked', 'locked']);
    expect((await generate(third.id)).status).toBe(409);
    await complete(first.id, '0');
    expect(await statuses()).toEqual(['completed', 'completed', 'available', 'locked']);
    const listed = (await (await listMobilePaths(request('mobile/learning-paths?resume=1'))).json()).data;
    expect(listed.items).toContainEqual(expect.objectContaining({ sessionId, completedCount: 2, nodeCount: 4 }));
    expect(listed.resume).toMatchObject({ sessionId, nodeId: third.id });

    expect(eventNames(await streamed(await generate(third.id)))).toContain('practice_ready');
    const started = (await detail()).nodes.find(node => node.id === third.id);
    const replacement = task('性能分析', '新阶段');
    mocks.stages.mockRejectedValueOnce(new Error('Fixture planner unavailable'));
    const failed = await streamed(await startPath(request('smartlearn', 'POST', { action: 'replan', sessionId })));
    expect(eventNames(failed)).toContain('error');
    expect((await detail()).nodes.map(node => node.id)).toEqual([first.id, second.id, third.id, fourth.id]);
    mocks.stages.mockResolvedValueOnce([replacement]);
    const replanned = await streamed(await startPath(request('smartlearn', 'POST', { action: 'replan', sessionId })));
    expect(eventNames(replanned)).toContain('path_update');
    expect((await detail()).nodes.map(node => node.id)).toEqual([first.id, second.id, third.id, replacement.id]);
    expect((await detail()).nodes.find(node => node.id === third.id)).toEqual(started);
    expect(await statuses()).toEqual(['completed', 'completed', 'in_progress', 'locked']);
    const report = (await (await getReport(request('mobile/practice/attempts'), {
      params: Promise.resolve({ attemptId }),
    })).json()).data;
    expect(report).toMatchObject({ attemptId, nodeId: second.id, score: 0 });
  });

  it('retries only wrong questions and refreshes review queues without overwriting the original report', async () => {
    const nodeId = 'review-node';
    const session = await prisma.dtSession.create({
      data: { userId: owner, title: '错题复习', mode: 'learning-path', metadata: { client: 'mobile' } },
    });
    const path = await prisma.learningPath.create({
      data: { userId: owner, sessionId: session.id, goal: '跟踪错题', nodes: [], edges: [] },
    });
    const resource = await prisma.resource.create({
      data: {
        userId: owner, sessionId: session.id, type: 'quiz', status: 'ready', title: '错题复习', sourceAgent: 'fixture',
        content: JSON.stringify([
          { type: 'choice', question: '一个变量如何声明？', options: ['let', 'return'], answer: 'let', knowledgePoints: ['变量声明'] },
          { type: 'fill', question: '数组第一个索引是？', answer: '0', knowledgePoints: ['数组索引'] },
          { type: 'fill', question: '布尔真值如何表示？', answer: 'true', knowledgePoints: ['布尔表达式'] },
        ]),
        pathNodes: { create: { pathId: path.id, nodeId } },
      },
    });
    const resourceId = resource.id;
    const version = resource.revision;
    const params = { params: Promise.resolve({ resourceId }) };
    const attemptId = crypto.randomUUID();
    const original = await submitPractice(request('mobile/practice', 'POST', {
      attemptId, version, answers: { '1': 'return', '2': '1', '3': 'true' },
    }), params);
    expect(original.status).toBe(200);
    const originalReport = (await original.json()).data;
    expect(originalReport).toMatchObject({ kind: 'practice', total: 3, correctCount: 1, score: 33 });

    const mistakes = async (query = '', user = owner) => (await (await listReview(request('mobile/review?' + query, 'GET', undefined, user))).json()).data;
    const itemsForResource = (data: { items: { resourceId: string }[] }) => data.items.filter(item => item.resourceId === resourceId);
    expect(itemsForResource(await mistakes())).toEqual(expect.arrayContaining([
      expect.objectContaining({ questionId: '1', mistakeCount: 1, canReview: true }),
      expect.objectContaining({ questionId: '2', mistakeCount: 1, canReview: true }),
    ]));
    expect(itemsForResource(await mistakes('topic=' + encodeURIComponent('数组索引')))).toHaveLength(1);
    expect((await mistakes('', other)).items).toEqual([]);

    const reportReview = 'mobile/review?reportId=' + attemptId;
    const getSelection = (suffix: string, user = owner) => getReview(request(suffix + '&version=' + version, 'GET', undefined, user), params);
    expect((await getSelection(reportReview, other)).status).toBe(404);
    const selected = (await (await getSelection(reportReview)).json()).data.questions;
    expect(selected).toEqual([
      { id: '1', type: 'choice', question: '一个变量如何声明？', options: ['let', 'return'] },
      { id: '2', type: 'fill', question: '数组第一个索引是？' },
    ]);
    expect((await getSelection('mobile/review?questionId=3')).status).toBe(404);

    const retryId = crypto.randomUUID();
    const body = { attemptId: retryId, version, answers: { '1': 'let', '2': '2' } };
    const send = () => submitReview(request(reportReview, 'POST', body), params);
    expect((await submitReview(request(reportReview, 'POST', body, other), params)).status).toBe(404);
    expect((await submitReview(request(reportReview, 'POST', { ...body, answers: { '1': 'let' } }), params)).status).toBe(400);
    const [first, retry] = await Promise.all([send(), send()]);
    expect(first.status).toBe(200);
    const result = await first.json();
    expect(result).toEqual(await retry.json());
    expect(result.data).toMatchObject({ attemptId: retryId, kind: 'review', total: 2, correctCount: 1, score: 50 });
    expect(itemsForResource(await mistakes())).toEqual([expect.objectContaining({ questionId: '2', mistakeCount: 2 })]);
    expect(await prisma.learningSkillMastery.findUnique({
      where: { userId_topic: { userId: owner, topic: '变量声明' } },
    })).toMatchObject({ reviewCount: 2 });
    const latest = (await (await getPractice(request('mobile/practice'), params)).json()).data;
    expect(latest.latestAttemptId).toBe(attemptId);
    const lookup = (id: string) => getReport(request('mobile/practice/attempts'), { params: Promise.resolve({ attemptId: id }) });
    expect((await (await lookup(attemptId)).json()).data).toEqual(originalReport);
    expect((await (await lookup(retryId)).json()).data).toEqual(result.data);

    expect(itemsForResource(await mistakes('mode=today'))).toEqual([expect.objectContaining({ questionId: '2' })]);
    await prisma.learningSkillMastery.update({
      where: { userId_topic: { userId: owner, topic: '变量声明' } },
      data: { nextReviewAt: new Date(Date.now() - 60_000) },
    });
    expect(itemsForResource(await mistakes('mode=today&tzOffset=-480'))).toMatchObject([
      { questionId: '2', pending: true }, { questionId: '1', pending: false },
    ]);
    const single = await submitReview(request('mobile/review?questionId=1', 'POST', {
      attemptId: crypto.randomUUID(), version, answers: { '1': 'let' },
    }), params);
    expect(single.status).toBe(200);
    expect(itemsForResource(await mistakes('mode=today'))).toEqual([expect.objectContaining({ questionId: '2' })]);

    await prisma.resource.update({ where: { id: resourceId }, data: { revision: { increment: 1 } } });
    expect((await getSelection(reportReview)).status).toBe(409);
    expect((await submitReview(request(reportReview, 'POST', { ...body, attemptId: crypto.randomUUID() }), params)).status).toBe(409);
    expect(await (await send()).json()).toEqual(result);
    expect(itemsForResource(await mistakes())).toEqual([expect.objectContaining({ questionId: '2', canReview: false })]);
    expect(itemsForResource(await mistakes('mode=today'))).toEqual([]);
    expect((await (await lookup(attemptId)).json()).data).toEqual(originalReport);
  });

  it('grades one review across courses and counts distinct questions in daily progress', async () => {
    const session = await prisma.dtSession.create({
      data: { userId: owner, title: '整组复习测试', mode: 'learning-path', metadata: { client: 'mobile' } },
    });
    const path = await prisma.learningPath.create({ data: {
      userId: owner, sessionId: session.id, goal: '学习复习', nodes: [], edges: [],
    } });
    const seed = async (title: string, correct: string) => {
      const quiz = await prisma.resource.create({ data: {
        userId: owner, sessionId: session.id, type: 'quiz', status: 'ready', title, sourceAgent: 'fixture',
        content: JSON.stringify([{ type: 'fill', question: title, answer: correct, knowledgePoints: [title] }]),
        pathNodes: { create: { pathId: path.id, nodeId: title } },
      } });
      const response = await submitPractice(request('mobile/practice', 'POST', {
        attemptId: crypto.randomUUID(), version: quiz.revision, answers: { '1': '错误' },
      }), { params: Promise.resolve({ resourceId: quiz.id }) });
      expect(response.status).toBe(200);
      return { resourceId: quiz.id, version: quiz.revision, questionId: '1' };
    };
    const refs = [await seed('循环', '迭代'), await seed('函数', '复用')];
    const today = async () => (await (await listReview(request('mobile/review?mode=today&tzOffset=-480'))).json()).data;
    const before = await today();
    expect(before.batch).toEqual(expect.arrayContaining(refs));
    const batchRoute = 'mobile/review/batch';
    const get = (user = owner) => getBatch(request(batchRoute + '?refs=' + encodeURIComponent(JSON.stringify(refs)), 'GET', undefined, user));
    expect((await get(other)).status).toBe(404);
    expect((await (await get()).json()).data.questions).toEqual([
      { question: '循环', type: 'fill', id: '1' }, { question: '函数', type: 'fill', id: '2' },
    ]);
    const attemptId = crypto.randomUUID();
    const body = { attemptId, refs, answers: { '1': '迭代', '2': '错误' } };
    const submit = (payload = body) => submitBatch(request(batchRoute, 'POST', payload));
    const [submitted, repeated] = await Promise.all([submit(), submit()]);
    const result = (await submitted.json()).data;
    expect(submitted.status).toBe(200);
    expect((await repeated.json()).data).toEqual(result);
    expect(result).toMatchObject({ attemptId, kind: 'batch', score: 50, total: 2 });
    expect(result.answers.map((answer: { question: string }) => answer.question)).toEqual(['循环', '函数']);
    expect((await submit({ ...body, answers: { '1': '错误', '2': '复用' } })).status).toBe(409);
    const after = await today();
    expect(after.completedToday).toBe(before.completedToday + 1);
    expect(after.total).toBe(before.total - 1);
    expect(after.items).toContainEqual(expect.objectContaining({ ...refs[1], mistakeCount: 2, lastWrongAttemptId: attemptId }));
    expect(after.items).not.toContainEqual(expect.objectContaining(refs[0]));
    expect((await getReview(request('mobile/review?version=1&questionId=1'), {
      params: Promise.resolve({ resourceId: refs[1].resourceId }),
    })).status).toBe(200);
    await prisma.resource.update({ where: { id: refs[1].resourceId }, data: { revision: { increment: 1 } } });
    expect((await get()).status).toBe(409);
    expect((await (await submit()).json()).data).toEqual(result);
  });

  it('uses the phone day boundary for practice statistics and isolates the other account', async () => {
    const topic = '统计分组';
    const today = localDay(new Date(), -480);
    await prisma.learningQuizAttempt.createMany({ data: [
      { userId: other, topic, question: '昨天', correct: true, createdAt: new Date(today.getTime() - 1) },
      { userId: other, topic, question: '今天', correct: false, createdAt: today },
    ] });
    await prisma.learningSkillMastery.create({ data: { userId: other, topic, mastery: 0.2 } });
    const response = await getMobileStats(request('mobile/stats?tzOffset=-480', 'GET', undefined, other));
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data).toMatchObject({ days: 2, answered: 2, accuracy: 50, streak: 2, accuracyChange: null, weakTopics: [{ topic, mastery: 0.2 }] });
    expect(data.daily.slice(-2).map((day: { answered: number; correct: number }) => [day.answered, day.correct])).toEqual([[1, 1], [1, 0]]);
    const ownerStats = await getMobileStats(request('mobile/stats?tzOffset=-480'));
    expect((await ownerStats.json()).data.weakTopics).not.toContainEqual(expect.objectContaining({ topic }));
  });

  it('saves mobile resources after the app disconnects from generation', async () => {
    const nodeId = 'disconnect-node';
    mocks.plan.mockResolvedValueOnce({ currentNode: {
      id: nodeId, title: '后台生成', knowledgePoints: ['缓存'], resources: [], prerequisites: [],
      estimatedMinutes: 10, status: 'in_progress',
    } });
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    mocks.generate.mockImplementation(async (type: string) => {
      await pending;
      return { title: type, content: type === 'quiz'
        ? JSON.stringify([{ type: 'fill', question: '缓存是什么？', answer: '存储' }])
        : '## 缓存' };
    });
    const controller = new AbortController();
    const input = new NextRequest('http://localhost/api/v1/smartlearn', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-fixture-user': owner },
      signal: controller.signal, body: JSON.stringify({ action: 'start', client: 'mobile', goal: '学习缓存' }),
    });
    const response = await startPath(input);
    const reader = response.body!.getReader();
    let sessionId: string;
    try {
      const first = await reader.read();
      sessionId = JSON.parse(new TextDecoder().decode(first.value).split('\n')[0].slice(6)).sessionId;
      const status = await getPath(request('smartlearn?sessionId=' + sessionId));
      expect((await status.json()).data.generating).toBe(true);
      controller.abort();
      await reader.cancel();
    } finally {
      release();
    }
    await expect.poll(async () => {
      const response = await getPath(request('smartlearn?sessionId=' + sessionId));
      const { data } = await response.json();
      return { generating: data.generating, types: data.path?.nodes[0]?.resources.map((item: { type: string }) => item.type).sort() };
    }).toEqual({ generating: false, types: expect.arrayContaining(['document', 'quiz']) });
  });
});
