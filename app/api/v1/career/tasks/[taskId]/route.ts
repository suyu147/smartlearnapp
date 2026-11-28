import { NextRequest } from 'next/server';
import { insightRequest, withInsight } from '@/lib/career/insight-proxy';
import { withAuth } from '@/lib/deeptutor/services/auth-middleware';
import { rememberCareerItem, requireCareerItem } from '@/lib/career/resume-ownership';
import type { ParseTask } from '@/lib/career/types';

/** 查询简历解析任务进度（需登录职能洞察） */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await params;
  return withAuth(req, (_, { user }) => withInsight(async () => {
    await requireCareerItem(user.id, 'task', taskId);
    const task = await insightRequest<ParseTask>({
      path: `/api/v1/tasks/${encodeURIComponent(taskId)}`,
      auth: true,
    });
    if (task.status === 'completed' && task.result?.resumeId) {
      await rememberCareerItem(user.id, 'resume', task.result.resumeId);
      await requireCareerItem(user.id, 'resume', task.result.resumeId);
    }
    return task;
  }));
}
