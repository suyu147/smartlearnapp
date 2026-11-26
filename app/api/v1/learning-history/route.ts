import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/deeptutor/services/auth-middleware';
import { historyWriteSchema } from '@/lib/history/schemas';
import { HistoryConflict, listLearningHistory, writeLearningHistory, deleteLearningHistory } from '@/lib/history/server';
import type { LearningHistorySnapshot } from '@/lib/history/types';
const success = (data: unknown) => NextResponse.json({ success: true, data });
export async function GET(req: NextRequest) {
  return withAuth(req, async (_, { user }) => success(await listLearningHistory(user.id)));
}
export async function PUT(req: NextRequest) {
  return withAuth(req, async (_, { user }) => {
    const body = historyWriteSchema.safeParse(await req.json());
    if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
    try { return success(await writeLearningHistory(user.id, body.data.expectedRevision, body.data.snapshot as unknown as LearningHistorySnapshot)); }
    catch (err) { if (err instanceof HistoryConflict || (err as { code?: string }).code === 'P2002') return NextResponse.json({ error: err instanceof Error ? err.message : '版本冲突' }, { status: 409 }); throw err; }
  });
}
export async function DELETE(req: NextRequest) {
  return withAuth(req, async (_, { user }) => {
    const id = req.nextUrl.searchParams.get('id');
    const revision = Number(req.nextUrl.searchParams.get('revision'));
    if (!id || !Number.isInteger(revision) || revision < 1) return NextResponse.json({ error: 'id and revision required' }, { status: 400 });
    try { return success(await deleteLearningHistory(user.id, id, revision)); }
    catch (err) { if (err instanceof HistoryConflict) return NextResponse.json({ error: err.message }, { status: 409 }); throw err; }
  });
}
