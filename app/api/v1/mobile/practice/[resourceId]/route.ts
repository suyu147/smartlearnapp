import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/deeptutor/services/auth-middleware';
import { findNodeQuiz, latestNodePractice } from '@/lib/mobile/practice';
import { parseMobileQuestions, publicQuestions } from '@/lib/mobile/questions';

export async function GET(req: NextRequest, { params }: { params: Promise<{ resourceId: string }> }) {
  return withAuth(req, async (_, { user }) => {
    const { resourceId } = await params;
    const linked = await findNodeQuiz(user.id, resourceId);
    if (!linked?.path.sessionId) return NextResponse.json({ error: '找不到随堂练习' }, { status: 404 });
    const { resource, nodeId } = linked;
    const sessionId = linked.path.sessionId;
    const questions = parseMobileQuestions(resource.content);
    if (!questions.length) return NextResponse.json({ error: '题目尚未准备好' }, { status: 409 });
    const latest = await latestNodePractice(user.id, sessionId, nodeId, resource.id);
    return NextResponse.json({ success: true, data: {
      resourceId, title: resource.title, version: resource.revision, pathSessionId: sessionId, nodeId,
      latestAttemptId: (latest?.metadata as { attemptId?: string } | null)?.attemptId ?? null,
      questions: publicQuestions(questions),
    } });
  });
}
