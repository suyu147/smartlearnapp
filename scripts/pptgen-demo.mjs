/**
 * LLM → JSON 大纲 → PptxGenJS 渲染，生成真实 .pptx 的演示脚本。
 *
 * 用法：
 *   node scripts/pptgen-demo.mjs              # 用内置 mock JSON，无需任何 key
 *   node scripts/pptgen-demo.mjs --live "主题" # 调真实 LLM 生成 JSON 再渲染
 *
 * --live 需要环境变量（兼容 OpenAI 协议即可）：
 *   AI_BASE_URL / AI_API_KEY / AI_MODEL，或 OPENAI_* / DEEPSEEK_*
 *
 * 产物：
 *   out/<slug>.json   LLM 返回的结构化大纲
 *   out/<slug>.pptx   最终文件
 */

import fs from 'node:fs';
import path from 'node:path';
import PptxGenJS from 'pptxgenjs';

const W = 13.333;
const H = 7.5;
const FONT = 'Microsoft YaHei';

const C = {
  ink: '0B1220',
  paper: 'FFFFFF',
  body: '334155',
  muted: '64748B',
  line: 'E2E8F0',
  soft: 'F1F5F9',
  white: 'FFFFFF',
};

// ─────────────────────────── 1. LLM 调用 ───────────────────────────

function readLLMConfig() {
  const baseUrl = process.env.AI_BASE_URL || process.env.OPENAI_BASE_URL || process.env.DEEPSEEK_BASE_URL;
  const apiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY;
  const model = process.env.AI_MODEL || process.env.OPENAI_MODEL || process.env.DEEPSEEK_MODEL;
  if (!baseUrl || !apiKey || !model) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ''), apiKey, model };
}

const SYSTEM_PROMPT = `你是一位资深课件设计师。请把用户给的主题拆成一份 6-8 页的中文课件大纲。
只输出 JSON，不要输出 markdown 代码块或任何解释。JSON 结构严格如下：
{
  "title": "整份课件的标题",
  "subtitle": "一句副标题",
  "accent": "1D4ED8",                  // 主题色，6 位 hex，不要 #
  "slides": [
    { "layout": "cover",    "title": "封面主标题", "subtitle": "副标题", "notes": "演讲者备注" },
    { "layout": "bullets",  "title": "页标题", "bullets": ["要点1", "要点2"], "notes": "..." },
    { "layout": "two-column", "title": "页标题", "columns": [{"heading":"左栏","items":["a","b"]},{"heading":"右栏","items":["c","d"]}] },
    { "layout": "quote",    "title": "观点", "quote": "一句金句", "attribution": "出处" },
    { "layout": "summary",  "title": "总结", "bullets": ["结论1", "结论2", "结论3"] }
  ]
}
规则：
- 第一页必须是 cover，最后一页必须是 summary。
- 每页 bullets / items 的每条不超过 28 个汉字，数量 2-5 条。
- layout 只能取 cover / bullets / two-column / quote / summary。
- notes 写 40-80 字的口播稿。`;

