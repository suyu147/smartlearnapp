"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api-client';
import { useChatStore, type ChatMessage } from '@/lib/store/chat-store';
import { useSessionStore, type Session } from '@/lib/store/session-store';
import { useAuthStore } from '@/lib/store/auth-store';
interface StoredMessage { id: number; role: ChatMessage['role']; content: string; createdAt: string; turnId?: string; metadata?: { renderMode?: string; partial?: boolean }; attachments?: Array<{ type?: string; base64?: string; mimeType?: string; mime_type?: string; url?: string }>; }
interface Page { session: Session; messages: StoredMessage[]; hasMore: boolean; nextBefore: number | null; }
function message(m: StoredMessage): ChatMessage { return { id: String(m.id), role: m.role, content: m.content, timestamp: m.createdAt, turnId: m.turnId, renderMode: m.metadata?.renderMode, imageUrls: (m.attachments ?? []).filter(a => a.type === 'image').flatMap(a => a.base64 ? [`data:${a.mimeType ?? a.mime_type ?? 'image/png'};base64,${a.base64}`] : a.url ? [a.url] : []) }; }
export function useChatHistory() {
  const owner = useAuthStore(s => s.user?.id);
  const activeId = useSessionStore(s => s.activeSessionId);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [moreSessions, setMoreSessions] = useState(false);
  const cursor = useRef<number | null>(null), request = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { const requestRef = request; mounted.current = true; return () => { mounted.current = false; requestRef.current++; }; }, []);
  const load = useCallback(async (id: string, older = false) => {
    if (useChatStore.getState().isStreaming) return;
    const serial = ++request.current;
    setLoading(true);
    try {
      const page = await apiGet<Page>(`/api/v1/sessions/${encodeURIComponent(id)}?limit=100${older && cursor.current ? `&before=${cursor.current}` : ''}`);
      if (!mounted.current || serial !== request.current || useSessionStore.getState().activeSessionId !== id || useAuthStore.getState().user?.id !== owner) return;
      useChatStore.setState(s => ({ sessionId: id, messages: older ? [...page.messages.map(message), ...s.messages] : page.messages.map(message) }));
      cursor.current = page.nextBefore; setHasMore(page.hasMore);
      useSessionStore.getState().updateSession(id, page.session);
    } catch (error) { if (mounted.current && serial === request.current) toast.error(error instanceof Error ? error.message : '加载对话失败'); }
    finally { if (mounted.current && serial === request.current) setLoading(false); }
  }, [owner]);
  const refresh = useCallback(async () => {
    if (useChatStore.getState().isStreaming) return;
    try {
      const sessions = await apiGet<Session[]>('/api/v1/sessions?limit=50');
      if (!mounted.current || useAuthStore.getState().user?.id !== owner) return;
      setMoreSessions(sessions.length === 50);
      const previous = useSessionStore.getState().activeSessionId;
      let selected = previous;
      // An active session outside the first page still needs a detail/ownership check.
      if (previous && !sessions.some(s => s.id === previous)) {
        try { const page = await apiGet<Page>(`/api/v1/sessions/${encodeURIComponent(previous)}?messages=false`); sessions.push(page.session); }
        catch { selected = sessions[0]?.id ?? null; }
      } else selected = previous ?? sessions[0]?.id ?? null;
      if (!mounted.current || useAuthStore.getState().user?.id !== owner || useChatStore.getState().isStreaming) return;
      useSessionStore.setState({ sessions, activeSessionId: selected, sessionsLoaded: true });
      if (selected && selected === previous) await load(selected);
      if (!selected) useChatStore.setState({ sessionId: null, messages: [] });
    } catch (error) { if (mounted.current) toast.error(error instanceof Error ? error.message : '加载历史列表失败'); }
  }, [load, owner]);
  useEffect(() => {
    void refresh();
    const onFocus = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('focus', onFocus); window.addEventListener('online', onFocus); document.addEventListener('visibilitychange', onFocus);
    return () => { window.removeEventListener('focus', onFocus); window.removeEventListener('online', onFocus); document.removeEventListener('visibilitychange', onFocus); };
  }, [refresh]);
  useEffect(() => {
    if (activeId && useChatStore.getState().sessionId !== activeId) {
      useChatStore.setState({ sessionId: activeId, messages: [] }); cursor.current = null; setHasMore(false); void load(activeId);
    }
  }, [activeId, load]);
  const createSession = async () => {
    request.current++;
    const session = await apiPost<Session>('/api/v1/sessions', { title: '新对话' });
    if (!mounted.current || useAuthStore.getState().user?.id !== owner) throw new Error('登录账号已切换');
    useSessionStore.setState(s => ({ sessions: [session, ...s.sessions], activeSessionId: session.id }));
    useChatStore.setState({ sessionId: session.id, messages: [] }); cursor.current = null; setHasMore(false);
    return session.id;
  };
  return { loading, hasMore, moreSessions, refresh, createSession,
    async ensureSession() { return useSessionStore.getState().activeSessionId ?? await createSession(); },
    selectSession(id: string) { if (useChatStore.getState().isStreaming) return; request.current++; useSessionStore.getState().setActiveSession(id); },
    async loadOlder() { if (activeId && hasMore && !loading) await load(activeId, true); },
    async loadMoreSessions() { const store = useSessionStore.getState(); const page = await apiGet<Session[]>(`/api/v1/sessions?offset=${store.sessions.length}&limit=50`); useSessionStore.setState({ sessions: [...store.sessions, ...page.filter(s => !store.sessions.some(old => old.id === s.id))] }); setMoreSessions(page.length === 50); },
    async renameSession(id: string, title: string) { const session = useSessionStore.getState().sessions.find(s => s.id === id); await apiPut(`/api/v1/sessions/${encodeURIComponent(id)}`, { title, expectedRevision: session?.revision ?? 0 }); await refresh(); },
    async deleteSession(id: string) { await apiDelete(`/api/v1/sessions/${encodeURIComponent(id)}`); request.current++; useSessionStore.getState().removeSession(id); if (activeId === id) useChatStore.setState({ sessionId: null, messages: [] }); await refresh(); },
  };
}
