import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/deeptutor/services/auth-middleware';
import { generateStandardPptDeck, generateStandardPptOutline, renderStandardPptx, standardPptOutlineSchema } from '@/lib/generation/standard-ppt';
import { saveResources } from '@/lib/api/server/resource-persistence';
import { createLogger } from '@/lib/logger';
import prisma from '@/lib/utils/database';
import type { StandardPptDeck } from '@/lib/types/standard-ppt';

export const runtime = 'nodejs';
const log = createLogger('api:smartlearn:ppt');

const generateRequest = z.object({
  action: z.enum(['outline', 'generate']).default('generate'),
  topic: z.string().trim().min(1).max(200),
  slideCount: z.number().int().min(3).max(20).default(8),
  language: z.enum(['zh-CN', 'en-US']).default('zh-CN'),
  style: z.enum(['professional', 'minimal', 'academic', 'creative', 'dark']).default('professional'),
  includeImages: z.boolean().default(false),
  outline: standardPptOutlineSchema.optional(),
  aiConfig: z.object({
    providerId: z.string().max(64).optional(),
    modelId: z.string().max(200).optional(),
    apiKey: z.string().max(2048).optional(),
  }).optional(),
});

function safeFilename(value: string): string {
  const name = [...value.toWellFormed().replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_').trim()].slice(0, 100).join('');
  return (name || 'SmartLearn-Presentation') + '.pptx';
}

export async function GET(req: NextRequest) {
  return withAuth(req, async (_, { user }) => {
    const id = req.nextUrl.searchParams.get('id');
    if (!id || id.length > 128) return NextResponse.json({ error: '缺少有效的 PPT 资源 ID' }, { status: 400 });
    const resource = await prisma.resource.findFirst({
      where: { id, userId: user.id, type: 'ppt', sourceAgent: 'resource-ppt', sessionId: null, deletedAt: null, status: 'ready' },
      select: { metadata: true },
    });
    const metadata = resource?.metadata as { standardPptData?: StandardPptDeck } | null;
    const deck = metadata?.standardPptData;
    if (deck?.format !== 'standard_pptx_v1' || !Array.isArray(deck.slides)) {
      return NextResponse.json({ error: '找不到可下载的 PPT' }, { status: 404 });
    }
    try {
      const buffer = await renderStandardPptx(deck);
      const filename = encodeURIComponent(safeFilename(deck.title)).replace(/['()*]/g, (char) => '%' + char.charCodeAt(0).toString(16));
      return new NextResponse(Uint8Array.from(buffer), {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          'Content-Disposition': "attachment; filename*=UTF-8''" + filename,
          'Cache-Control': 'no-store',
        },
      });
    } catch (error) {
      log.error('PPTX export failed:', error);
      return NextResponse.json({ error: 'PPTX 导出失败，请重试' }, { status: 500 });
    }
  });
}

export async function POST(req: NextRequest) {
  return withAuth(req, async (_, { user }) => {
    const request = generateRequest.safeParse(await req.json().catch(() => null));
    if (!request.success || (request.data.outline && request.data.outline.slides.length !== request.data.slideCount)) {
      return NextResponse.json({ error: '请检查主题、页数、语言、风格和大纲内容' }, { status: 400 });
    }
    try {
      const outline = request.data.outline ?? await generateStandardPptOutline(request.data, req.signal);
      if (request.data.action === 'outline') {
        return NextResponse.json({ success: true, data: { outline } });
      }
      const deck = await generateStandardPptDeck(request.data, outline, req.signal);
      const [resource] = await saveResources(user.id, [{
        id: crypto.randomUUID(),
        userId: user.id,
        type: 'ppt',
        title: deck.title,
        content: deck.slides.map((slide) => slide.title).join('\n'),
        metadata: { knowledgePoints: [deck.topic], language: deck.language, standardPptData: deck },
        sourceAgent: 'resource-ppt',
        status: 'ready',
        createdAt: deck.generatedAt,
      }]);
      return NextResponse.json({ success: true, data: { resource } });
    } catch (err) {
      log.error('PPT handler error:', err);
      return NextResponse.json({ error: 'PPT 生成失败，请检查模型配置后重试' }, { status: 500 });
    }
  });
}
