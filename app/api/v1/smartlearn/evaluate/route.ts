import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/deeptutor/services/auth-middleware';
import { getLearnerProfileService } from '@/lib/deeptutor/services/learner-profile';
import { createLearnEventWriter } from '@/lib/deeptutor/capabilities/smartlearn/event-mapper';
import { createStreamEvent } from '@/lib/deeptutor/core/types';
import { evaluateNode } from '@/lib/learning-graph/nodes/evaluate';
import type { LearningStateType } from '@/lib/learning-graph/state';
import { createSSEStream } from '@/lib/server/sse-stream';
import { pathRequestSchema, streamLearningPath } from '@/lib/api/server/path-stream';
import { findPathSession, readGeneratedPath } from '@/lib/api/server/path-generation';
import prisma from '@/lib/utils/database';

const schema = pathRequestSchema.pick({
  attemptId: true, sessionId: true, currentNodeId: true, goal: true, aiConfig: true,
}).extend({
  mode: z.enum(['quiz', 'complete-node']).default('quiz'),
  quizResults: pathRequestSchema.shape.quizResults.unwrap().min(1),
});

export async function POST(req: NextRequest) {
  return withAuth(req, async (_, { user }) => {
    const input = schema.safeParse(await req.json().catch(() => null));
    if (!input.success) return NextResponse.json({ error: '请检查测验请求参数' }, { status: 400 });
    const body = input.data;
    if (body.mode === 'complete-node') {
      const session = body.sessionId ? await findPathSession(user.id, body.sessionId) : null;
      if (!session) return NextResponse.json({ error: '找不到学习会话' }, { status: 404 });
      const path = await readGeneratedPath(user.id, session.id);
      const node = path?.nodes.find(item => item.status === 'in_progress');
      if (!node || node.id !== body.currentNodeId) {
        return NextResponse.json({ error: '请传入当前学习节点 ID' }, { status: 409 });
      }
      return streamLearningPath(req, user.id, session, path, { ...body, action: 'node_complete' });
    }
    if (body.sessionId && !await prisma.dtSession.findFirst({
      where: { id: body.sessionId, userId: user.id, deletedAt: null }, select: { id: true },
    })) return NextResponse.json({ error: '找不到学习会话' }, { status: 404 });

    const source = 'smartlearn:evaluate';
    const turnId = crypto.randomUUID();
    const sessionId = body.sessionId ?? turnId;
    const profile = await getLearnerProfileService().getProfile(user.id);
    const stream = createSSEStream(source, sessionId, async emit => {
      const result = await evaluateNode({
        action: 'quiz_result', attemptId: body.attemptId ?? turnId, sessionId, profile: profile.dimensions,
        currentNode: null, quizResults: body.quizResults, aiConfig: body.aiConfig,
      } as LearningStateType, {
        configurable: { userId: user.id, writer: createLearnEventWriter(emit, sessionId, turnId, source) },
      });
      if (result.evaluationResult) emit(createStreamEvent('done', { source, sessionId, turnId }));
    });
    return new Response(stream, { headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    } });
  });
}
