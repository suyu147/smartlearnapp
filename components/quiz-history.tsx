"use client";
import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api-client';
import { useRefreshOnFocus } from '@/lib/hooks/use-refresh-on-focus';
interface Attempt { id: string; question: string; topic: string; correct: boolean; userAnswer: string | null; correctAnswer: string | null; createdAt: string; }
export function QuizHistory() {
  const [records, setRecords] = useState<Attempt[]>([]), [nextBefore, setNextBefore] = useState<string | null>(null), [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  async function load(before?: string) {
    setLoading(true);
    try {
      const data = await apiGet<{ records: Attempt[]; nextBefore: string | null }>(`/api/v1/quiz-attempts${before ? `?before=${encodeURIComponent(before)}` : ''}`);
      setRecords(previous => before ? [...previous, ...data.records] : data.records); setNextBefore(data.nextBefore); setError('');
    } catch (error) { setError(error instanceof Error ? error.message : '加载答题记录失败'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  useRefreshOnFocus(() => load(), !loading);
  return <section className="mt-8 border-t pt-6"><h2 className="text-lg font-semibold">答题记录与错题</h2>
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}<button className="ml-3 underline" onClick={() => void load()}>重试</button></p>}
    {!records.length && !loading && !error && <p className="mt-3 text-sm text-muted-foreground">暂无答题记录</p>}
    <div className="mt-4 space-y-3">{records.map(record => <article key={record.id} className="rounded-lg border p-4 text-sm"><div className="flex items-center justify-between gap-3"><span className={record.correct ? 'text-green-700' : 'text-destructive'}>{record.correct ? '答对' : '错题'} · {record.topic}</span><time className="text-xs text-muted-foreground">{new Date(record.createdAt).toLocaleString()}</time></div><p className="mt-2 font-medium">{record.question}</p><p className="mt-2">你的答案：{record.userAnswer || '未作答'}</p><p className="mt-1 text-muted-foreground">正确答案：{record.correctAnswer || '暂无'}</p></article>)}</div>
    {nextBefore && <button disabled={loading} className="mt-4 text-sm underline" onClick={() => void load(nextBefore)}>加载更早的记录</button>}
  </section>;
}
