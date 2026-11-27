import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/utils/database';
import { withAuth } from '@/lib/deeptutor/services/auth-middleware';
import { PATH_SESSION_MODE } from '@/lib/api/server/path-generation';
import type { LearningPathNode } from '@/lib/types/learning-path';
import { latestNodePractice } from '@/lib/mobile/practice';

export async function GET(req: NextRequest) {
  return withAuth(req, async (_, { user }) => {
    const offset = Math.max(0, Math.min(100_000, Math.trunc(Number(req.nextUrl.searchParams.get('offset')) || 0)));
    const sessions = await prisma.dtSession.findMany({
      where: { userId: user.id, mode: PATH_SESSION_MODE, deletedAt: null, metadata: { path: ['client'], equals: 'mobile' } },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      skip: offset,
      take: 21,
      select: { id: true, title: true, updatedAt: true, learningPaths: {
        where: { userId: user.id, deletedAt: null },
        select: { nodes: true, status: true },
        take: 1,
      } },
    });
    const items = sessions.slice(0, 20).map(session => {
      const path = session.learningPaths[0];
      const nodes = (path?.nodes ?? []) as unknown as LearningPathNode[];
      const current = nodes.find(node => node.status === 'in_progress');
      return {
        sessionId: session.id, goal: session.title, updatedAt: session.updatedAt, status: path?.status ?? 'pending',
        currentNode: current ? { id: current.id, title: current.title } : null,
        completedCount: nodes.filter(node => node.status === 'completed').length,
        nodeCount: nodes.length,
      };
    });
    const recent = items[0];
    const recentNodes = sessions[0]?.learningPaths[0]?.nodes as unknown as LearningPathNode[] | undefined;
    const node = recentNodes?.find(item => item.status === 'in_progress');
    let resume = null;
    if (req.nextUrl.searchParams.get('resume') === '1' && recent && node) {
      const candidates = node.resources.filter(resource => resource.type === 'document' || resource.type === 'quiz');
      const records = await prisma.resource.findMany({
        where: { id: { in: candidates.map(resource => resource.resourceId) }, userId: user.id, sessionId: recent.sessionId, deletedAt: null, status: 'ready' },
        select: { id: true, type: true, revision: true },
      });
      const document = records.find(record => record.type === 'document');
      const quiz = records.find(record => record.type === 'quiz');
      const latest = quiz ? await latestNodePractice(user.id, recent.sessionId, node.id, quiz.id) : null;
      resume = {
        sessionId: recent.sessionId, nodeId: node.id, document, quiz,
        attemptId: (latest?.metadata as { attemptId?: string } | null)?.attemptId ?? null,
      };
    }
    return NextResponse.json({ success: true, data: { items, resume, nextOffset: sessions.length > 20 ? offset + 20 : null } });
  });
}