async function callLLM(topic) {
  const cfg = readLLMConfig();
  if (!cfg) throw new Error('未配置 AI_BASE_URL / AI_API_KEY / AI_MODEL，无法使用 --live');

  const body = {
    model: cfg.model,
    temperature: 0.6,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `主题：${topic}` },
    ],
  };

  const doFetch = (payload) =>
    fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify(payload),
    });

  let res = await doFetch(body);
  // 少数兼容服务不支持 response_format，降级重试一次
  if (!res.ok && res.status === 400) {
    const { response_format, ...rest } = body;
    res = await doFetch(rest);
  }
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${await res.text()}`);

  const json = await res.json();
  const text = json.choices?.[0]?.message?.content ?? '';
  return extractJson(text);
}

function extractJson(text) {
  const cleaned = text.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error(`LLM 未返回合法 JSON：${text.slice(0, 200)}`);
    return JSON.parse(cleaned.slice(start, end + 1));
  }
}

// ─────────────────────────── 2. 数据校验 ───────────────────────────

const LAYOUTS = new Set(['cover', 'bullets', 'two-column', 'quote', 'summary']);
const asText = (v, fallback = '') => (typeof v === 'string' ? v.trim() : fallback);
const asList = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()) : []);

function normalizeDeck(raw) {
  const title = asText(raw.title, '未命名课件');
  const accent = /^[0-9a-f]{6}$/i.test(asText(raw.accent)) ? raw.accent.replace('#', '') : '1D4ED8';

  let slides = Array.isArray(raw.slides) ? raw.slides : [];
  slides = slides
    .filter((s) => s && typeof s === 'object')
    .map((s) => {
      const layout = LAYOUTS.has(s.layout) ? s.layout : 'bullets';
      return {
        layout,
        title: asText(s.title, title),
        subtitle: asText(s.subtitle),
        bullets: asList(s.bullets).slice(0, 5),
        columns: Array.isArray(s.columns)
          ? s.columns.slice(0, 2).map((c) => ({
              heading: asText(c?.heading, ''),
              items: asList(c?.items).slice(0, 5),
            }))
          : [],
        quote: asText(s.quote, asText(s.title)),
        attribution: asText(s.attribution),
        notes: asText(s.notes),
      };
    })
    .slice(0, 10);

  if (!slides.length) slides = MOCK.slides;
  if (slides[0].layout !== 'cover') slides.unshift({ ...MOCK.slides[0], title, subtitle: asText(raw.subtitle) });
  if (slides[slides.length - 1].layout !== 'summary') {
    slides.push({ ...MOCK.slides[MOCK.slides.length - 1], title: '总结与回顾' });
  }

  return { title, subtitle: asText(raw.subtitle), accent, slides };
}

// ─────────────────────────── 3. 渲染器 ───────────────────────────

const fit = (text, base, min, comfortableChars) =>
  Math.max(min, Math.round(base - Math.max(0, [...text].length - comfortableChars) * 1.1));

const textOpts = (o) => ({ fontFace: FONT, margin: 0, ...o });

function pageNumber(slide, i, total, color = C.muted) {
  slide.addText(`${i + 1} / ${total}`, textOpts({
    x: W - 1.35, y: H - 0.55, w: 0.9, h: 0.3,
    fontSize: 10, color, align: 'right',
  }));
}

function renderCover(pptx, slide, s, deck) {
  slide.background = { color: C.ink };
  // 右侧装饰：半透明圆 + 细线
  slide.addShape(pptx.ShapeType.ellipse, {
    x: W - 4.6, y: -1.7, w: 6.4, h: 6.4,
    fill: { color: deck.accent, transparency: 82 }, line: { color: deck.accent, transparency: 100 },
  });
  slide.addShape(pptx.ShapeType.ellipse, {
    x: W - 2.6, y: 3.6, w: 3.6, h: 3.6,
    fill: { color: deck.accent, transparency: 90 }, line: { color: deck.accent, transparency: 100 },
  });

  slide.addShape(pptx.ShapeType.rect, {
    x: 0.9, y: 2.36, w: 0.9, h: 0.09, fill: { color: deck.accent }, line: { color: deck.accent },
  });
  slide.addText(s.title, textOpts({
    x: 0.9, y: 2.62, w: 8.6, h: 1.9,
    fontSize: fit(s.title, 40, 26, 12), bold: true, color: C.white,
    valign: 'top', lineSpacingMultiple: 1.12, charSpacing: 1,
  }));
  if (s.subtitle) {
    slide.addText(s.subtitle, textOpts({
      x: 0.9, y: 4.18, w: 8.2, h: 0.9,
      fontSize: 16, color: '94A3B8', lineSpacingMultiple: 1.3,
    }));
  }
  slide.addText('智学方舟 · AI 生成课件', textOpts({
    x: 0.9, y: H - 0.85, w: 5, h: 0.3, fontSize: 10, color: '64748B', charSpacing: 0.5,
  }));
}

function renderBullets(pptx, slide, s, deck) {
  slide.background = { color: C.paper };
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.75, y: 0.62, w: 0.16, h: 0.62, fill: { color: deck.accent }, line: { color: deck.accent },
  });
  slide.addText(s.title, textOpts({
    x: 1.08, y: 0.55, w: 10.4, h: 0.8,
    fontSize: fit(s.title, 27, 20, 18), bold: true, color: C.ink, valign: 'middle',
  }));

  const items = s.bullets.length ? s.bullets : ['（未生成要点）'];
  const startY = 1.78;
  const gap = Math.min(1.32, 4.75 / items.length);
  items.forEach((item, idx) => {
    const y = startY + idx * gap;
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 0.9, y, w: 0.42, h: 0.42,
      fill: { color: deck.accent, transparency: 88 },
      line: { color: deck.accent, transparency: 60 },
      rectRadius: 0.08,
    });
    slide.addText(String(idx + 1), textOpts({
      x: 0.9, y, w: 0.42, h: 0.42,
      fontSize: 12, bold: true, color: deck.accent, align: 'center', valign: 'middle',
    }));
    slide.addText(item, textOpts({
      x: 1.58, y: y - 0.06, w: 10.9, h: 0.62,
      fontSize: fit(item, 17, 13, 24), color: C.body, valign: 'middle', lineSpacingMultiple: 1.25,
    }));
  });
  pageNumber(slide, 0, 0, C.line);
}

function renderTwoColumn(pptx, slide, s, deck) {
  slide.background = { color: C.paper };
  slide.addText(s.title, textOpts({
    x: 0.85, y: 0.5, w: 11.6, h: 0.8,
    fontSize: fit(s.title, 27, 20, 18), bold: true, color: C.ink, valign: 'middle',
  }));
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.88, y: 1.36, w: 11.6, h: 0.02, fill: { color: C.line }, line: { color: C.line },
  });

  const cols = s.columns.length ? s.columns : [{ heading: '', items: s.bullets }, { heading: '', items: [] }];
  cols.slice(0, 2).forEach((col, i) => {
    const x = 0.85 + i * 5.98;
    slide.addShape(pptx.ShapeType.roundRect, {
      x, y: 1.78, w: 5.55, h: 3.85,
      fill: { color: C.soft }, line: { color: C.line, width: 0.75 }, rectRadius: 0.12,
    });
    if (col.heading) {
      slide.addText(col.heading, textOpts({
        x: x + 0.4, y: 2.0, w: 4.75, h: 0.5,
        fontSize: 17, bold: true, color: deck.accent, valign: 'middle',
      }));
    }
    const body = col.items.length ? col.items.join('\n') : '—';
    slide.addText(body, textOpts({
      x: x + 0.4, y: col.heading ? 2.55 : 2.05, w: 4.75, h: 2.85,
      fontSize: 15, color: C.body, valign: 'top',
      lineSpacingMultiple: 1.7, bullet: { code: '2022' },
    }));
  });
}

function renderQuote(pptx, slide, s, deck) {
  slide.background = { color: C.ink };
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.95, y: 1.95, w: 0.09, h: 2.5, fill: { color: deck.accent }, line: { color: deck.accent },
  });
  slide.addText(s.quote || s.title, textOpts({
    x: 1.45, y: 1.85, w: 10.5, h: 2.75,
    fontSize: fit(s.quote || s.title, 32, 21, 20), color: C.white, bold: true,
    lineSpacingMultiple: 1.4, valign: 'middle',
  }));
  if (s.attribution) {
    slide.addText(`— ${s.attribution}`, textOpts({
      x: 1.45, y: 4.95, w: 10.5, h: 0.4, fontSize: 13, color: '94A3B8',
    }));
  }
}

function renderSummary(pptx, slide, s, deck) {
  slide.background = { color: C.ink };
  slide.addText(s.title || '总结', textOpts({
    x: 0.9, y: 0.7, w: 10.8, h: 0.8,
    fontSize: fit(s.title, 28, 21, 16), bold: true, color: C.white,
  }));
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.93, y: 1.62, w: 0.9, h: 0.08, fill: { color: deck.accent }, line: { color: deck.accent },
  });

  const items = (s.bullets.length ? s.bullets : ['回顾核心概念', '完成课后练习', '进入下一节点']).slice(0, 4);
  items.forEach((item, i) => {
    const y = 2.15 + i * 1.05;
    slide.addShape(pptx.ShapeType.ellipse, {
      x: 0.95, y: y + 0.1, w: 0.34, h: 0.34,
      fill: { color: deck.accent }, line: { color: deck.accent },
    });
    slide.addText(String(i + 1), textOpts({
      x: 0.95, y: y + 0.1, w: 0.34, h: 0.34,
      fontSize: 10, bold: true, color: C.white, align: 'center', valign: 'middle',
    }));
    slide.addText(item, textOpts({
      x: 1.55, y, w: 10.5, h: 0.6,
      fontSize: fit(item, 17, 13, 26), color: 'E2E8F0', valign: 'middle',
    }));
  });
}

const RENDERERS = {
  cover: renderCover,
  bullets: renderBullets,
  'two-column': renderTwoColumn,
  quote: renderQuote,
  summary: renderSummary,
};

export async function buildPptx(deck, outFile) {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'DEMO_16_9', width: W, height: H });
  pptx.layout = 'DEMO_16_9';
  pptx.author = 'SmartLearn demo';
  pptx.title = deck.title;

  const total = deck.slides.length;
  deck.slides.forEach((s, i) => {
    const slide = pptx.addSlide();
    RENDERERS[s.layout](pptx, slide, s, deck);
    // 内页统一页码（封面不显示）
    if (s.layout !== 'cover') pageNumber(slide, i, total);
    if (s.notes) slide.addNotes(s.notes);
  });

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  await pptx.writeFile({ fileName: outFile });
  return outFile;
}

// ─────────────────────────── 4. Mock 数据 ───────────────────────────

const MOCK = {
  title: 'Transformer 与自注意力机制',
  subtitle: '从「序列建模」到「注意力即一切」',
  accent: '2563EB',
  slides: [
    {
      layout: 'cover',
      title: 'Transformer 与自注意力机制',
      subtitle: '理解大模型的核心结构：为什么它取代了 RNN',
      notes: '本课从序列建模的痛点出发，引出注意力机制，再拆解 Transformer 的编码器结构。',
    },
    {
      layout: 'bullets',
      title: 'RNN 的三个结构性瓶颈',
      bullets: [
        '串行计算：第 t 步必须等第 t-1 步完成，无法并行',
        '长程依赖：信息经过多步传递后严重衰减',
        '固定隐状态：整句语义被压缩进一个向量',
        '工程代价：梯度消失导致长序列训练困难',
      ],
      notes: '强调「无法并行」是 Transformer 出现的直接动因。',
    },
    {
      layout: 'two-column',
      title: '自注意力：一次看完整个句子',
      columns: [
        { heading: 'Query · Key · Value', items: ['每个词生成 Q / K / V 三个向量', 'Q 与所有 K 点积得到相关性分数', 'Softmax 归一化后对 V 加权求和'] },
        { heading: '相比 RNN 的优势', items: ['路径长度为 1，任意两词直接交互', '矩阵并行，训练速度提升显著', '权重可视化，可解释性更强'] },
      ],
      notes: '左右对照：左边讲机制，右边讲收益。',
    },
    {
      layout: 'quote',
      title: 'Attention Is All You Need',
      quote: '把「信息传递」变成「一次全连接的相关性计算」，是这一代模型的范式跃迁。',
      attribution: 'Vaswani et al., 2017',
      notes: '用一句金句帮助学生记住核心思想。',
    },
    {
      layout: 'bullets',
      title: '多头注意力与位置编码',
      bullets: [
        '多头：8 个注意力头并行，各自关注不同语义子空间',
        '拼接后线性变换，融合多视角信息',
        '位置编码：为无序的注意力补上顺序信息',
        '残差 + LayerNorm：让深层堆叠稳定可训练',
      ],
      notes: '多头是「集成」思想，位置编码解决置换不变性问题。',
    },
    {
      layout: 'summary',
      title: '课堂小结',
      bullets: ['自注意力解决长程依赖与并行化', '多头扩展表达能力，位置编码补顺序', '残差 + 归一化支撑深层网络', '下游：BERT / GPT 均由编码器或解码器派生'],
      notes: '回顾四点，并预告下一课：编码器与解码器的差异。',
    },
  ],
};

// ─────────────────────────── 5. CLI ───────────────────────────

function slugify(s) {
  return (s || 'deck')
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60) || 'deck';
}

async function main() {
  const args = process.argv.slice(2);
  const live = args.includes('--live');
  const topic = args.filter((a) => !a.startsWith('--')).join(' ').trim() || MOCK.title;

  let raw = MOCK;
  if (live) {
    console.log(`[1/3] 调用 LLM 生成大纲 JSON：${topic}`);
    raw = await callLLM(topic);
  } else {
    console.log('[1/3] 使用内置 mock JSON（加 --live "主题" 可调真实 LLM）');
  }

  const deck = normalizeDeck(raw);
  const outDir = path.resolve('out');
  const base = path.join(outDir, slugify(deck.title));

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(`${base}.json`, JSON.stringify(deck, null, 2), 'utf-8');
  console.log(`[2/3] 大纲 JSON 已写入：${base}.json（${deck.slides.length} 页）`);

  await buildPptx(deck, `${base}.pptx`);
  console.log(`[3/3] PPTX 已生成：${base}.pptx`);
}

main().catch((err) => {
  console.error('生成失败：', err.message);
  process.exit(1);
});
