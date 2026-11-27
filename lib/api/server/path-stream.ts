import type { DtSession } from '@prisma/client';
import { z } from 'zod';
import { createStreamEvent } from '@/lib/deeptutor/core/types';
import { createLearnEventWriter } from '@/lib/deeptutor/capabilities/smartlearn/event-mapper';
import { getLearnerProfileService } from '@/lib/deeptutor/services/learner-profile';
import { compileLearningGraph } from '@/lib/learning-graph/graph';
import type { LearningStateType } from '@/lib/learning-graph/state';
import type { LearnEvent } from '@/lib/learning-graph/types';
import { createLogger } from '@/lib/logger';
import { createSSEStream } from '@/lib/server/sse-stream';
import { smartLearnAiConfig } from '@/lib/server/smartlearn-input';
import type { LearningPath } from '@/lib/types/learning-path';
import { ALL_RESOURCE_TYPES, type ResourceType } from '@/lib/types/resource';
import { isMobilePath, isStagedMobilePath, mobilePracticeProgress, persistNodeRecommendation, persistNodeResource, persistPlannedNode, readGeneratedPath, readMobileStagePath, withStageProgress } from './path-generation';
import { mobileResource } from '@/lib/mobile/resources';
import { planMobileStages } from '@/lib/mobile/path-planner';
import { isStageFirstTask, nextUnlockedStageTask } from '@/lib/mobile/path-progress';

const resourceType = z.enum(ALL_RESOURCE_TYPES as [ResourceType, ...ResourceType[]]);
const identifier = z.string().min(1).max(128);
const feedback = z.object({
  nodeId: identifier,
  acceptedTypes: z.array(resourceType).optional(),
  rejectedTypes: z.array(resourceType).optional(),
  skippedTypes: z.array(resourceType).optional(),
  clickedTypes: z.array(resourceType).optional(),
  viewedTypes: z.array(resourceType).optional(),
  dwellMsByType: z.record(resourceType, z.number().nonnegative()).optional(),
  quizCompleted: z.boolean().optional(),
  quizScore: z.number().min(0).max(100).optional(),
});
const quizResult = z.object({
  questionId: z.string(), question: z.string(), knowledgePoints: z.array(z.string()),
  correct: z.boolean(), userAnswer: z.string(), correctAnswer: z.string(), difficulty: z.number().min(1).max(5),
});

export const pathRequestSchema = z.object({
  action: z.enum(['start', 'node_complete', 'quiz_result', 'tutor_chat', 'replan']),
  client: z.literal('mobile').optional(),
  planMode: z.literal('staged').optional(),
  goal: z.string().trim().min(1).max(500).optional(),
  sessionId: identifier.optional(),
  currentNodeId: identifier.nullable().optional(),
  attemptId: identifier.optional(),
  quizResults: z.array(quizResult).max(100).optional(),
  resourceFeedback: z.array(feedback).max(100).optional(),
  nodeDecisionOverrides: z.record(identifier, z.array(resourceType)).optional(),
  message: z.string().optional(),
  conversationHistory: z.array(z.object({ role: z.string(), content: z.string(), attachedResourceIds: z.array(z.string()).optional() })).optional(),
  attachedResources: z.array(z.object({ id: identifier, type: resourceType, title: z.string(), content: z.string() })).optional(),
  aiConfig: smartLearnAiConfig.optional(),
});

export const retryResourceSchema = z.object({
  sessionId: identifier,
  currentNodeId: identifier,
  resourceType: resourceType.optional(),
  ...pathRequestSchema.pick({ resourceFeedback: true, nodeDecisionOverrides: true }).shape,
  aiConfig: smartLearnAiConfig.optional(),
});

type GraphInput = Omit<z.infer<typeof pathRequestSchema>, 'action'> & {
  action: LearningStateType['action'];
  retryResourceType?: ResourceType;
  generateAllResources?: boolean;
};
type PathInput = GraphInput | (Omit<GraphInput, 'action'> & { action: 'replan' });

