import { NextRequest, NextResponse } from 'next/server';
import { HistoryConflict } from '@/lib/history/server';
import { withAuth } from '@/lib/deeptutor/services/auth-middleware';
import { getNotebookService } from '@/lib/deeptutor/bootstrap';

type RouteContext = { params: Promise<{ id: string; recordId: string }> };

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  const { id, recordId } = await params;
  return withAuth(req, async (_, { user }) => {
    try {
      const deleted = await getNotebookService().deleteRecord(user.id, id, recordId);
      if (!deleted) return NextResponse.json({ error: '笔记不存在' }, { status: 404 });
      return NextResponse.json({ success: true, data: { deleted: true } });
    } catch (error) {
      if (error instanceof HistoryConflict) return NextResponse.json({ error: error.message }, { status: 409 });
      throw error;
    }
  });
}
