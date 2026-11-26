import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/deeptutor/services/auth-middleware';
import prisma from '@/lib/utils/database';
import { z } from 'zod';
type Params = { params: Promise<{ id: string }> };
const missing = () => NextResponse.json({ error: 'Session not found' }, { status: 404 });
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  return withAuth(req, async (_, { user }) => {
    const session = await prisma.dtSession.findFirst({ where: { id, userId: user.id, deletedAt: null } });
    if (!session) return missing();
    const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 100));
    const before = Number(req.nextUrl.searchParams.get('before')) || undefined;
    const messages = req.nextUrl.searchParams.get('messages') === 'false' ? [] : await prisma.dtMessage.findMany({ where: { sessionId: id, userId: user.id, ...(before ? { id: { lt: before } } : {}) }, orderBy: { id: 'desc' }, take: limit + 1 });
    const hasMore = messages.length > limit;
    const page = messages.slice(0, limit).reverse();
    return NextResponse.json({ success: true, data: { session, messages: page, hasMore, nextBefore: hasMore ? page[0]?.id : null } });
  });
}
export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  return withAuth(req, async (_, { user }) => {
    const body = z.object({ title: z.string().trim().min(1).max(500), expectedRevision: z.number().int().nonnegative() }).safeParse(await req.json());
    if (!body.success) return NextResponse.json({ error: 'title and expectedRevision required' }, { status: 400 });
    const result = await prisma.dtSession.updateMany({ where: { id, userId: user.id, deletedAt: null, revision: body.data.expectedRevision }, data: { title: body.data.title, revision: { increment: 1 } } });
    if (!result.count) return NextResponse.json({ error: '会话已更新或删除，请刷新' }, { status: 409 });
    return NextResponse.json({ success: true, data: { revision: body.data.expectedRevision + 1 } });
  });
}
export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  return withAuth(req, async (_, { user }) => {
    const result = await prisma.dtSession.updateMany({ where: { id, userId: user.id, mode: 'chat', deletedAt: null }, data: { deletedAt: new Date(), revision: { increment: 1 } } });
    return result.count ? NextResponse.json({ success: true, data: { deleted: true } }) : missing();
  });
}
