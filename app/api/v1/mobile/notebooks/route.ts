import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/deeptutor/services/auth-middleware';
import { getNotebookService } from '@/lib/deeptutor/bootstrap';

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(1000).optional(),
});

export async function GET(req: NextRequest) {
  return withAuth(req, async (_, { user }) => {
    const notebooks = await getNotebookService().listNotebooks(user.id);
    return NextResponse.json({ success: true, data: notebooks });
  });
}

export async function POST(req: NextRequest) {
  return withAuth(req, async (_, { user }) => {
    const input = createSchema.safeParse(await req.json().catch(() => null));
    if (!input.success) return NextResponse.json({ error: '请填写有效的笔记本名称' }, { status: 400 });
    const notebook = await getNotebookService().createNotebook(user.id, input.data.name, input.data.description);
    return NextResponse.json({ success: true, data: notebook }, { status: 201 });
  });
}