const mobileGeneration = new Map<string, Promise<void>>();
const generationKey = (userId: string, sessionId: string) => JSON.stringify([userId, sessionId]);
const log = createLogger('mobile-stage-resources');

export function isMobileGenerationRunning(userId: string, sessionId: string) {
  return mobileGeneration.has(generationKey(userId, sessionId));
}

function trackMobileGeneration(key: string) {
  const { promise, resolve } = Promise.withResolvers<void>();
  mobileGeneration.set(key, promise);
  return () => {
    mobileGeneration.delete(key);
    resolve();
  };
}

async function runPathGraph(
  { userId, session, signal, turnId, staged, write }: {
    userId: string; session: DtSession; signal: AbortSignal; turnId: string; staged: boolean; write?: (event: LearnEvent) => void;
  },
  path: LearningPath | null,
  body: GraphInput,
  evaluationFeedback: LearningStateType['evaluationFeedback'] = null,
) {
  const sessionId = session.id;
  const profile = await getLearnerProfileService().getProfile(userId);
  const currentNode = path?.nodes.find(node => node.id === body.currentNodeId) ?? null;
  const advancing = body.action === 'node_complete' || body.action === 'start';
  const completedNodes = (path?.nodes ?? [])
    .filter(node => node.status === 'completed' || (advancing && node.id === currentNode?.id))
    .map(node => ({ ...node, status: 'completed' as const }));
  const initialState: Partial<LearningStateType> = {
    action: body.action, mobilePath: isMobilePath(session), attemptId: body.attemptId ?? turnId, sessionId,
    goal: path?.goal ?? session.title, profile: profile.dimensions,
    completedNodes, currentNodeId: currentNode?.id ?? null, currentNodeTitle: currentNode?.title ?? null,
    currentNode, quizResults: body.quizResults ?? [], aiConfig: body.aiConfig,
    resourceFeedback: body.resourceFeedback ?? [], nodeDecisionOverrides: body.nodeDecisionOverrides ?? {},
    retryResourceType: body.retryResourceType, generateAllResources: body.generateAllResources,
    message: body.message ?? '', conversationHistory: body.conversationHistory ?? [],
    attachedResources: body.attachedResources ?? [],
    learnerSnapshot: null, resourcePlan: null, generatedResources: [],
    evaluationResult: null, evaluationScore: null, evaluationFeedback, updatedProfile: null,
  };
  await compileLearningGraph().invoke(initialState as LearningStateType, {
    configurable: {
      writer: write, sessionId, turnId, userId,
      pathPersistence: {
        path, signal,
        saveNode: (next: LearningPath) => persistPlannedNode(userId, next, session.revision),
        saveResource: (nodeId: string, resource: Parameters<typeof persistNodeResource>[3]) =>
          persistNodeResource(userId, sessionId, nodeId, resource),
        saveRecommendation: (nodeId: string, types: ResourceType[]) =>
          persistNodeRecommendation(userId, sessionId, nodeId, types),
        readPath: () => (staged ? readMobileStagePath : readGeneratedPath)(userId, sessionId),
      },
    },
  });
}

export async function generateUnlockedStageResources(userId: string, session: DtSession, finishedTaskId: string) {
  const sessionId = session.id;
  const key = generationKey(userId, sessionId);
  for (let running = mobileGeneration.get(key); running; running = mobileGeneration.get(key)) await running;
  const release = trackMobileGeneration(key);
  try {
    const path = await readMobileStagePath(userId, sessionId);
    if (!path) return;
    const task = nextUnlockedStageTask(path.nodes, finishedTaskId);
    if (!task || ALL_RESOURCE_TYPES.every(type => task.resources.some(resource => resource.type === type))) return;
    await runPathGraph({
      userId, session, signal: AbortSignal.timeout(240_000), turnId: crypto.randomUUID(), staged: true,
    }, path, { action: 'generate_resources', currentNodeId: task.id, generateAllResources: true });
  } catch (error) {
    log.error('Automatic stage resource generation failed', sessionId, error);
  } finally {
    release();
  }
}

