"use client";
import { useState } from 'react';
import { toast } from 'sonner';
import { useSessionsStore } from '@/lib/store/sessions';
import { useLearningPathStore } from '@/lib/store/learning-path';
import { useResourcesStore } from '@/lib/store/resources';
import { flushAccountHistory, refreshAccountHistory } from '@/lib/history/account-client';
import { useAuthStore } from '@/lib/store/auth-store';
export function LearningHistoryPicker({ disabled }: { disabled: boolean }) {
  const { sessions, currentSessionId, switchSession, deleteSession, updateSessionTitle } = useSessionsStore();
  const owner = useAuthStore(s => s.user?.id ?? "");
  const [working, setWorking] = useState(false);
  async function run(action: () => Promise<void>) {
    setWorking(true); try { await action(); } catch (err) { toast.error(err instanceof Error ? err.message : '操作失败'); } finally { setWorking(false); }
  }
  return <div className="flex items-center gap-2">
    <select aria-label="学习历史" value={currentSessionId ?? ''} disabled={disabled || working} className="max-w-44 rounded-lg border bg-background px-2 py-1 text-sm" onChange={event => { const id = event.target.value; void run(async () => { await flushAccountHistory(owner); switchSession(id || null); if (id) { useLearningPathStore.getState().loadPathForSession(id); useResourcesStore.getState().loadResourcesForSession(id); } }); }}>
      <option value="">新建学习</option>{sessions.map(session => <option key={session.id} value={session.id}>{session.title}</option>)}
    </select>
    <button disabled={disabled || working} className="text-xs underline" onClick={() => void run(async () => { await flushAccountHistory(owner); await refreshAccountHistory(owner); })}>刷新</button>
    {currentSessionId && <button disabled={disabled || working} className="text-xs underline" onClick={() => { const title = window.prompt("学习记录名称", sessions.find(session => session.id === currentSessionId)?.title); if (title?.trim()) void run(async () => { updateSessionTitle(currentSessionId, title.trim()); await flushAccountHistory(owner); }); }}>重命名</button>}
    {currentSessionId && <button disabled={disabled || working} className="text-xs text-destructive" onClick={() => { if (window.confirm('删除这条学习记录及其路径、资源和导师对话？')) void run(async () => { await flushAccountHistory(owner); deleteSession(currentSessionId); await flushAccountHistory(owner); }); }}>删除</button>}
  </div>;
}
