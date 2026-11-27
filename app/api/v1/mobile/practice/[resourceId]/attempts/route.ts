import { after, NextRequest, NextResponse } from 'next/server';
import { findPathSession, isStagedMobilePath } from '@/lib/api/server/path-generation';
import { generateUnlockedStageResources } from '@/lib/api/server/path-stream';
import { withAuth } from '@/lib/deeptutor/services/auth-middleware';
import { submissionSchema, submitPractice } from '@/lib/mobile/practice';

export async function POST(req: NextRequest, { params }: { params: Promise<{ resourceId: string }> }) {
  return withAuth(req, async (_, { user }) => {
    const input = submissionSchema.safeParse(await req.json().catch(() => null));
    if (!input.success) return NextResponse.json({ error: '请检查答题内容' }, { status: 400 });
    const { resourceId } = await params;
    const result = await submitPractice(user.id, resourceId, input.data);
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });
    if (result.data.kind === 'practice') {
      const { pathSessionId, nodeId } = result.data;
      after(async () => {
        const session = await findPathSession(user.id, pathSessionId);
        if (session && isStagedMobilePath(session)) await generateUnlockedStageResources(user.id, session, nodeId);
      });
    }
    return NextResponse.json({ success: true, data: result.data });
  });
}
