'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import {
  FileText,
  Video,
  HelpCircle,
  Network,
  BookOpen,
  Code2,
  X,
  Loader2,
  Sparkles,
  ArrowRight,
  Trash2,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Presentation,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiFetch } from '@/lib/api-client';
import { fetchResources, saveResources, deleteResources } from '@/lib/api/resources-api';
import { useAuthStore } from '@/lib/store/auth-store';
import { useSettingsStoreV2 } from '@/lib/store/settings-store';
import { ResourceViewer } from '@/components/workspace/resource-viewer';
import { StandardPptViewer } from '@/components/resources/standard-ppt-viewer';
import { RESOURCE_TYPE_LABELS } from '@/lib/types/resource';
import type { Resource, ResourceType } from '@/lib/types/resource';
import type { StandardPptLanguage, StandardPptOutline, StandardPptStyle } from '@/lib/types/standard-ppt';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

// ---------------------------------------------------------------------------
// Resource type catalog
// ---------------------------------------------------------------------------

interface ResourceCardConfig {
  type: ResourceType;
  title: string;
  desc: string;
  placeholder: string;
  icon: typeof FileText;
  iconClass: string;
  accent: string;
}

const RESOURCE_CARDS: ResourceCardConfig[] = [
  {
    type: 'document',
    title: '文档',
    desc: '生成结构化讲解文档，含章节、代码示例和要点提示',
    placeholder: '例如：二叉搜索树的插入与删除',
    icon: FileText,
    iconClass: 'bg-pastel-blue text-blue-600',
    accent: 'from-blue-500/10 to-blue-500/0',
  },
  {
    type: 'video',
    title: '视频',
    desc: '搜索并推荐与主题相关的教学视频资源',
    placeholder: '例如：快速排序算法讲解',
    icon: Video,
    iconClass: 'bg-pastel-rose text-rose-600',
    accent: 'from-rose-500/10 to-rose-500/0',
  },
  {
    type: 'quiz',
    title: '习题',
    desc: '生成包含选择、填空、编程题的练习题集',
    placeholder: '例如：链表反转相关练习',
    icon: HelpCircle,
    iconClass: 'bg-pastel-green text-green-600',
    accent: 'from-green-500/10 to-green-500/0',
  },
  {
    type: 'mindmap',
    title: '思维导图',
    desc: '生成主题知识结构的思维导图',
    placeholder: '例如：数据结构知识体系总览',
    icon: Network,
    iconClass: 'bg-pastel-violet text-violet-600',
    accent: 'from-violet-500/10 to-violet-500/0',
  },
  {
    type: 'reading',
    title: '扩展阅读',
    desc: '生成主题相关的拓展阅读卡片与链接',
    placeholder: '例如：图论进阶推荐资料',
    icon: BookOpen,
    iconClass: 'bg-pastel-amber text-amber-600',
    accent: 'from-amber-500/10 to-amber-500/0',
  },
  {
    type: 'code',
    title: '代码',
    desc: '生成主题相关的可运行代码案例',
    placeholder: '例如：红黑树的 Python 实现',
    icon: Code2,
    iconClass: 'bg-pastel-cyan text-cyan-600',
    accent: 'from-cyan-500/10 to-cyan-500/0',
  },
  {
    type: 'ppt',
    title: 'PPT',
    desc: '生成可下载的标准 PowerPoint 演示文稿，支持配图与多种风格',
    placeholder: '例如：人工智能在教育中的应用',
    icon: Presentation,
    iconClass: 'bg-pastel-violet text-violet-600',
    accent: 'from-violet-500/10 to-violet-500/0',
  },
];

// ---------------------------------------------------------------------------
// Generated resource entry shape
// ---------------------------------------------------------------------------

/**
 * Resolve display metadata for a resource type.
 * History entries may contain types outside RESOURCE_CARDS (e.g. `ppt`
 * produced by the learning path), so a fallback config is required here.
 */
