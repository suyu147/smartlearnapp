'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { ProfileCard } from '@/components/profile/profile-card';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/lib/store/auth-store';
import { useLearningProfileStore } from '@/lib/store/learning-profile';
import { getApiToken } from '@/lib/auth-token';
import type { LearningProfile } from '@/lib/types/profile';

export default function ProfilePage() {
  const userId = useAuthStore(s => s.user?.id);
  const stored = useLearningProfileStore(s => s.profile);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const profile = stored?.userId === userId ? stored : null;
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    async function load() {
      try {
        const token = getApiToken();
        const response = await fetch('/api/v1/smartlearn/profile', {
          signal: controller.signal, headers: token ? { Authorization: 'Bearer ' + token } : {},
        });
        if (!response.ok) throw new Error('学习画像加载失败，请重试。');
        const { profile: p } = await response.json();
        if (controller.signal.aborted) return;
        const result: LearningProfile = { id: p.id, userId: p.userId, version: p.version, dimensions: p.dimensions, updatedAt: p.updatedAt, conversationHistory: [] };
        useLearningProfileStore.getState().setProfile(result);
      } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : '无法连接服务器。'); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    if (userId) void load();
    else { setLoading(false); setError('请先登录后查看学习画像。'); }
    return () => controller.abort();
  }, [userId, retry]);

  return <main className="mx-auto max-w-3xl px-4 py-8 sm:px-8 sm:py-10">
    <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="text-2xl font-semibold tracking-tight">你的学习画像</h1><p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground">已确认的信息用于后续学习路径和资源选择。留空的项目会如实显示，不会推测你的学习情况。</p></div>
      <Button asChild variant="outline"><Link href="/smartlearn">开始智能学习<ArrowRight className="ml-1 h-4 w-4" /></Link></Button>
    </header>
    {error && <div role="alert" className="mb-5 rounded-lg border border-destructive/30 p-4 text-sm"><p>{error}</p><Button variant="ghost" className="mt-2" onClick={() => setRetry(v => v + 1)}><RefreshCw className="mr-1 h-4 w-4" />重试</Button></div>}
    {loading ? <div aria-busy="true" aria-label="正在加载学习画像" className="space-y-4 rounded-xl border border-border p-6">{[1, 2, 3, 4].map(v => <div key={v} className="h-16 animate-pulse rounded-lg bg-muted" />)}</div>
      : profile && <ProfileCard dimensions={profile.dimensions} />}
    {!loading && profile && <p className="mt-4 text-xs leading-6 text-muted-foreground">{profile.dimensions.onboarding?.finishedBy === 'skipped' ? '你选择了稍后完善，已有的有效信息已保留。' : '表单未确认的文字不会出现在画像中。'}</p>}
  </main>;
}
