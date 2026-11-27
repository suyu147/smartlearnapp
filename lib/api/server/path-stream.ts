import type { DtSession } from '@prisma/client';
import { z } from 'zod';
import { createStreamEvent } from '@/lib/deeptutor/core/types';
import { createLearnEventWriter } from '@/lib/deeptutor/capabilities/smartlearn/event-mapper';
import { getLearnerProfileService } from '@/lib/deeptutor/services/learner-profile';
import { compileLearningGraph } from '@/lib/learning-graph/graph';
import type { LearningStateType } from '@/lib/learning-graph/state';
import { createSSEStream } from '@/lib/server/sse-stream';
import { smartLearnAiConfig } from '@/lib/server/smartlearn-input';
import type { LearningPath } from '@/lib/types/learning-path';
import { ALL_RESOURCE_TYPES, type ResourceType } from '@/lib/types/resource';
import { isMobilePath, persistNodeRecommendation, persistNodeResource, persistPlannedNode, readGeneratedPath } from './path-generation';
import { mobileResource } from '@/lib/mobile/resources';

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
  action: z.enum(['start', 'node_complete', 'quiz_result', 'tutor_chat']),
  client: z.literal('mobile').optional(),
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

type PathInput = Omit<z.infer<typeof pathRequestSchema>, 'action'> & {
  action: LearningStateType['action'];
  retryResourceType?: ResourceType;
};

const mobileGeneration = new Set<string>();

export function isMobileGenerationRunning(userId: string, sessionId: string) {
  return mobileGeneration.has(JSON.stringify([userId, sessionId]));
}

export async function streamLearningPath(
  req: Request, userId: string, session: DtSession, path: LearningPath | null, body: PathInput,
  evaluationFeedback: LearningStateType['evaluationFeedback'] = null,
) {
  const sessionId = session.id;
  const turnId = crypto.randomUUID();
  const source = 'smartlearn';
  const mobilePath = isMobilePath(session);
  const tracked = mobilePath && ['start', 'node_complete', 'generate_resources'].includes(body.action);
  const key = JSON.stringify([userId, sessionId]);
  if (tracked && mobileGeneration.has(key)) {
    return Response.json({ error: '这个课节正在生成，请稍后刷新' }, { status: 409 });
  }
  if (tracked) mobileGeneration.add(key);
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
      const active = path?.nodes.find(node => node.status === 'in_progress');
      if (body.action === 'start' && active && !body.currentNodeId) {
        write({ type: 'path_update', path: path! });
      } else {
        const profile = await getLearnerProfileService().getProfile(userId);
        const currentNode = path?.nodes.find(node => node.id === body.currentNodeId) ?? null;
        const advancing = body.action === 'node_complete' || body.action === 'start';
        const completedNodes = (path?.nodes ?? [])
          .filter(node => node.status === 'completed' || (advancing && node.id === currentNode?.id))
          .map(node => ({ ...node, status: 'completed' as const }));
        const initialState: Partial<LearningStateType> = {
          action: body.action, mobilePath, attemptId: body.attemptId ?? turnId, sessionId,
          goal: path?.goal ?? session.title, profile: profile.dimensions,
          completedNodes, currentNodeId: currentNode?.id ?? null, currentNodeTitle: currentNode?.title ?? null,
          currentNode, quizResults: body.quizResults ?? [], aiConfig: body.aiConfig,
          resourceFeedback: body.resourceFeedback ?? [], nodeDecisionOverrides: body.nodeDecisionOverrides ?? {},
          retryResourceType: body.retryResourceType,
          message: body.message ?? '', conversationHistory: body.conversationHistory ?? [],
          attachedResources: body.attachedResources ?? [],
          learnerSnapshot: null, resourcePlan: null, generatedResources: [],
          evaluationResult: null, evaluationScore: null, evaluationFeedback, updatedProfile: null,
        };
        await compileLearningGraph().invoke(initialState as LearningStateType, {
          configurable: {
            writer: write, sessionId, turnId, userId,
            pathPersistence: {
              path,
              signal,
              saveNode: (next: LearningPath) => persistPlannedNode(userId, next, session.revision),
              saveResource: (nodeId: string, resource: Parameters<typeof persistNodeResource>[3]) =>
                persistNodeResource(userId, sessionId, nodeId, resource),
              saveRecommendation: (nodeId: string, types: ResourceType[]) =>
                persistNodeRecommendation(userId, sessionId, nodeId, types),
              readPath: () => readGeneratedPath(userId, sessionId),
            },
          },
        });
      }
      emit(createStreamEvent('done', { source, sessionId, turnId }));
    } finally {
      if (tracked) mobileGeneration.delete(key);
    }
  });
  return new Response(stream, { headers: {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
  } });
}
