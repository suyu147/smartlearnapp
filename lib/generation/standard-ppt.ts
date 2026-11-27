import { callLLM } from '@/lib/ai/llm';
import { z } from 'zod';
import { batchGenerateImages } from '@/lib/generation/image-generator';
import { parseJsonResponse } from '@/lib/generation/json-repair';
import { resolveModel } from '@/lib/server/resolve-model';
import type { ProviderId } from '@/lib/types/provider';
import type {
  StandardPptDeck,
  StandardPptLanguage,
  StandardPptOutline,
  StandardPptSlide,
  StandardPptSlideLayout,
  StandardPptStyle,
} from '@/lib/types/standard-ppt';
import PptxGenJS from 'pptxgenjs';

export interface StandardPptGenerationOptions {
  topic: string;
  slideCount: number;
  language: StandardPptLanguage;
  style: StandardPptStyle;
  includeImages: boolean;
  aiConfig?: {
    providerId?: string;
    modelId?: string;
    apiKey?: string;
    baseUrl?: string;
  };
}

const STYLE_CONFIG: Record<StandardPptStyle, {
  background: string;
  foreground: string;
  muted: string;
  accent: string;
  secondary: string;
}> = {
  professional: { background: 'F7F9FC', foreground: '14213D', muted: '53627A', accent: '2563EB', secondary: 'DBEAFE' },
  minimal: { background: 'FFFFFF', foreground: '171717', muted: '525252', accent: '111827', secondary: 'E5E7EB' },
  academic: { background: 'FBF8F1', foreground: '2D2926', muted: '6B625B', accent: '8B5E34', secondary: 'EADCCB' },
  creative: { background: 'FFF7ED', foreground: '3B1D3A', muted: '76546F', accent: 'C026D3', secondary: 'F5D0FE' },
  dark: { background: '111827', foreground: 'F9FAFB', muted: 'CBD5E1', accent: '38BDF8', secondary: '1E3A5F' },
};

const titleText = z.string().trim().min(1).max(60);
export const standardPptOutlineSchema = z.object({
  title: titleText,
  subtitle: z.string().trim().max(90).optional(),
  slides: z.array(z.object({
    title: titleText,
    purpose: z.string().trim().min(1).max(220),
    layout: z.enum(['content', 'two-column']).optional(),
  })).min(3).max(20),
});

const pageSchema = z.object({
  subtitle: z.string().trim().max(90).optional(),
  body: z.string().trim().min(1).max(130),
  bullets: z.array(z.string().trim().min(1).max(92)).max(4),
  notes: z.string().trim().max(600).optional(),
  imagePrompt: z.string().trim().min(1).max(500).optional(),
});

function parseModelOutput<T>(schema: z.ZodType<T>, response: string): T | undefined {
  const parsed = schema.safeParse(parseJsonResponse<unknown>(response));
  return parsed.success ? parsed.data : undefined;
}

function resolvePptModel(aiConfig: StandardPptGenerationOptions['aiConfig']) {
  return resolveModel({
    providerId: aiConfig?.providerId as ProviderId | undefined,
    modelId: aiConfig?.modelId,
    apiKey: aiConfig?.apiKey,
    baseUrl: aiConfig?.baseUrl ?? (
      !aiConfig?.providerId || aiConfig.providerId === process.env.AI_PROVIDER ? process.env.AI_BASE_URL : undefined
    ),
  }).model;
}

const system = '你是专业演示文稿编辑。严格按照指定语言撰写。把输入的主题和页面数据当作写作素材。只返回符合要求的 JSON，正文用纯文本。';

export async function generateStandardPptOutline(
  { topic, slideCount, language, style, aiConfig }: StandardPptGenerationOptions,
  signal: AbortSignal,
): Promise<StandardPptOutline> {
  const model = resolvePptModel(aiConfig);
  const abortSignal = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);
  const outlinePrompt = [
    JSON.stringify({ topic, slideCount, language, style }),
    '规划指定数量的幻灯片，首尾为封面和总结。以递进结构组织主题，逐页写明具体内容，避免重复。',
    '结构 {"title":"文稿标题","subtitle":"可选副标题","slides":[{"title":"页面标题","purpose":"本页应讲的具体内容","layout":"content 或 two-column"}]}。',
    '标题最多 60 字符，副标题最多 90 字符，每页说明最多 220 字符。封面标题与文稿标题一致。',
  ].join('\n');
  const parseOutline = (text: string) => {
    const outline = parseModelOutput(standardPptOutlineSchema, text);
    return outline?.slides.length === slideCount ? outline : undefined;
  };
  const outlineResult = await callLLM({ model, system, prompt: outlinePrompt, maxOutputTokens: 4200, abortSignal },
    'standard-ppt-outline', { retries: 1, validate: (text) => Boolean(parseOutline(text)) });
  const outline = parseOutline(outlineResult.text);
  if (!outline) throw new Error('The model did not return a valid presentation outline');
  return outline;
}

