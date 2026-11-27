import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/deeptutor/services/auth-middleware';
import { findPathSession, isMobilePath, readGeneratedPath } from '@/lib/api/server/path-generation';
import { streamLearningPath, retryResourceSchema } from '@/lib/api/server/path-stream';
import { MOBILE_PATH_RESOURCES } from '@/lib/mobile/questions';

export async function POST(req: NextRequest) {
  return withAuth(req, async (_, { user }) => {
    const input = retryResourceSchema.safeParse(await req.json().catch(() => null));
    if (!input.success) return NextResponse.json({ error: '请检查会话 ID、节点 ID 和资源类型' }, { status: 400 });
    const { sessionId, currentNodeId, resourceType, aiConfig, resourceFeedback, nodeDecisionOverrides } = input.data;
    const session = await findPathSession(user.id, sessionId);
    if (!session) return NextResponse.json({ error: '找不到学习会话' }, { status: 404 });
    const path = await readGeneratedPath(user.id, sessionId);
    const node = path?.nodes.find(item => item.id === currentNodeId);
    if (!node) return NextResponse.json({ error: '找不到学习节点' }, { status: 404 });
    const required = isMobilePath(session) && MOBILE_PATH_RESOURCES.some(type => type === resourceType);
    if (resourceType && !required && !node.recommendedTypes?.includes(resourceType)) {
      return NextResponse.json({ error: '该类型不在节点的推荐资源中' }, { status: 409 });
    }
    return streamLearningPath(req, user.id, session, path, {
      action: 'generate_resources', currentNodeId, retryResourceType: resourceType, aiConfig,
      resourceFeedback, nodeDecisionOverrides,
    });
  });
}
