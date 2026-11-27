'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ChevronDown, Clock3, LoaderCircle, Presentation, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConceptPanel } from '@/components/workspace/concept-panel';
import { InlineCodeRunner } from '@/components/workspace/inline-code-runner';
import { PPTViewer } from '@/components/workspace/ppt-viewer';
import { apiDelete, apiGet, consumeSSEStream } from '@/lib/api-client';
import { getApiToken } from '@/lib/auth-token';
import type { StreamEvent } from '@/lib/deeptutor/core/types';
import { useRefreshOnFocus } from '@/lib/hooks/use-refresh-on-focus';
import { useAuthStore } from '@/lib/store/auth-store';
import { useSettingsStoreV2 } from '@/lib/store/settings-store';
import type { Scene, CodeButton } from '@/lib/types/stage';
import type { ConceptHotspot } from '@/lib/types/slides';

interface CoursewareEntry {
  id: string;
  title: string;
  createdAt: string;
}

const endpoint = '/api/v1/smartlearn/courseware';

export default function SmartLearnPage() {
  const userId = useAuthStore(state => state.user?.id);
  return <CoursewareWorkspace key={userId ?? ''} userId={userId} />;
}

function CoursewareWorkspace({ userId }: { userId?: string }) {
  const settings = useSettingsStoreV2();
  const [topic, setTopic] = useState('');
  const [history, setHistory] = useState<CoursewareEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(!!userId);
  const [active, setActive] = useState<CoursewareEntry | null>(null);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [progress, setProgress] = useState('');
  const [busy, setBusy] = useState<'generate' | 'load' | 'delete' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [hotspot, setHotspot] = useState<ConceptHotspot | null>(null);
  const [code, setCode] = useState<CodeButton | null>(null);
  const request = useRef<AbortController | null>(null);
  const historyRequest = useRef(0);
  const mounted = useRef(false);

  const refreshHistory = useCallback(async () => {
    if (!userId) return;
    const revision = ++historyRequest.current;
    try {
      const result = await apiGet<{ history: CoursewareEntry[] }>(endpoint);
      if (mounted.current && revision === historyRequest.current) setHistory(result.history);
    } catch (err) {
      if (mounted.current && revision === historyRequest.current) setError(err instanceof Error ? err.message : '课件历史加载失败');
    } finally {
      if (mounted.current && revision === historyRequest.current) setHistoryLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    mounted.current = true;
    void refreshHistory();
    return () => {
      mounted.current = false;
      request.current?.abort();
    };
  }, [refreshHistory]);

  useRefreshOnFocus(refreshHistory, !busy && !!userId);

  function clearDetails() {
    setHotspot(null);
    setCode(null);
  }

  async function generate(event: FormEvent) {
    event.preventDefault();
    if (busy || !userId || !topic.trim()) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy('generate');
    setError('');
    setConfirmDelete(null);
    setActive(null);
    setScenes([]);
    clearDetails();
    setProgress('正在规划课件…');
    let saved = false;
    let streamError = '';
    try {
      const token = getApiToken();
      const response = await fetch(endpoint, {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          topic: topic.trim(),
          options: {
            maxPages: settings.pptMaxPages ?? undefined,
            generateImages: settings.generatePptImages,
            includeInteractive: settings.enablePptInteractive,
            includeQuiz: settings.enablePptQuiz,
          },
          aiConfig: {
            providerId: settings.smartlearnProviderId || undefined,
            modelId: settings.smartlearnModelId || undefined,
            apiKey: settings.smartlearnApiKey || undefined,
            baseUrl: settings.smartlearnBaseUrl || undefined,
          },
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || '课件生成请求失败');
      }
      await consumeSSEStream<StreamEvent>(response, {
        signal: controller.signal,
        onError: err => { streamError = err.message; },
        onEvent: ({ type, content, metadata }) => {
          if (controller.signal.aborted) return;
          if (type === 'error') streamError = content;
          if (type === 'progress' && typeof metadata.message === 'string') setProgress(metadata.message);
          if (metadata.learnEventType === 'scene_ready') {
            const scene = metadata.scene as Scene;
            setScenes(previous => [...previous.filter(item => item.id !== scene.id), scene].sort((a, b) => a.order - b.order));
          }
          if (metadata.learnEventType === 'ppt_ready') {
            const entry = metadata.courseware as CoursewareEntry;
            setActive(entry);
            setScenes(metadata.scenes as Scene[]);
            setHistory(previous => [entry, ...previous.filter(item => item.id !== entry.id)]);
            saved = true;
          }
        },
      });
      if (controller.signal.aborted) return;
      if (!saved) throw new Error(streamError || '连接已中断，可刷新历史查看课件是否已保存');
      await refreshHistory();
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : '生成失败');
    } finally {
      if (!controller.signal.aborted) {
        setBusy(null);
        setProgress('');
      }
      request.current = null;
    }
  }

  async function openCourseware(entry: CoursewareEntry) {
    setBusy('load');
    setError('');
    setConfirmDelete(null);
    try {
      const detail = await apiGet<CoursewareEntry & { scenes: Scene[] }>(`${endpoint}/${encodeURIComponent(entry.id)}`);
      if (!mounted.current) return;
      setActive(entry);
      setScenes(detail.scenes);
      clearDetails();
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : '课件加载失败');
    } finally {
      if (mounted.current) setBusy(null);
    }
  }

  async function removeCourseware(id: string) {
    historyRequest.current++;
    setBusy('delete');
    setError('');
    try {
      await apiDelete(`${endpoint}?id=${encodeURIComponent(id)}`);
      if (!mounted.current) return;
      setHistory(previous => previous.filter(entry => entry.id !== id));
      if (active?.id === id) {
        setActive(null);
        setScenes([]);
        clearDetails();
      }
      setConfirmDelete(null);
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : '课件删除失败');
      await refreshHistory();
    } finally {
      if (mounted.current) setBusy(null);
    }
  }

  return (
    <div className="app-page-bg min-h-full px-4 pb-12 pt-8 sm:px-8">
      <div className="mx-auto max-w-[1400px]">
        <h1 className="text-3xl font-bold tracking-tight">动态课件</h1>
        <div className="mt-6 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_19rem]">
          <div className="min-w-0 space-y-5">
            <form onSubmit={generate} className="rounded-xl border bg-card p-5 sm:p-6">
              <label htmlFor="courseware-topic" className="block text-sm font-semibold">课件主题</label>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <Input id="courseware-topic" value={topic} onChange={event => setTopic(event.target.value)}
                  maxLength={200} placeholder="例如，二叉搜索树的插入与删除" disabled={!!busy} required />
                <Button type="submit" disabled={!userId || !!busy || !topic.trim()}>
                  {busy === 'generate' ? <LoaderCircle className="animate-spin" /> : <Presentation />}
                  {busy === 'generate' ? '正在生成' : '生成课件'}
                </Button>
              </div>
              <details className="group mt-4">
                <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-sm font-medium text-muted-foreground [&::-webkit-details-marker]:hidden">
                  课件设置 <ChevronDown className="size-4 group-open:rotate-180" />
                </summary>
                <fieldset disabled={!!busy} className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-3 rounded-lg border p-3 text-sm">
                  <label className="flex items-center gap-2">
                    最多页数
                    <Input type="number" min={1} max={30} className="h-8 w-20"
                      placeholder="自动" value={settings.pptMaxPages ?? ''}
                      onChange={event => {
                        const pages = event.target.valueAsNumber;
                        settings.setPptMaxPages(Number.isFinite(pages) ? Math.max(1, Math.min(30, Math.floor(pages))) : null);
                      }} />
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={settings.generatePptImages} onChange={event => settings.setGeneratePptImages(event.target.checked)} />配图
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={settings.enablePptInteractive} onChange={event => settings.setEnablePptInteractive(event.target.checked)} />交互 HTML
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={settings.enablePptQuiz} onChange={event => settings.setEnablePptQuiz(event.target.checked)} />随堂测验
                  </label>
                </fieldset>
              </details>
              {!userId && <p className="mt-3 text-sm text-muted-foreground">登录后即可生成和保存课件。</p>}
            </form>

            {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-card px-4 py-3 text-sm text-destructive">{error}</p>}
            <section aria-label="课件预览" className="overflow-hidden rounded-xl border bg-card">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-5 py-3">
                <h2 className="min-w-0 break-words text-sm font-semibold">{active?.title || '课件预览'}</h2>
                <p aria-live="polite" className="text-xs text-muted-foreground">{progress || (busy === 'load' ? '正在加载…' : scenes.length ? `${scenes.length} 页` : '')}</p>
              </div>
              {scenes.length ? (
                <div className="grid min-h-[400px] xl:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="min-w-0 p-2 sm:p-4">
                    <PPTViewer key={busy === 'generate' || !active ? 'draft' : active.id} scenes={scenes}
                      onHotspotClick={item => { setHotspot(item); setCode(null); }}
                      onCodeButtonClick={item => { setCode(item); setHotspot(null); }} />
                  </div>
                  {(hotspot || code) && <div className="min-w-0 border-t xl:w-72 xl:border-t-0">
                    {hotspot && <ConceptPanel hotspot={hotspot} onClose={() => setHotspot(null)} />}
                    {code && <InlineCodeRunner code={code.code} language={code.language} label={code.label} stdin={code.stdin} onClose={() => setCode(null)} />}
                  </div>}
                </div>
              ) : (
                <div className="grid min-h-72 place-content-center justify-items-center gap-3 p-6 text-center text-sm text-muted-foreground">
                  {busy === 'generate' || busy === 'load' ? <LoaderCircle className="size-6 animate-spin" /> : <Presentation className="size-6" />}
                  {busy === 'generate' ? '生成的页面会在这里逐页显示' : busy === 'load' ? '正在读取课件' : '输入主题生成课件，或打开历史记录'}
                </div>
              )}
            </section>
          </div>
          <aside aria-label="课件历史" className="rounded-xl border bg-card">
            <h2 className="flex items-center gap-2 border-b px-4 py-3 text-sm font-semibold"><Clock3 className="size-4" />课件历史</h2>
            {historyLoading ? (
              <p className="px-4 py-5 text-sm text-muted-foreground">正在加载历史…</p>
            ) : history.length ? (
              <ul className="max-h-[70vh] divide-y overflow-auto">
                {history.map(entry => <li key={entry.id} className={active?.id === entry.id ? 'bg-accent/60' : ''}>
                  <div className="flex items-center gap-1 px-2">
                    <button type="button" disabled={!!busy} onClick={() => void openCourseware(entry)}
                      aria-current={active?.id === entry.id ? 'true' : undefined}
                      className="min-w-0 flex-1 rounded-md px-2 py-3 text-left hover:bg-accent disabled:opacity-60">
                      <span className="block truncate text-sm font-medium">{entry.title}</span>
                      <time className="mt-1 block text-xs text-muted-foreground" dateTime={entry.createdAt}>
                        {new Date(entry.createdAt).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })}
                      </time>
                    </button>
                    <Button variant="ghost" size="icon" disabled={!!busy} aria-label={`删除课件 ${entry.title}`}
                      onClick={() => setConfirmDelete(entry.id)}><Trash2 /></Button>
                  </div>
                  {confirmDelete === entry.id && <div className="flex items-center justify-end gap-2 px-3 pb-3">
                    <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => setConfirmDelete(null)}>取消</Button>
                    <Button variant="destructive" size="sm" disabled={!!busy} onClick={() => void removeCourseware(entry.id)}>确认删除</Button>
                  </div>}
                </li>)}
              </ul>
            ) : <p className="px-4 py-5 text-sm text-muted-foreground">暂无历史课件</p>}
          </aside>
        </div>
      </div>
    </div>
  );
}
