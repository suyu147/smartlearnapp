import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/utils/database';
import { withAuth } from '@/lib/deeptutor/services/auth-middleware';
import { PATH_SESSION_MODE } from '@/lib/api/server/path-generation';
import type { LearningPathNode } from '@/lib/types/learning-path';

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
      };
    });
    return NextResponse.json({ success: true, data: { items, nextOffset: sessions.length > 20 ? offset + 20 : null } });
  });
}
