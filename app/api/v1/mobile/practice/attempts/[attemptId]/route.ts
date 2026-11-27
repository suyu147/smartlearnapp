import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/deeptutor/services/auth-middleware';
import { attemptIdSchema, getPracticeReport } from '@/lib/mobile/practice';

export async function GET(req: NextRequest, { params }: { params: Promise<{ attemptId: string }> }) {
  return withAuth(req, async (_, { user }) => {
    const input = attemptIdSchema.safeParse((await params).attemptId);
    const report = input.success ? await getPracticeReport(user.id, input.data) : null;
    if (!report) return NextResponse.json({ error: '找不到练习报告' }, { status: 404 });
    return NextResponse.json({ success: true, data: report });
  });
}
