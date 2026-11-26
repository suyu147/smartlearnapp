import { after, NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { authenticate } from '@/lib/deeptutor/services/auth';
import { OnboardingRequestSchema } from '@/lib/onboarding/schema';
import { OnboardingError, submitOnboarding } from '@/lib/onboarding/service';
import { getTextIssues } from '@/lib/onboarding/mapping';
import { syncOnboardingMemory } from '@/lib/onboarding/memory';

export async function POST(request: NextRequest) {
  try {
    const user = await authenticate(request);
    const body = OnboardingRequestSchema.parse(await request.json());
    const profile = await submitOnboarding(user.id, body);
    after(async () => {
      try { await syncOnboardingMemory(user.id); }
      catch { console.warn('[Onboarding] Memory sync failed; saved profile remains authoritative.'); }
    });
    return NextResponse.json({ profile, issues: getTextIssues(profile.dimensions) });
  } catch (error) {
    if (error instanceof OnboardingError) return NextResponse.json({ code: error.code, error: error.message }, { status: error.status });
    if (error instanceof ZodError) return NextResponse.json({
      code: 'invalid_form', error: '请检查表单选项和输入长度。', fields: error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })),
    }, { status: 400 });
    if (error instanceof SyntaxError) return NextResponse.json({ error: '表单格式不正确。' }, { status: 400 });
    const status = (error as { statusCode?: number })?.statusCode ?? 500;
    return NextResponse.json({ error: status === 401 ? '请重新登录后提交。' : '保存失败，请稍后重试。' }, { status });
  }
}