function getCardMeta(resource: Resource): ResourceCardConfig {
  const { type } = resource;
  return (
    RESOURCE_CARDS.find((card) => card.type === type && (type !== 'ppt' || resource.sourceAgent === 'resource-ppt')) ?? {
      type,
      title: RESOURCE_TYPE_LABELS[type] ?? type,
      desc: '',
      placeholder: '',
      icon: Presentation,
      iconClass: 'bg-pastel-violet text-violet-600',
      accent: 'from-violet-500/10 to-violet-500/0',
    }
  );
}

interface GeneratedEntry {
  resource: Resource;
  isLoading?: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ResourcesPage() {
  const [activeType, setActiveType] = useState<ResourceCardConfig | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [generating, setGenerating] = useState(false);
  const [entries, setEntries] = useState<GeneratedEntry[]>([]);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [pptSlideCount, setPptSlideCount] = useState('8');
  const [pptLanguage, setPptLanguage] = useState<StandardPptLanguage>('zh-CN');
  const [pptStyle, setPptStyle] = useState<StandardPptStyle>('professional');
  const [pptIncludeImages, setPptIncludeImages] = useState(false);
  const [pptResult, setPptResult] = useState<Resource | null>(null);
  const [pptError, setPptError] = useState<string | null>(null);
  const [pptOutline, setPptOutline] = useState<StandardPptOutline | null>(null);

  const userId = useAuthStore((s) => s.user?.id) ?? '';
  const settings = useSettingsStoreV2();

  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  useEffect(() => {
    let alive = true;
    async function refresh() {
      if (!userId || entriesRef.current.some(entry => entry.isLoading)) return;
      try {
        const serverResources = await fetchResources(userId);
        if (!alive) return;
        setEntries(serverResources.filter(r => r.status !== 'generating').map(resource => ({ resource })));
        setActiveIndex(null);
      } catch (error) { if (alive) toast.error(error instanceof Error ? error.message : '加载资源失败'); }
    }
    const onRefresh = () => { if (document.visibilityState === 'visible') void refresh(); };
    setEntries([]); setActiveIndex(null);
    void refresh();
    window.addEventListener('focus', onRefresh); window.addEventListener('online', onRefresh); document.addEventListener('visibilitychange', onRefresh);
    return () => { alive = false; window.removeEventListener('focus', onRefresh); window.removeEventListener('online', onRefresh); document.removeEventListener('visibilitychange', onRefresh); };
  }, [userId]);

  /** Build aiConfig from the smartlearn settings store. */
  const buildAiConfig = useCallback(() => {
    const config: {
      providerId?: string;
      modelId?: string;
      apiKey?: string;
      baseUrl?: string;
    } = {};
    if (settings.smartlearnProviderId) config.providerId = settings.smartlearnProviderId;
    if (settings.smartlearnModelId) config.modelId = settings.smartlearnModelId;
    if (settings.smartlearnApiKey) config.apiKey = settings.smartlearnApiKey;
    if (settings.smartlearnBaseUrl) config.baseUrl = settings.smartlearnBaseUrl;
    return config;
  }, [settings]);

  /** Open the input modal for a given resource card. */
  const handleCardClick = useCallback((card: ResourceCardConfig) => {
    setActiveType(card);
    setInputValue('');
    setPptResult(null);
    setPptError(null);
    setPptOutline(null);
    if (card.type === 'ppt') {
      setPptSlideCount('8');
      setPptLanguage('zh-CN');
      setPptStyle('professional');
      setPptIncludeImages(false);
    }
  }, []);

  /** Close the modal. */
  const handleCloseModal = useCallback(() => {
    setActiveType(null);
    setInputValue('');
    setPptResult(null);
    setPptError(null);
    setPptOutline(null);
  }, []);

  /** Submit the resource name and trigger generation. */
  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!activeType || !inputValue.trim() || generating) return;

