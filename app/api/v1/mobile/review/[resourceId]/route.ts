import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/deeptutor/services/auth-middleware';
import { submissionSchema } from '@/lib/mobile/practice';
import { getReviewPractice, reviewSelectionSchema, reviewVersionSchema, submitReview } from '@/lib/mobile/review';

type Context = { params: Promise<{ resourceId: string }> };

function parseSelection(req: NextRequest) {
  const { reportId, questionId } = Object.fromEntries(req.nextUrl.searchParams);
  return reviewSelectionSchema.safeParse({
    ...(reportId === undefined ? {} : { reportId }),
    ...(questionId === undefined ? {} : { questionId }),
  });
}

export async function GET(req: NextRequest, { params }: Context) {
  return withAuth(req, async (_, { user }) => {
    const selection = parseSelection(req);
    const version = reviewVersionSchema.safeParse(req.nextUrl.searchParams.get('version'));
    if (!selection.success || !version.success) return NextResponse.json({ error: '请选择要复习的错题' }, { status: 400 });
    const { resourceId } = await params;
    const result = await getReviewPractice(user.id, resourceId, version.data, selection.data);
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ success: true, data: result.data });
  });
}

export async function POST(req: NextRequest, { params }: Context) {
  return withAuth(req, async (_, { user }) => {
    const selection = parseSelection(req);
    const input = submissionSchema.safeParse(await req.json().catch(() => null));
    if (!selection.success || !input.success) return NextResponse.json({ error: '请检查复习答案' }, { status: 400 });
    const { resourceId } = await params;
    const result = await submitReview(user.id, resourceId, input.data, selection.data);
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ success: true, data: result.data });
  });
}
