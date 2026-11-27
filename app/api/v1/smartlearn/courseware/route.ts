import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/deeptutor/services/auth-middleware';
import { createStreamEvent } from '@/lib/deeptutor/core/types';
import { generatePptScenes } from '@/lib/learning-graph/helpers/ppt-generator';
import { saveResources } from '@/lib/api/server/resource-persistence';
import { smartLearnAiConfig } from '@/lib/server/smartlearn-input';
import { createSSEStream } from '@/lib/server/sse-stream';
import { COURSEWARE_SOURCE } from '@/lib/types/resource';
import prisma from '@/lib/utils/database';

const schema = z.object({
  topic: z.string().trim().min(1).max(200),
  options: z.object({
    maxPages: z.number().int().min(1).max(30).optional(),
    generateImages: z.boolean().default(false),
    includeInteractive: z.boolean().default(true),
    includeQuiz: z.boolean().default(true),
  }).default({}),
  aiConfig: smartLearnAiConfig.optional(),
});

export function GET(req: NextRequest) {
  return withAuth(req, async (_, { user }) => {
    const history = await prisma.resource.findMany({
      where: { userId: user.id, type: 'ppt', sourceAgent: COURSEWARE_SOURCE, sessionId: null, deletedAt: null, status: 'ready' },
      select: { id: true, title: true, createdAt: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return NextResponse.json({ success: true, data: { history } });
  });
}

export function POST(req: NextRequest) {
  return withAuth(req, async (_, { user }) => {
    const input = schema.safeParse(await req.json().catch(() => null));
    if (!input.success) return NextResponse.json({ error: '请检查主题和课件设置' }, { status: 400 });
    const { topic, options, aiConfig } = input.data;
    const id = crypto.randomUUID();
    const stream = createSSEStream(COURSEWARE_SOURCE, id, async (emit) => {
      const event = (type: 'progress' | 'result' | 'done', metadata: Record<string, unknown>) =>
        emit(createStreamEvent(type, { source: COURSEWARE_SOURCE, turnId: id, metadata }));
      const scenes = await generatePptScenes(
        topic, aiConfig, options, [topic],
        (message) => event('progress', { message }),
        (scene, completed, total) => event('result', { learnEventType: 'scene_ready', scene, completed, total }),
      );
      if (!scenes.length) throw new Error('课件生成失败，请重试');
      const [resource] = await saveResources(user.id, [{
        id, userId: user.id, title: topic, content: '动态课件',
        type: 'ppt', sourceAgent: COURSEWARE_SOURCE, status: 'ready',
        createdAt: new Date().toISOString(),
        metadata: { knowledgePoints: [topic], coursewareData: scenes, options },
      }]);
      event('result', {
        learnEventType: 'ppt_ready', scenes,
        courseware: { id, title: resource.title, createdAt: resource.createdAt },
      });
      event('done', { id });
    });
    return new Response(stream, { headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    } });
  });
}

export function DELETE(req: NextRequest) {
  return withAuth(req, async (_, { user }) => {
    const id = req.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: '缺少课件 ID' }, { status: 400 });
    const deleted = await prisma.resource.updateMany({
      where: { id, userId: user.id, type: 'ppt', sourceAgent: COURSEWARE_SOURCE, sessionId: null, deletedAt: null },
      data: { deletedAt: new Date(), revision: { increment: 1 } },
    });
    if (!deleted.count) return NextResponse.json({ error: '找不到课件' }, { status: 404 });
    return NextResponse.json({ success: true, data: { deleted: true } });
  });
}
