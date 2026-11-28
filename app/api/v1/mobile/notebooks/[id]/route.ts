import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { HistoryConflict } from '@/lib/history/server';
import { withAuth } from '@/lib/deeptutor/services/auth-middleware';
import { getNotebookService } from '@/lib/deeptutor/bootstrap';

const recordSchema = z.object({
  recordId: z.string().min(1).optional(),
  expectedUpdatedAt: z.string().datetime().optional(),
  title: z.string().trim().max(200).optional(),
  content: z.string().refine(value => !!value.trim()),
  metadata: z.object({
    source: z.enum(['chat', 'document']),
    resourceId: z.string().max(200).optional(),
    sessionId: z.string().max(200).optional(),
    messageId: z.number().int().optional(),
  }).optional(),
}).refine(value => !value.recordId || !!value.expectedUpdatedAt);

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  return withAuth(req, async (_, { user }) => {
    const service = getNotebookService();
    const notebook = await service.getNotebook(user.id, id);
    if (!notebook) return NextResponse.json({ error: '笔记本不存在' }, { status: 404 });
    const records = await service.getRecords(user.id, id);
    return NextResponse.json({ success: true, data: { notebook, records } });
  });
}

export async function PUT(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  return withAuth(req, async (_, { user }) => {
    const input = recordSchema.safeParse(await req.json().catch(() => null));
    if (!input.success) return NextResponse.json({ error: '请填写有效的笔记标题和内容' }, { status: 400 });
    const service = getNotebookService();
    try {
      const record = input.data.recordId
        ? await service.updateRecord(user.id, id, input.data.recordId, input.data.expectedUpdatedAt ?? '', {
          title: input.data.title,
          content: input.data.content,
        })
        : await service.addRecord(user.id, id, {
          type: 'note',
          title: input.data.title || '未命名笔记',
          summary: '',
          content: input.data.content,
          metadata: input.data.metadata ?? {},
        });
      return NextResponse.json({ success: true, data: record });
    } catch (error) {
      if (error instanceof HistoryConflict) return NextResponse.json({ error: error.message }, { status: 409 });
      throw error;
    }
  });
}

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  return withAuth(req, async (_, { user }) => {
    try {
      const deleted = await getNotebookService().deleteNotebook(user.id, id);
      if (!deleted) return NextResponse.json({ error: '笔记本不存在' }, { status: 404 });
      return NextResponse.json({ success: true, data: { deleted: true } });
    } catch (error) {
      if (error instanceof HistoryConflict) return NextResponse.json({ error: error.message }, { status: 409 });
      throw error;
    }
  });
}
