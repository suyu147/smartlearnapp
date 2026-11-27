import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/deeptutor/services/auth-middleware';
import { loadResources } from '@/lib/api/server/resource-persistence';

export async function GET(req: NextRequest) {
  return withAuth(req, async (_, { user }) => {
    const sessionId = req.nextUrl.searchParams.get('sessionId') ?? undefined;
    const resources = (await loadResources(user.id, sessionId)).flatMap(resource => {
      if (resource.status !== 'ready' || resource.metadata?.origin !== 'learning-path') return [];
      if (resource.type === 'ppt' && resource.metadata?.standardPptData?.format !== 'standard_pptx_v1') return [];
      if (resource.type === 'quiz' || resource.type === 'ppt') {
        return [{ ...resource, content: '', metadata: { origin: resource.metadata.origin, nodeId: resource.metadata.nodeId } }];
      }
      return [resource];
    });
    return NextResponse.json({ success: true, data: { resources } });
  });
}
