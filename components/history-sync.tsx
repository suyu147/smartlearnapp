"use client";
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useAuthStore } from '@/lib/store/auth-store';
import { startAccountSync, refreshAccountHistory } from '@/lib/history/account-client';
import { useHistorySyncStatus } from '@/lib/history/client';
export function HistorySync({ children }: { children: React.ReactNode }) {
  const owner = useAuthStore(s => s.user?.id);
  const pathname = usePathname();
  const status = useHistorySyncStatus();
  useEffect(() => { if (owner) return startAccountSync(owner); }, [owner]);
  useEffect(() => { if (owner) void refreshAccountHistory(owner)?.catch(() => {}); }, [owner, pathname]);
  if (!owner || pathname.startsWith('/auth/')) return <>{children}</>;
  if (status.owner !== owner || !status.ready) return <div className="flex h-screen flex-col items-center justify-center gap-3"><p>{status.error ? '无法加载学习历史' : '正在加载学习历史…'}</p>{status.error && <><p className="text-sm text-destructive">{status.error}</p><button className="rounded border px-4 py-2" onClick={() => void refreshAccountHistory(owner)?.catch(() => {})}>重试</button></>}</div>;
  return <>{status.saving && <div role="status" className="fixed bottom-4 right-4 z-50 rounded border bg-background px-3 py-2 text-xs text-muted-foreground">正在保存学习记录…</div>}{status.error && <div role="alert" className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border bg-background p-3 text-sm shadow-lg"><span>历史同步失败：{status.error}</span><button className="underline" onClick={() => void refreshAccountHistory(owner)?.catch(() => {})}>重试</button></div>}{children}</>;
}
