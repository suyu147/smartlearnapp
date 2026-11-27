import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/deeptutor/services/auth-middleware';
import { COURSEWARE_SOURCE, type Resource } from '@/lib/types/resource';
import prisma from '@/lib/utils/database';

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  return withAuth(req, async (_, { user }) => {
    const { id } = await context.params;
    const record = await prisma.resource.findFirst({
      where: { id, userId: user.id, type: 'ppt', sourceAgent: COURSEWARE_SOURCE, sessionId: null, deletedAt: null, status: 'ready' },
      select: { id: true, title: true, createdAt: true, metadata: true },
    });
    const metadata = record?.metadata as Resource['metadata'];
    if (!record || !Array.isArray(metadata?.coursewareData)) {
      return NextResponse.json({ error: '找不到课件' }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: {
      id, title: record.title, createdAt: record.createdAt, scenes: metadata.coursewareData, options: metadata.options,
    } });
  });
}
