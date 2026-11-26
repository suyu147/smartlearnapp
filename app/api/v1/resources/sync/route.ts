import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/deeptutor/services/auth-middleware';
import { saveResources, loadResources, deleteResources } from '@/lib/api/server/resource-persistence';
import { resourceBatchSchema } from '@/lib/history/schemas';
import { HistoryConflict } from '@/lib/history/server';
import type { Resource } from '@/lib/types/resource';
const success = (data: unknown) => NextResponse.json({ success: true, data });
export async function GET(req: NextRequest) {
  return withAuth(req, async (_, { user }) => {
    const filter = req.nextUrl.searchParams.get('sessionId');
    return success({ resources: await loadResources(user.id, filter === 'standalone' ? null : filter ?? undefined) });
  });
}
export async function POST(req: NextRequest) {
  return withAuth(req, async (_, { user }) => {
    const parsed = resourceBatchSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: 'Invalid resources' }, { status: 400 });
    try { const resources = await saveResources(user.id, parsed.data.resources as unknown as Resource[]); return success({ saved: resources.length, resources }); }
    catch (err) { if (err instanceof HistoryConflict || (err as { code?: string }).code === 'P2002') return NextResponse.json({ error: '资源已在其他设备修改或删除，请刷新' }, { status: 409 }); throw err; }
  });
}
export async function DELETE(req: NextRequest) {
  return withAuth(req, async (_, { user }) => {
    const raw = req.nextUrl.searchParams.get('ids');
    const ids = raw === null ? undefined : raw.split(',').filter(Boolean);
    return success({ deleted: await deleteResources(user.id, ids) });
  });
}
