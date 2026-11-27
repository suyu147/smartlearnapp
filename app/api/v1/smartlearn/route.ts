import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/deeptutor/services/auth-middleware';
import { createPathSession, findPathSession, isMobilePath, readGeneratedPath } from '@/lib/api/server/path-generation';
import { streamLearningPath, pathRequestSchema } from '@/lib/api/server/path-stream';
import { latestNodePractice } from '@/lib/mobile/practice';

export async function GET(req: NextRequest) {
  return withAuth(req, async (_, { user }) => {
    const sessionId = req.nextUrl.searchParams.get('sessionId');
    if (!sessionId) return NextResponse.json({ error: '缺少学习会话 ID' }, { status: 400 });
    const session = await findPathSession(user.id, sessionId, true);
    if (!session) return NextResponse.json({ error: '找不到学习会话' }, { status: 404 });
    const path = await readGeneratedPath(user.id, sessionId);
    return NextResponse.json({ success: true, data: { sessionId, path } });
  });
}

export async function POST(req: NextRequest) {
  return withAuth(req, async (_, { user }) => {
    const input = pathRequestSchema.safeParse(await req.json().catch(() => null));
    if (!input.success) return NextResponse.json({ error: '请检查路径请求参数' }, { status: 400 });
    const body = input.data;
    if (!body.sessionId && (body.action !== 'start' || !body.goal)) {
      return NextResponse.json({ error: '创建路径需要学习目标，继续路径需要会话 ID' }, { status: 400 });
    }
    const session = body.sessionId
      ? await findPathSession(user.id, body.sessionId)
      : await createPathSession(user.id, body.goal!, body.client === 'mobile');
    if (!session) return NextResponse.json({ error: '找不到学习会话' }, { status: 404 });
    const path = await readGeneratedPath(user.id, session.id);
    if (body.action === 'node_complete' || (body.action === 'start' && body.currentNodeId)) {
      const active = path?.nodes.find(node => node.status === 'in_progress');
      if (!active || body.currentNodeId !== active.id) {
        return NextResponse.json({ error: '请传入当前学习节点 ID' }, { status: 409 });
      }
      if (isMobilePath(session)) {
        const resourceId = active.resources.find(resource => resource.type === 'quiz')?.resourceId;
        const latest = resourceId && await latestNodePractice(user.id, session.id, active.id, resourceId);
        if (!latest) return NextResponse.json({ error: '请先提交当前节点的随堂练习' }, { status: 409 });
        return streamLearningPath(req, user.id, session, path, { ...body, action: 'node_complete', quizResults: [] },
          latest.evaluation as { weakPoints: string[]; strongPoints: string[]; suggestedFocus: string[] });
      }
    }
    if (isMobilePath(session) && body.action === 'quiz_result') {
      return NextResponse.json({ error: '请通过 App 随堂练习接口提交' }, { status: 400 });
    }
    return streamLearningPath(req, user.id, session, path, body);
  });
}
