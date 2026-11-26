import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/deeptutor/services/auth-middleware';
import { UserSettingsService } from '@/lib/deeptutor/services/user-settings-service';
import { SettingsUpdateSchema } from '@/lib/server/schemas';
const service = new UserSettingsService();
async function settings(userId: string) {
  const stored = await service.getSettings(userId);
  return { theme: 'system', language: 'zh-CN', temperature: 0.7, maxTokens: 4096, generatePptImages: false, pptMaxPages: null, enablePptInteractive: true, enablePptQuiz: true, revision: 0, ...stored, defaultModel: stored?.model ?? process.env.AI_MODEL ?? 'gpt-4o-mini', maxTurns: stored?.maxTurns?.toString() ?? '' };
}
export async function GET(req: NextRequest) { return withAuth(req, async (_, { user }) => NextResponse.json({ success: true, data: await settings(user.id) })); }
export async function PUT(req: NextRequest) {
  return withAuth(req, async (_, { user }) => {
    const parsed = SettingsUpdateSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    const { expectedRevision, defaultModel, ...data } = parsed.data;
    if (expectedRevision === undefined) return NextResponse.json({ error: 'expectedRevision required' }, { status: 428 });
    const ok = await service.updateSettings(user.id, { ...data, ...(defaultModel !== undefined ? { model: defaultModel } : {}) }, expectedRevision);
    if (!ok) return NextResponse.json({ error: '设置已在其他设备更新，请刷新后重试' }, { status: 409 });
    return NextResponse.json({ success: true, data: await settings(user.id) });
  });
}