      const name = inputValue.trim();
      const type = activeType.type;

      if (type === 'ppt') {
        const slideCount = Number(pptSlideCount);
        if (!Number.isInteger(slideCount) || slideCount < 3 || slideCount > 20) return;
        setPptError(null);
        setGenerating(true);
        try {
          const aiConfig = buildAiConfig();
          const response = await apiFetch<{ resource: Resource } | { outline: StandardPptOutline }>('/api/v1/smartlearn/ppt', {
            method: 'POST',
            body: JSON.stringify({
              action: pptOutline ? 'generate' : 'outline',
              topic: name,
              slideCount,
              language: pptLanguage,
              style: pptStyle,
              includeImages: pptIncludeImages,
              outline: pptOutline ?? undefined,
              aiConfig: { providerId: aiConfig.providerId, modelId: aiConfig.modelId, apiKey: aiConfig.apiKey },
            }),
          });
          if (useAuthStore.getState().user?.id !== (userId || undefined)) return;
          if ('outline' in response) {
            setPptOutline(response.outline);
          } else {
            const { resource } = response;
            setActiveIndex(null);
            setEntries((prev) => [{ resource }, ...prev.filter((entry) => entry.resource.id !== resource.id)]);
            setPptResult(resource);
          }
        } catch (error) {
          setPptError(error instanceof Error ? error.message : 'PPT 生成失败');
        } finally {
          setGenerating(false);
        }
        return;
      }

      // Optimistically add a loading entry and select it.
      // 持久化后 id 会作为数据库主键，优先使用全局唯一 ID
      const placeholderId =
        globalThis.crypto?.randomUUID?.() ?? `gen_${Date.now()}`;
      const loadingEntry: GeneratedEntry = {
        resource: {
          id: placeholderId,
          userId: '',
          type,
          title: name,
          content: '',
          metadata: { knowledgePoints: [name] },
          sourceAgent: type,
          status: 'generating',
          createdAt: new Date().toISOString(),
        },
        isLoading: true,
      };

      const newIndex = entries.length;
      setEntries((prev) => [...prev, loadingEntry]);
      setActiveIndex(newIndex);
      setGenerating(true);
      handleCloseModal();

