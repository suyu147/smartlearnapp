import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/deeptutor/services/auth-middleware';
import { insightErrorResponse, insightRequest } from '@/lib/career/insight-proxy';
import type { RecommendationItem } from '@/lib/career/types';

const recommendationsSchema = z.object({
  skills: z.array(z.string().trim().min(1).max(100)).min(1).max(100),
  limit: z.number().int().min(1).max(20).optional().default(8),
});

export async function POST(req: NextRequest) {
  return withAuth(req, async () => {
    const input = recommendationsSchema.safeParse(await req.json().catch(() => null));
    if (!input.success) return NextResponse.json({ error: '至少填写一项已掌握技能' }, { status: 400 });
    try {
      const data = await insightRequest<{ items: RecommendationItem[]; total: number }>({
        method: 'POST',
        path: '/api/v1/matching/recommendations',
        body: input.data,
      });
      return NextResponse.json({ success: true, data });
    } catch (error) {
      return insightErrorResponse(error);
    }
  });
}