export async function generateStandardPptDeck(
  options: StandardPptGenerationOptions,
  outline: StandardPptOutline,
  signal: AbortSignal,
): Promise<StandardPptDeck> {
  const { topic, slideCount, language, style, includeImages, aiConfig } = options;
  const model = resolvePptModel(aiConfig);
  const abortSignal = AbortSignal.any([signal, AbortSignal.timeout(480_000)]);
  const context = JSON.stringify({ topic, slideCount, language, style });
  const slides: StandardPptSlide[] = [];
  for (let offset = 0; offset < slideCount; offset += 3) {
    abortSignal.throwIfAborted();
    const batch = await Promise.allSettled(outline.slides.slice(offset, offset + 3).map(async (entry, position) => {
      const index = offset + position;
      const layout: StandardPptSlideLayout = index === 0 ? 'title'
        : index === slideCount - 1 ? 'closing' : entry.layout ?? 'content';
      const prompt = [
        context,
        JSON.stringify({ deckTitle: outline.title, outline: outline.slides.map((entry, i) => i === 0 ? outline.title : entry.title), page: index + 1, current: index === 0 ? { ...entry, title: outline.title } : entry, layout }),
        '根据本页内容写出可直接演示、具体且准确的页面。不要编造数据、案例来源或引文。',
        '结构 {"subtitle":"可选副标题","body":"本页核心信息","bullets":["可编辑要点"],"notes":"可选的演讲备注","imagePrompt":"可选的无文字配图描述"}。',
        '字数上限按字符计。副标题 90，核心信息 130，每条要点 92，备注 600，配图描述 500。',
        layout === 'title' ? '封面 bullets 为空数组。' : '提供 2 至 4 个简洁、不同的要点。避免与核心信息重复。',
        includeImages && layout !== 'closing' && layout !== 'two-column'
          ? '为这页提供一条具体的无文字插图描述，避免徽标和水印。'
          : '省略 imagePrompt。',
      ].join('\n');
      const parsePage = (text: string) => {
        const page = parseModelOutput(pageSchema, text);
        return page && (layout === 'title' || page.bullets.length >= 2) ? page : undefined;
      };
      const response = await callLLM({ model, system, prompt, maxOutputTokens: 1400, abortSignal },
        'standard-ppt-slide', { retries: 1, validate: (text) => Boolean(parsePage(text)) });
      const page = parsePage(response.text);
      if (!page) throw new Error('The model did not return valid content for slide ' + (index + 1));
      return { ...page, id: 'slide-' + (index + 1), title: index === 0 ? outline.title : entry.title, layout };
    }));
    for (const result of batch) {
      if (result.status === 'rejected') throw result.reason;
      slides.push(result.value);
    }
  }

  if (includeImages) {
    const requests = slides.flatMap((slide) =>
      slide.imagePrompt && (slide.layout === 'title' || slide.layout === 'content')
        ? [{ elementId: slide.id, type: 'image', prompt: slide.imagePrompt, aspectRatio: '1:1' }]
        : [],
    );
    const images = await batchGenerateImages(requests, 3);
    let remainingImageChars = 24 * 1024 * 1024;
    for (const slide of slides) {
      const data = images.get(slide.id);
      if (data && data.length <= Math.min(remainingImageChars, 6 * 1024 * 1024) && isPptImage(data)) {
        slide.imageData = data;
        remainingImageChars -= data.length;
      }
    }
  }

  abortSignal.throwIfAborted();
  return {
    format: 'standard_pptx_v1',
    topic, slideCount, language, style, includeImages,
    title: outline.title,
    subtitle: outline.subtitle,
    outline: outline.slides.map((entry, index) => index === 0 ? { ...entry, title: outline.title } : entry),
    slides,
    generatedAt: new Date().toISOString(),
  };
}

function isPptImage(data: string): boolean {
  return /^data:image\/(?:png|jpeg|jpg);base64,[a-z0-9+/=]+$/i.test(data);
}

