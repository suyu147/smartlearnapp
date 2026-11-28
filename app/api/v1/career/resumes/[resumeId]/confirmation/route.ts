import { NextRequest } from 'next/server';
import { insightRequest, withInsight } from '@/lib/career/insight-proxy';
import { withAuth } from '@/lib/deeptutor/services/auth-middleware';
import { requireCareerItem } from '@/lib/career/resume-ownership';
import type { ResumeConfirmPayload } from '@/lib/career/types';

/** 确认简历解析结果（需登录职能洞察） */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ resumeId: string }> },
) {
  const { resumeId } = await params;
  let payload: ResumeConfirmPayload;
  try {
    payload = (await req.json()) as ResumeConfirmPayload;
  } catch {
    return withInsight<never>(() => Promise.reject(new Error('请求体不是合法 JSON')));
  }

  return withAuth(req, (_, { user }) => withInsight(async () => {
    await requireCareerItem(user.id, 'resume', resumeId);
    return insightRequest<{ resumeId: string; confirmed: boolean; skillCount: number }>({
      method: 'PUT',
      path: `/api/v1/resumes/${encodeURIComponent(resumeId)}/confirmation`,
      body: {
        skills: payload?.skills ?? [],
        education: payload?.education ?? '',
        experienceYears: payload?.experienceYears ?? null,
        certificates: payload?.certificates ?? [],
      },
      auth: true,
    });
  }));
}
