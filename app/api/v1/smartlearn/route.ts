import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/deeptutor/services/auth-middleware';
import { createPathSession, findPathSession, isMobilePath, isStagedMobilePath, readGeneratedPath, readMobileStagePath } from '@/lib/api/server/path-generation';
import { isMobileGenerationRunning, streamLearningPath, pathRequestSchema } from '@/lib/api/server/path-stream';
import { latestNodePractice } from '@/lib/mobile/practice';

export async function GET(req: NextRequest) {
  return withAuth(req, async (_, { user }) => {
    const sessionId = req.nextUrl.searchParams.get('sessionId');
    if (!sessionId) return NextResponse.json({ error: '缺少学习会话 ID' }, { status: 400 });
    const session = await findPathSession(user.id, sessionId, true);
    if (!session) return NextResponse.json({ error: '找不到学习会话' }, { status: 404 });
    const staged = isStagedMobilePath(session);
    const path = await (staged ? readMobileStagePath : readGeneratedPath)(user.id, sessionId);
    return NextResponse.json({ success: true, data: {
      sessionId, path, ...(isMobilePath(session) ? { staged, generating: isMobileGenerationRunning(user.id, sessionId) } : {}),
    } });
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
      : await createPathSession(user.id, body.goal!, body.client === 'mobile', body.planMode === 'staged');
    if (!session) return NextResponse.json({ error: '找不到学习会话' }, { status: 404 });
    const staged = isStagedMobilePath(session);
    const path = await (staged ? readMobileStagePath : readGeneratedPath)(user.id, session.id);
    if (body.action === 'replan' && !isMobilePath(session)) {
      return NextResponse.json({ error: '此学习路径不支持重新规划' }, { status: 409 });
    }
    if (staged && (body.action === 'node_complete' || (body.action === 'start' && body.currentNodeId))) {
      return NextResponse.json({ error: '任务会在提交随堂练习后自动完成' }, { status: 409 });
    }
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
