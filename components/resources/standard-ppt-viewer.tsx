'use client';

import { useState } from 'react';
import { Download, Loader2, Presentation } from 'lucide-react';
import { getApiToken } from '@/lib/auth-token';
import type { Resource } from '@/lib/types/resource';
import type { StandardPptStyle } from '@/lib/types/standard-ppt';

interface Props {
  resource: Resource;
}

const styleLabels: Record<StandardPptStyle, string> = {
  professional: '专业商务', minimal: '极简', academic: '学术', creative: '创意', dark: '深色科技',
};

export function StandardPptViewer({ resource }: Props) {
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const deck = resource.metadata?.standardPptData;

  async function handleDownload() {
    if (!deck || downloading) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      const token = getApiToken();
      const response = await fetch('/api/v1/smartlearn/ppt?id=' + encodeURIComponent(resource.id), {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!response.ok) {
        let message = `下载失败（HTTP ${response.status}）`;
        try {
          const body = await response.json() as { error?: string };
          if (body.error) message = body.error;
        } catch {
          // Keep the HTTP status message when the response is not JSON.
        }
        throw new Error(message);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      const filename = response.headers.get('Content-Disposition')?.split("UTF-8''")[1];
      anchor.download = filename ? decodeURIComponent(filename) : 'SmartLearn.pptx';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : '下载失败，请重试');
    } finally {
      setDownloading(false);
    }
  }

  if (!deck) {
    return <p className="text-sm text-muted-foreground">此 PPT 数据不可用，请重新生成。</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
          <Presentation className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-base font-semibold text-[var(--foreground)]">{deck.title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {deck.slides.length} 页 · {deck.language === 'zh-CN' ? '中文' : 'English'} · {styleLabels[deck.style]}
          </p>
        </div>
      </div>
      {deck.subtitle && <p className="text-sm text-muted-foreground">{deck.subtitle}</p>}
      {deck.includeImages && !deck.slides.some((slide) => slide.imageData) && (
        <p className="text-sm text-muted-foreground">配图服务未返回图片，已保存文字版。</p>
      )}
      <div className="border-y border-[var(--border)] py-3">
        <p className="text-xs font-medium text-muted-foreground">页面大纲</p>
        <ol className="mt-2 max-h-52 list-decimal space-y-1.5 overflow-y-auto pl-6 text-sm text-[var(--foreground)]">
          {deck.slides.map((slide) => (
            <li key={slide.id} className="break-words">{slide.title}</li>
          ))}
        </ol>
      </div>
      <button
        type="button"
        onClick={handleDownload}
        disabled={downloading}
        className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        {downloading ? '正在生成 PPTX…' : '下载标准 PPTX'}
      </button>
      {downloadError && <p role="alert" className="text-sm text-destructive">{downloadError}</p>}
    </div>
  );
}

