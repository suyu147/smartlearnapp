import { NextRequest } from 'next/server';
import {
  InsightError,
  UPLOAD_TIMEOUT_MS,
  insightRequest,
  validateResumeFile,
  withInsight,
} from '@/lib/career/insight-proxy';
import { withAuth } from '@/lib/deeptutor/services/auth-middleware';
import { ownedCareerResumes, rememberCareerItem } from '@/lib/career/resume-ownership';
import type { ResumeRecord, UploadTask } from '@/lib/career/types';

/** 我的简历列表（需登录职能洞察） */
export async function GET(req: NextRequest) {
  const limit = Math.max(1, Math.min(100, Number(req.nextUrl.searchParams.get('limit')) || 20));
  return withAuth(req, (_, { user }) => withInsight(async () => {
    const owned = await ownedCareerResumes(user.id);
    if (!owned.size) return { items: [], total: 0 };
    const upstream = await insightRequest<{ items: ResumeRecord[]; total: number }>({
      path: '/api/v1/me/resumes',
      query: { limit: 100 },
      auth: true,
    });
    const items = upstream.items.filter(item => owned.has(item.resumeId));
    return { items: items.slice(0, limit), total: items.length };
  }));
}

/** 上传简历，返回异步解析任务（需登录职能洞察） */
export async function POST(req: NextRequest) {
  return withAuth(req, (_, { user }) => withInsight(async () => {
    const incoming = await req.formData().catch(() => null);
    const file = incoming?.get('file');
    if (!(file instanceof File)) {
      throw new InsightError('缺少简历文件', 400, 'career_invalid_resume');
    }
    const invalid = validateResumeFile(file);
    if (invalid) throw new InsightError(invalid, 400, 'career_invalid_resume');

    // 重新构造 FormData，确保以 file 字段透传给职能洞察
    const body = new FormData();
    body.append('file', file, file.name);

    const task = await insightRequest<UploadTask>({
      method: 'POST',
      path: '/api/v1/resumes',
      formData: body,
      auth: true,
      timeoutMs: UPLOAD_TIMEOUT_MS,
    });
    if (!task.taskId) throw new InsightError('职业服务未返回解析任务', 502, 'career_bad_response');
    await rememberCareerItem(user.id, 'task', task.taskId);
    return task;
  }));
}