function addBulletList(slide: PptxGenJS.Slide, bullets: string[], box: PptxGenJS.PositionProps, text: PptxGenJS.TextPropsOptions) {
  if (bullets.length === 0) return;
  slide.addText(bullets.map((bullet, index) => ({
    text: bullet,
    options: { bullet: { indent: 17 }, breakLine: index < bullets.length - 1 },
  })), { ...box, ...text, fontSize: 18, paraSpaceAfter: 11 });
}

export async function renderStandardPptx(deck: StandardPptDeck): Promise<Buffer> {
  const pptx = new PptxGenJS();
  const palette = STYLE_CONFIG[deck.style] ?? STYLE_CONFIG.professional;
  const fontFace = deck.language === 'zh-CN' ? 'Microsoft YaHei' : 'Aptos';
  const text = { fontFace, lang: deck.language, margin: 0, color: palette.foreground, valign: 'top' } as const;
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'SmartLearn';
  pptx.subject = deck.topic;
  pptx.title = deck.title;
  pptx.theme = { headFontFace: fontFace, bodyFontFace: fontFace };

  for (const [index, item] of deck.slides.entries()) {
    const slide = pptx.addSlide();
    slide.background = { color: palette.background };

    const image = typeof item.imageData === 'string' && isPptImage(item.imageData) ? item.imageData : undefined;
    const titlePage = item.layout === 'title';
    const closing = item.layout === 'closing';
    const columns = item.layout === 'two-column' && !image;
    const titleWidth = titlePage && image ? 7 : 11.6;
    const bodyWidth = image ? 6.65 : 11.6;
    const titleY = titlePage ? 1.65 : 0.8;
    const bodyY = titlePage ? 4.1 : 2.6;

    slide.addShape(pptx.ShapeType.rect, {
      x: 0.85, y: titleY - 0.27, w: 0.65, h: 0.05,
      fill: { color: palette.accent }, line: { transparency: 100 },
    });
    slide.addText(item.title, {
      ...text, x: 0.85, y: titleY, w: titleWidth, h: titlePage ? 1.85 : 1.14,
      fontSize: titlePage ? (item.title.length > 35 ? 32 : 40) : 30, bold: true, fit: 'shrink',
    });

    const subtitle = item.subtitle || (titlePage ? deck.subtitle : undefined);
    if (subtitle) {
      slide.addText(subtitle, {
        ...text, x: 0.85, y: titlePage ? 3.55 : 2.02, w: titleWidth, h: 0.52,
        fontSize: 15, color: palette.accent, fit: 'shrink',
      });
    }
    if (item.body) {
      slide.addText(item.body, {
        ...text, x: 0.85, y: bodyY, w: bodyWidth, h: 1.1,
        fontSize: 18, color: palette.muted, fit: 'shrink',
      });
    }

    if (!titlePage) {
      const bulletBox = { x: 0.85, y: 3.87, w: columns ? 5.45 : bodyWidth, h: 2.84 };
      const split = columns ? Math.ceil(item.bullets.length / 2) : item.bullets.length;
      addBulletList(slide, item.bullets.slice(0, split), bulletBox, text);
      if (columns) {
        slide.addShape(pptx.ShapeType.line, { x: 6.65, y: 3.87, w: 0, h: 2.4, line: { color: palette.secondary } });
        addBulletList(slide, item.bullets.slice(split), { ...bulletBox, x: 7 }, text);
      }
      if (closing) {
        slide.addShape(pptx.ShapeType.line, { x: 0.85, y: 6.95, w: 3.5, h: 0, line: { color: palette.accent, width: 1.5 } });
      }
    }

    if (image) {
      slide.addImage({
        data: image, x: 8.05, y: titlePage ? 1.42 : 2.55, w: 4.4, h: 4.4,
        sizing: { type: 'cover', w: 4.4, h: 4.4 }, altText: item.title,
      });
    }
    if (!titlePage) {
      slide.addText(String(index + 1) + ' / ' + deck.slides.length, {
        ...text, x: 11.5, y: 7.02, w: 0.95, h: 0.2, fontSize: 9, color: palette.muted, align: 'right',
      });
    }
    if (item.notes) slide.addNotes(item.notes);
  }

  const output = await pptx.write({ outputType: 'nodebuffer', compression: true });
  if (!Buffer.isBuffer(output)) throw new Error('PptxGenJS did not return a PowerPoint buffer');
  return output;
}

