import { NextRequest } from 'next/server';
import { insightRequest, withInsight } from '@/lib/career/insight-proxy';
import { withAuth } from '@/lib/deeptutor/services/auth-middleware';
import { forgetCareerResume, requireCareerItem } from '@/lib/career/resume-ownership';

/** 删除我的简历（需登录职能洞察） */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ resumeId: string }> },
) {
  const { resumeId } = await params;
  return withAuth(req, (_, { user }) => withInsight(async () => {
    await requireCareerItem(user.id, 'resume', resumeId);
    const result = await insightRequest<{ resumeId: string; deleted: boolean }>({
      method: 'DELETE',
      path: `/api/v1/me/resumes/${encodeURIComponent(resumeId)}`,
      auth: true,
    });
    if (result.deleted) await forgetCareerResume(user.id, resumeId);
    return result;
  }));
}