export async function streamLearningPath(
  req: Request, userId: string, session: DtSession, path: LearningPath | null, body: PathInput,
  evaluationFeedback: LearningStateType['evaluationFeedback'] = null,
) {
  const sessionId = session.id;
  const turnId = crypto.randomUUID();
  const source = 'smartlearn';
  const mobilePath = isMobilePath(session);
  const staged = isStagedMobilePath(session);
  const tracked = mobilePath && ['start', 'node_complete', 'generate_resources', 'replan'].includes(body.action);
  const key = generationKey(userId, sessionId);
  if (tracked && mobileGeneration.has(key)) {
    return Response.json({ error: '这个课节正在生成，请稍后刷新' }, { status: 409 });
  }
  const release = tracked ? trackMobileGeneration(key) : undefined;
  const signal = tracked ? AbortSignal.timeout(240_000) : req.signal;
  const stream = createSSEStream(source, sessionId, async emit => {
    try {
      emit(createStreamEvent('session', { source, sessionId, turnId, metadata: { sessionId } }));
      const writeEvent = createLearnEventWriter(emit, sessionId, turnId, source);
      const write: typeof writeEvent = event => {
        if (mobilePath && event.type === 'resource_delta') {
          const resource = mobileResource(event.resource);
          if (!resource) return;
          if (resource.type === 'quiz') {
            emit(createStreamEvent('result', {
              source, sessionId, turnId, metadata: { learnEventType: 'practice_ready', practice: resource },
            }));
            return;
          }
          writeEvent({ ...event, resource });
          return;
        }
        writeEvent(event);
      };
      const graph = { userId, session, signal, turnId, staged, write };
      const active = path?.nodes.find(node => node.status === 'in_progress');
      if (body.action === 'replan' || (staged && body.action === 'start' && !path)) {
        write({ type: 'phase_start', phase: 'plan' });
        const profile = await getLearnerProfileService().getProfile(userId);
        const kept = (path?.nodes ?? []).filter(node =>
          node.status === 'completed' || node.status === 'in_progress' || node.resources.length > 0);
        const goal = path?.goal ?? session.title;
        const planned = await planMobileStages({ goal, kept, profile: profile.dimensions, aiConfig: body.aiConfig, signal });
        const practiced = kept.length ? await mobilePracticeProgress(userId, [sessionId]) : new Set<string>();
        const keptIds = new Set(kept.map(node => node.id));
        signal.throwIfAborted();
        const legacyStage = { id: 'existing', title: '已有学习' };
        const now = new Date().toISOString();
        const nodes = [...kept.map(node => ({ ...node, stage: node.stage ?? legacyStage })), ...planned];
        const nextPath = withStageProgress({
          id: path?.id ?? sessionId, sessionId, userId, goal, nodes,
          edges: (path?.edges ?? []).filter(edge => keptIds.has(edge.from) && keptIds.has(edge.to)),
          status: 'active', estimatedDays: Math.max(1, nodes.length),
          createdAt: path?.createdAt ?? now, updatedAt: now,
        }, practiced);
        const metadata = session.metadata as { client: string } | null;
        const saved = await persistPlannedNode(userId, nextPath, session.revision, { ...metadata, planMode: 'staged' });
        write({ type: 'path_update', path: saved });
        write({ type: 'phase_end', phase: 'plan' });
        const firstTask = saved.nodes.find(node => node.status === 'available' || node.status === 'in_progress');
        if (firstTask && isStageFirstTask(saved.nodes, firstTask) && (kept.length === 0 || !keptIds.has(firstTask.id))) {
          write({ type: 'node_ready', node: firstTask });
          await runPathGraph({ ...graph, staged: true }, saved, {
            action: 'generate_resources', currentNodeId: firstTask.id, aiConfig: body.aiConfig, generateAllResources: true,
          });
        }
      } else if (body.action === 'start' && (staged || (active && !body.currentNodeId))) {
        write({ type: 'path_update', path: path! });
      } else {
        await runPathGraph(graph, path, body, evaluationFeedback);
      }
      emit(createStreamEvent('done', { source, sessionId, turnId }));
    } finally {
      release?.();
    }
  });
  return new Response(stream, { headers: {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
  } });
}
