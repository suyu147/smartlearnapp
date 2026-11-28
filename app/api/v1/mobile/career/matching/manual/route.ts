import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/deeptutor/services/auth-middleware';
import { insightErrorResponse, insightRequest } from '@/lib/career/insight-proxy';
import type { MatchResult } from '@/lib/career/types';

const matchSchema = z.object({
  targetRoleId: z.string().trim().min(1).max(200),
  skills: z.array(z.string().trim().min(1).max(100)).min(1).max(100),
  education: z.string().trim().max(50).optional().default(''),
  experienceYears: z.number().min(0).max(80).nullable().optional().default(null),
  certificates: z.array(z.string().trim().min(1).max(100)).max(100).optional().default([]),
  workStyleScore: z.number().min(0).max(100).nullable().optional().default(60),
});

export async function POST(req: NextRequest) {
  return withAuth(req, async () => {
    const input = matchSchema.safeParse(await req.json().catch(() => null));
    if (!input.success) return NextResponse.json({ error: '请检查职业诊断信息' }, { status: 400 });
    try {
      const data = await insightRequest<MatchResult>({
        method: 'POST',
        path: '/api/v1/matching/manual',
        body: { ...input.data, resumeId: '' },
      });
      return NextResponse.json({ success: true, data });
    } catch (error) {
      return insightErrorResponse(error);
    }
  });
}
