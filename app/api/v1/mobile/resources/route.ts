import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/deeptutor/services/auth-middleware';
import { loadResources } from '@/lib/api/server/resource-persistence';
import { mobileResource } from '@/lib/mobile/resources';

export async function GET(req: NextRequest) {
  return withAuth(req, async (_, { user }) => {
    const sessionId = req.nextUrl.searchParams.get('sessionId') ?? undefined;
    const resources = (await loadResources(user.id, sessionId)).map(mobileResource).filter(resource => resource !== null);
    return NextResponse.json({ success: true, data: { resources } });
  });
}
