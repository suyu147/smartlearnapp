import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/deeptutor/services/auth-middleware';
import { batchRefsSchema, batchSubmissionSchema, getReviewBatch, submitReviewBatch } from '@/lib/mobile/review';

export async function GET(req: NextRequest) {
  return withAuth(req, async (_, { user }) => {
    let refs: unknown;
    try { refs = JSON.parse(req.nextUrl.searchParams.get('refs') ?? 'null'); } catch { refs = null; }
    const input = batchRefsSchema.safeParse(refs);
    if (!input.success) return NextResponse.json({ error: '请选择要复习的错题' }, { status: 400 });
    const result = await getReviewBatch(user.id, input.data);
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ success: true, data: result.data });
  });
}

export async function POST(req: NextRequest) {
  return withAuth(req, async (_, { user }) => {
    const input = batchSubmissionSchema.safeParse(await req.json().catch(() => null));
    if (!input.success) return NextResponse.json({ error: '请检查复习答案' }, { status: 400 });
    const result = await submitReviewBatch(user.id, input.data);
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ success: true, data: result.data });
  });
}
