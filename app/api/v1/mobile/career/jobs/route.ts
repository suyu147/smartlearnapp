import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/deeptutor/services/auth-middleware';
import { insightErrorResponse, insightRequest } from '@/lib/career/insight-proxy';
import type { JobSummary, PageData } from '@/lib/career/types';

const jobQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  keyword: z.string().trim().max(100).optional(),
});

export async function GET(req: NextRequest) {
  return withAuth(req, async () => {
    const input = jobQuery.safeParse(Object.fromEntries(req.nextUrl.searchParams));
    if (!input.success) return NextResponse.json({ error: '请检查岗位搜索条件' }, { status: 400 });
    try {
      const data = await insightRequest<PageData<JobSummary>>({
        path: '/api/v1/jobs',
        query: input.data,
      });
      return NextResponse.json({ success: true, data });
    } catch (error) {
      return insightErrorResponse(error);
    }
  });
}
