import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/deeptutor/services/auth-middleware';
import { listReview, reviewListSchema } from '@/lib/mobile/review';

export async function GET(req: NextRequest) {
  return withAuth(req, async (_, { user }) => {
    const input = reviewListSchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
    if (!input.success) return NextResponse.json({ error: '请检查复习筛选条件' }, { status: 400 });
    const data = await listReview(user.id, input.data);
    return NextResponse.json({ success: true, data });
  });
}
