import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/deeptutor/services/auth-middleware';
import prisma from '@/lib/utils/database';
import { ensureHistoryUser } from '@/lib/history/server';
import { SessionCreateSchema } from '@/lib/server/schemas';
function dto(s: { id: string; title: string; mode: string; revision: number; createdAt: Date; updatedAt: Date }) { return { ...s, status: 'active', createdAt: s.createdAt.toISOString(), updatedAt: s.updatedAt.toISOString() }; }
export async function GET(req: NextRequest) {
  return withAuth(req, async (_, { user }) => {
    const offset = Math.max(0, Number(req.nextUrl.searchParams.get('offset')) || 0);
    const limit = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 50));
    const sessions = await prisma.dtSession.findMany({ where: { userId: user.id, deletedAt: null, mode: 'chat' }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], skip: offset, take: limit });
    return NextResponse.json({ success: true, data: sessions.map(dto) });
  });
}
export async function POST(req: NextRequest) {
  return withAuth(req, async (_, { user }) => {
    const parsed = SessionCreateSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: 'Invalid session' }, { status: 400 });
    await ensureHistoryUser(user.id);
    const session = await prisma.dtSession.create({ data: { ...(parsed.data.id ? { id: parsed.data.id } : {}), userId: user.id, mode: 'chat', title: parsed.data.title ?? '新对话', capability: parsed.data.capability, metadata: parsed.data.metadata ? JSON.parse(JSON.stringify(parsed.data.metadata)) : undefined } });
    return NextResponse.json({ success: true, data: dto(session) }, { status: 201 });
  });
}