      try {
        const generated = await apiFetch<Pick<Resource, 'type' | 'title' | 'content' | 'metadata'>>('/api/v1/resources/generate', {
          method: 'POST',
          body: JSON.stringify({ type, name, aiConfig: buildAiConfig() }),
        });

        const finished: Resource = {
          id: placeholderId,
          userId: '',
          type: generated.type,
          title: generated.title,
          content: generated.content,
          metadata: generated.metadata,
          sourceAgent: type,
          status: 'ready',
          createdAt: new Date().toISOString(),
        };

        const [saved] = await saveResources(userId, [finished]);
        setEntries(prev => prev.map(entry => entry.resource.id === placeholderId ? { resource: saved } : entry));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setEntries((prev) =>
          prev.map((entry) =>
            entry.resource.id === placeholderId
              ? {
                  resource: { ...entry.resource, status: 'failed' },
                  error: message,
                }
              : entry,
          ),
        );
      } finally {
        setGenerating(false);
      }
    },
    [activeType, inputValue, generating, entries.length, handleCloseModal, buildAiConfig, userId, pptSlideCount, pptLanguage, pptStyle, pptIncludeImages, pptOutline],
  );

  /** Remove an entry. */
  const handleRemove = useCallback(async (index: number) => {
    const resource = entries[index]?.resource;
    if (!resource) return;
    try {
      await deleteResources([resource.id]);
      setEntries(prev => prev.filter(entry => entry.resource.id !== resource.id));
      setActiveIndex(null);
    } catch (error) { toast.error(error instanceof Error ? error.message : '删除失败'); }
  }, [entries]);
  const handleClearAll = useCallback(async () => {
    try { await deleteResources(); setEntries([]); setActiveIndex(null); }
    catch (error) { toast.error(error instanceof Error ? error.message : '删除失败'); }
  }, []);

  /** Regenerate an entry using its original name. */
  const handleRegenerate = useCallback(
    async (index: number) => {
      const entry = entries[index];
      if (!entry) return;
      const name = entry.resource.metadata?.knowledgePoints?.[0] ?? entry.resource.title;
      const type = entry.resource.type;
      const resourceId = entry.resource.id;

      setEntries((prev) =>
        prev.map((e) =>
          e.resource.id === resourceId
            ? {
                resource: { ...e.resource, status: 'generating', content: '' },
                isLoading: true,
                error: undefined,
              }
            : e,
        ),
      );
      setActiveIndex(index);

      try {
        // apiFetch auto-unwraps the { success, data } envelope.
        const res = await apiFetch<{
          type: ResourceType;
          title: string;
          content: string;
          metadata?: Record<string, unknown>;
        }>('/api/v1/resources/generate', {
          method: 'POST',
          body: JSON.stringify({ type, name, aiConfig: buildAiConfig() }),
        });

        const finished: Resource = {
          id: entry.resource.id,
          sessionId: entry.resource.sessionId,
          revision: entry.resource.revision,
          userId: '',
          type: res.type,
          title: res.title,
          content: res.content,
          metadata: {
            ...res.metadata,
            origin: entry.resource.metadata?.origin,
            nodeId: entry.resource.metadata?.nodeId,
          },
          sourceAgent: entry.resource.sourceAgent,
          status: 'ready',
          createdAt: new Date().toISOString(),
        };
        const [saved] = await saveResources(userId, [finished]);
        setEntries(prev => prev.map(e => e.resource.id === resourceId ? { resource: saved } : e));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setEntries((prev) =>
          prev.map((e) =>
            e.resource.id === resourceId
              ? { resource: { ...e.resource, status: 'failed' }, error: message }
              : e,
          ),
        );
      }
    },
    [entries, buildAiConfig, userId],
  );

  const activeEntry = activeIndex !== null ? entries[activeIndex] : null;

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="app-page-bg min-h-full pb-20">
      <div className="mx-auto w-full max-w-[1400px] px-4 pt-6 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <p className="chip-primary">RESOURCES</p>
          <h1 className="mt-2 text-[28px] font-bold tracking-tight text-[var(--foreground)] sm:text-[32px]">
            学习资源
          </h1>
          <p className="mt-1.5 text-[13.5px] text-[var(--muted-foreground)]">
            选择资源类型，输入主题，一键生成学习资源或可下载的标准 PPTX
          </p>
        </div>

        {/* Resource cards grid */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {RESOURCE_CARDS.map((card) => {
            const Icon = card.icon;
            return (
              <button
                key={card.type}
                onClick={() => handleCardClick(card)}
                disabled={generating}
                className={cn(
                  'group relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 text-left transition-all hover:border-blue-300 hover:shadow-lg hover:shadow-blue-500/10 disabled:cursor-not-allowed disabled:opacity-60',
                )}
              >
                {/* gradient wash */}
                <div
                  className={cn(
                    'pointer-events-none absolute inset-0 bg-gradient-to-br opacity-0 transition-opacity group-hover:opacity-100',
                    card.accent,
                  )}
                />
                <div className="relative flex items-start gap-4">
                  <div
                    className={cn(
                      'flex h-12 w-12 shrink-0 items-center justify-center rounded-xl',
                      card.iconClass,
                    )}
                  >
                    <Icon className="h-5 w-5" strokeWidth={2} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-[15px] font-semibold text-[var(--foreground)]">
                      {card.title}
                    </h3>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--muted-foreground)]">
                      {card.desc}
                    </p>
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-[var(--muted-foreground)] opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" />
                </div>
              </button>
            );
          })}
        </div>

        {/* Generated resources section */}
        {entries.length > 0 && (
          <div className="mt-10">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="chip-primary">HISTORY</p>
                <h2 className="mt-2 text-[20px] font-bold tracking-tight text-[var(--foreground)]">
                  已生成资源
                </h2>
              </div>
              <button
                onClick={handleClearAll}
                className="text-[12.5px] font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--destructive)]"
              >
                清空全部
              </button>
            </div>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[320px_1fr]">
              {/* Resource list */}
              <div className="space-y-2">
                {entries.map((entry, idx) => {
                  const card = getCardMeta(entry.resource);
                  const Icon = card.icon;
                  const active = idx === activeIndex;
                  return (
                    <div
                      key={entry.resource.id}
                      onClick={() => setActiveIndex((cur) => (cur === idx ? null : idx))}
                      className={cn(
                        'group flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-all',
                        active
                          ? 'border-blue-400 bg-blue-50/60 shadow-sm'
                          : 'border-[var(--border)] bg-[var(--card)] hover:border-blue-200 hover:bg-blue-50/30',
                      )}
                    >
                      <div
                        className={cn(
                          'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                          card.iconClass,
                        )}
                      >
                        <Icon className="h-4 w-4" strokeWidth={2} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-[13px] font-medium text-[var(--foreground)]">
                          {entry.resource.metadata?.knowledgePoints?.[0] ?? entry.resource.title}
                        </p>
                        <div className="mt-0.5 flex items-center gap-1.5">
                          <span className="text-[11px] text-[var(--muted-foreground)]">
                            {card.title}
                          </span>
                          {entry.resource.metadata?.origin === 'learning-path' && (
                            <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] text-accent-foreground">来自学习路径</span>
                          )}
                          {entry.isLoading && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-blue-600">
                              <Loader2 className="h-2.5 w-2.5 animate-spin" />
                              生成中
                            </span>
                          )}
                          {!entry.isLoading && entry.resource.status === 'ready' && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] text-green-600">
                              <CheckCircle2 className="h-2.5 w-2.5" />
                              就绪
                            </span>
                          )}
                          {!entry.isLoading && entry.resource.status === 'failed' && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] text-red-600">
                              <AlertCircle className="h-2.5 w-2.5" />
                              失败
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        {/* 动态课件有独立的生成流程，不支持在此重新生成 */}
                        {entry.resource.type !== 'ppt' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRegenerate(idx);
                            }}
                            disabled={entry.isLoading}
                            className="rounded-md p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-blue-100 hover:text-blue-600 disabled:opacity-40"
                            title="重新生成"
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemove(idx);
                          }}
                          className="rounded-md p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-red-100 hover:text-red-600"
                          title="删除"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Active resource viewer */}
              <div className="relative min-h-[400px] rounded-2xl border border-[var(--border)] bg-[var(--card)] p-1">
                {activeEntry && !activeEntry.isLoading && (
                  <button
                    type="button"
                    onClick={() => setActiveIndex(null)}
                    className="absolute right-3 top-3 z-10 rounded-md border border-[var(--border)] bg-[var(--card)] p-1.5 text-[var(--muted-foreground)] shadow-sm transition-colors hover:bg-blue-50 hover:text-blue-600"
                    title="收起详情"
                    aria-label="收起详情"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
                {activeEntry ? (
                  activeEntry.isLoading ? (
                    <div className="flex h-[400px] flex-col items-center justify-center gap-3">
                      <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                      <p className="text-[13px] text-[var(--muted-foreground)]">
                        正在生成「{activeEntry.resource.metadata?.knowledgePoints?.[0] ?? activeEntry.resource.title}」…
                      </p>
                      <p className="text-[11px] text-[var(--muted-foreground)]/70">
                        这可能需要几十秒，请稍候
                      </p>
                    </div>
                  ) : activeEntry.error ? (
                    <div className="flex h-[400px] flex-col items-center justify-center gap-3 px-6 text-center">
                      <AlertCircle className="h-8 w-8 text-red-500" />
                      <p className="text-[14px] font-medium text-[var(--foreground)]">
                        生成失败
                      </p>
                      <p className="max-w-md text-[12px] text-[var(--muted-foreground)]">
                        {activeEntry.error}
                      </p>
                      <button
                        onClick={() => handleRegenerate(activeIndex!)}
                        className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-gradient-brand px-4 py-2 text-[12.5px] font-semibold text-white shadow-sm"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        重试
                      </button>
                    </div>
                  ) : activeEntry.resource.sourceAgent === 'resource-ppt' ? (
                    <div className="p-5"><StandardPptViewer key={activeEntry.resource.id} resource={activeEntry.resource} /></div>
                  ) : (
                    <ResourceViewer key={activeEntry.resource.id} resource={activeEntry.resource} />
                  )
                ) : (
                  <div className="flex h-[400px] flex-col items-center justify-center gap-2 text-center">
                    <Sparkles className="h-10 w-10 text-[var(--muted-foreground)]/30" />
                    <p className="text-[13px] text-[var(--muted-foreground)]">
                      选择左侧已生成的资源查看内容
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input modal */}
      <Dialog open={activeType !== null} onOpenChange={(open) => !open && !generating && handleCloseModal()}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[460px]">
          <DialogHeader>
            <div className="mb-2 flex items-center gap-3">
              {activeType && (
                <div
                  className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-xl',
                    activeType.iconClass,
                  )}
                >
                  <activeType.icon className="h-5 w-5" strokeWidth={2} />
                </div>
              )}
              <div>
                <DialogTitle className="text-[17px] font-bold">
                  {pptResult ? 'PPT 已保存' : pptOutline ? '审阅 PPT 大纲' : '生成' + (activeType?.title ?? '')}
                </DialogTitle>
                <DialogDescription className="mt-0.5 text-[12.5px]">
                  {pptResult ? '可在资源中心历史记录中再次下载' : pptOutline ? pptSlideCount + ' 页 · ' + inputValue : '输入主题或知识点名称'}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {pptResult ? (
            <StandardPptViewer resource={pptResult} />
          ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {pptOutline ? (
              <fieldset disabled={generating} className="space-y-3">
                <label className="block text-sm font-medium">
                  文稿标题
                  <input
                    required
                    maxLength={60}
                    value={pptOutline.title}
                    onChange={(event) => setPptOutline({ ...pptOutline, title: event.target.value })}
                    className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                  />
                </label>
                <ol className="max-h-[42dvh] space-y-3 overflow-y-auto pr-2">
                  {pptOutline.slides.map((slide, index) => (
                    <li key={index} className="space-y-2 border-t border-border pt-3">
                      <p className="text-xs font-medium text-muted-foreground">第 {index + 1} 页{index === 0 ? ' · 封面' : index === pptOutline.slides.length - 1 ? ' · 总结' : ''}</p>
                      {index > 0 && (
                        <input
                          aria-label={`第 ${index + 1} 页标题`}
                          required
                          maxLength={60}
                          value={slide.title}
                          onChange={(event) => setPptOutline({
                            ...pptOutline,
                            slides: pptOutline.slides.map((entry, i) => i === index ? { ...entry, title: event.target.value } : entry),
                          })}
                          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                        />
                      )}
                      <textarea
                        aria-label={`第 ${index + 1} 页内容提纲`}
                        required
                        maxLength={220}
                        rows={2}
                        value={slide.purpose}
                        onChange={(event) => setPptOutline({
                          ...pptOutline,
                          slides: pptOutline.slides.map((entry, i) => i === index ? { ...entry, purpose: event.target.value } : entry),
                        })}
                        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                      />
                    </li>
                  ))}
                </ol>
              </fieldset>
            ) : (
            <div>
              <label
                htmlFor="resource-name"
                className="mb-1.5 block text-[12.5px] font-medium text-[var(--foreground)]"
              >
                资源主题
              </label>
              <input
                id="resource-name"
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder={activeType?.placeholder}
                maxLength={activeType?.type === 'ppt' ? 200 : undefined}
                autoFocus
                disabled={generating}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--card)] px-3.5 py-2.5 text-[13.5px] text-[var(--foreground)] outline-none transition-colors placeholder:text-[var(--muted-foreground)]/60 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:opacity-60"
              />
              <p className="mt-1.5 text-[11px] text-[var(--muted-foreground)]">
                提示：输入越具体，生成质量越高（例如具体算法名、数据结构名称）
              </p>
            </div>
            )}

            {activeType?.type === 'ppt' && !pptOutline && (
              <div className="space-y-3 rounded-xl border border-violet-100 bg-violet-50/50 p-3">
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-[12.5px] font-medium text-[var(--foreground)]">
                    页数
                    <input
                      type="number"
                      min={3}
                      max={20}
                      required
                      step={1}
                      value={pptSlideCount}
                      onChange={(event) => setPptSlideCount(event.target.value)}
                      disabled={generating}
                      className="mt-1.5 w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-[13px] font-normal outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 disabled:opacity-60"
                    />
                  </label>
                  <label className="text-[12.5px] font-medium text-[var(--foreground)]">
                    语言
                    <select
                      value={pptLanguage}
                      onChange={(event) => setPptLanguage(event.target.value as StandardPptLanguage)}
                      disabled={generating}
                      className="mt-1.5 w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-[13px] font-normal outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 disabled:opacity-60"
                    >
                      <option value="zh-CN">简体中文</option>
                      <option value="en-US">English</option>
                    </select>
                  </label>
                </div>
                <label className="block text-[12.5px] font-medium text-[var(--foreground)]">
                  风格
                  <select
                    value={pptStyle}
                    onChange={(event) => setPptStyle(event.target.value as StandardPptStyle)}
                    disabled={generating}
                    className="mt-1.5 w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-[13px] font-normal outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 disabled:opacity-60"
                  >
                    <option value="professional">专业商务</option>
                    <option value="minimal">极简</option>
                    <option value="academic">学术</option>
                    <option value="creative">创意</option>
                    <option value="dark">深色科技</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 text-[12.5px] text-[var(--foreground)]">
                  <input
                    type="checkbox"
                    checked={pptIncludeImages}
                    onChange={(event) => setPptIncludeImages(event.target.checked)}
                    disabled={generating}
                    className="h-4 w-4 rounded border-violet-300 text-violet-600 focus:ring-violet-500"
                  />
                  为页面生成配图（需要配置图片生成服务）
                </label>
              </div>
            )}

            {activeType?.type === 'ppt' && pptError && <p role="alert" className="text-sm text-destructive">{pptError}</p>}
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={pptOutline ? () => { setPptOutline(null); setPptError(null); } : handleCloseModal}
                disabled={generating}
                className="rounded-full border border-[var(--border)] px-4 py-2 text-[12.5px] font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)] disabled:opacity-60"
              >
                {pptOutline ? '返回设置' : '取消'}
              </button>
              <button
                type="submit"
                disabled={!inputValue.trim() || generating}
                className="inline-flex items-center gap-1.5 rounded-full bg-gradient-brand px-4 py-2 text-[12.5px] font-semibold text-white shadow-sm shadow-blue-500/30 transition-all hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
              >
                {generating ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {activeType?.type === 'ppt' ? pptOutline ? '正在生成页面…' : '正在生成大纲…' : '生成中…'}
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3.5 w-3.5" />
                    {activeType?.type === 'ppt' ? pptOutline ? '确认并生成 PPT' : '生成大纲' : '生成资源'}
                  </>
                )}
              </button>
            </div>
          </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
