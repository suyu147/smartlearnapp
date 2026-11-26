import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/deeptutor/services/auth-middleware';
import prisma from '@/lib/utils/database';
import { ensureHistoryUser } from '@/lib/history/server';
import { z } from 'zod';
import type { ProfileHistoryPayload } from '@/lib/history/types';
const schema = z.object({ expectedRevision: z.number().int().nonnegative(), expectedProfileVersion: z.number().int().nonnegative(), payload: z.object({ profile: z.record(z.unknown()).nullable(), archivedProfiles: z.record(z.record(z.unknown())), profileHistory: z.array(z.record(z.unknown())) }) });
const conflict = () => NextResponse.json({ error: '画像历史已在其他设备更新，请刷新' }, { status: 409 });
export async function GET(req: NextRequest) {
  return withAuth(req, async (_, { user }) => {
    const [record, canonical, versions] = await Promise.all([
      prisma.userHistoryDocument.findUnique({ where: { userId_key: { userId: user.id, key: 'profile' } } }),
      prisma.learningProfile.findUnique({ where: { userId: user.id } }),
      prisma.userHistoryDocument.findMany({ where: { userId: user.id, key: { startsWith: 'profile-version:' } }, orderBy: { updatedAt: 'asc' } }),
    ]);
    const payload = (record?.payload ?? { profile: null, archivedProfiles: {}, profileHistory: [] }) as unknown as ProfileHistoryPayload;
    if (canonical) payload.profile = { ...payload.profile, id: canonical.id, userId: user.id, version: canonical.version, dimensions: canonical.dimensions, updatedAt: canonical.updatedAt.toISOString(), conversationHistory: payload.profile?.conversationHistory ?? [] } as unknown as ProfileHistoryPayload['profile'];
    payload.profileHistory = versions.map(version => version.payload as unknown as ProfileHistoryPayload['profileHistory'][number]);
    return NextResponse.json({ success: true, data: { revision: record?.revision ?? 0, canonicalVersion: canonical?.version ?? 0, payload } });
  });
}
export async function PUT(req: NextRequest) {
  return withAuth(req, async (_, { user }) => {
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: 'Invalid profile history' }, { status: 400 });
    await ensureHistoryUser(user.id);
    const { expectedRevision, expectedProfileVersion, payload } = parsed.data;
    const revision = expectedRevision + 1;
    try {
      const result = await prisma.$transaction(async tx => {
        if (!expectedRevision) await tx.userHistoryDocument.create({ data: { userId: user.id, key: 'profile', payload: JSON.parse(JSON.stringify(payload)), revision } });
        else {
          const updated = await tx.userHistoryDocument.updateMany({ where: { userId: user.id, key: 'profile', revision: expectedRevision }, data: { payload: JSON.parse(JSON.stringify(payload)), revision } });
          if (!updated.count) throw new Error('HISTORY_CONFLICT');
        }
        const current = await tx.learningProfile.findUnique({ where: { userId: user.id } });
        const dimensions = payload.profile?.dimensions;
        if (dimensions && JSON.stringify(current?.dimensions) !== JSON.stringify(dimensions)) {
          if ((current?.version ?? 0) !== expectedProfileVersion) throw new Error('HISTORY_CONFLICT');
          if (current) {
            const update = await tx.learningProfile.updateMany({ where: { userId: user.id, version: expectedProfileVersion }, data: { dimensions: JSON.parse(JSON.stringify(dimensions)), version: { increment: 1 }, lastSource: 'history' } });
            if (!update.count) throw new Error('HISTORY_CONFLICT');
          } else await tx.learningProfile.create({ data: { userId: user.id, dimensions: JSON.parse(JSON.stringify(dimensions)) } });
          const version = (current?.version ?? 0) + 1;
          await tx.userHistoryDocument.create({ data: { userId: user.id, key: `profile-version:${version}:${crypto.randomUUID()}`, payload: { version, dimensions: JSON.parse(JSON.stringify(dimensions)), updatedAt: new Date().toISOString() } } });
          return { revision, canonicalVersion: version };
        }
        return { revision, canonicalVersion: current?.version ?? 0 };
      });
      return NextResponse.json({ success: true, data: result });
    } catch (err) { if ((err as { code?: string }).code === 'P2002' || (err instanceof Error && err.message === 'HISTORY_CONFLICT')) return conflict(); throw err; }
  });
}
