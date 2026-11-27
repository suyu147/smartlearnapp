import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ApiError } from './api';
import { getLearning } from './learning-storage';
import type { ReviewBatch, ReviewItem, ReviewList, ReviewMode } from './types';
import { Button, Card, Heading, Notice, Row, Section, color, styles } from './ui';

export default function ReviewView({ accountId, token, mode, initialTopic, syncRevision, compact = false, onStart, onBatch, onOpen, onReport, onAuthError }: {
  accountId: string; token: string; mode: ReviewMode; compact?: boolean; initialTopic?: string; syncRevision: number;
  onStart: (item: ReviewItem) => void; onOpen?: () => void;
  onBatch: (batch: ReviewBatch) => void;
  onReport: (item: ReviewItem) => void; onAuthError: () => void;
}) {
  const [topic, setTopic] = useState(initialTopic);
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<ReviewList>();
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [offline, setOffline] = useState(false);
  const today = mode === 'today';
  const title = today ? '今日待复习' : '错题本';

  useEffect(() => {
    const request = new AbortController();
    const query = new URLSearchParams({ mode, offset: String(offset), tzOffset: String(new Date().getTimezoneOffset()) });
    if (topic) query.set('topic', topic);
    setLoading(true);
    setError('');
    void getLearning<ReviewList>(accountId, '/mobile/review?' + query.toString(), token, request.signal).then(({ data: result, offline }) => {
      if (request.signal.aborted) return;
      setOffline(offline);
      setData(previous => !offset || !previous ? result : {
        ...result, items: [...previous.items, ...result.items.filter(item => !previous.items.some(existing =>
          existing.resourceId === item.resourceId && existing.version === item.version && existing.questionId === item.questionId))],
      });
    }).catch(cause => {
      if (request.signal.aborted) return;
      if (cause instanceof ApiError && cause.status === 401) onAuthError();
      else setError(cause instanceof Error ? cause.message : '无法读取复习记录');
    }).finally(() => { if (!request.signal.aborted) setLoading(false); });
    return () => request.abort();
  }, [accountId, mode, offset, topic, token, retry, syncRevision, onAuthError]);

  function selectTopic(value?: string) {
    if (topic === value) return;
    setTopic(value);
    setOffset(0);
    setLoading(true);
    setData(previous => previous && { ...previous, items: [], total: 0, nextOffset: null });
  }

  const status = <>
    {offline ? <Text style={styles.detail}>本机缓存，联网后更新</Text> : null}
    {loading ? <Notice text="正在读取复习记录" busy /> : null}
    {error ? <><Notice text={error} error /><Button label="重试" secondary action={() => setRetry(value => value + 1)} /></> : null}
  </>;
  const refs = data?.batch;
  const batchButton = refs?.length ? <Button label={today ? `开始复习 · ${refs.length} 题` : `整组重练 · ${refs.length} 题`}
    disabled={loading} action={() => onBatch({ refs, mode, topic })} /> : null;

  if (compact) {
    const done = data?.completedToday ?? 0;
    const remaining = data?.total ?? 0;
    return <Card>
      <View style={local.summaryHeader}>
        <Section>{title}</Section>
        {data ? <Text style={local.count}>{remaining ? remaining + ' 题待复习' : '暂无待复习'}</Text> : null}
      </View>
      {status}
      {data ? <>
        {done || remaining ? <Text style={styles.detail}>今日已完成 {done} 题</Text> : null}
        {done + remaining > 0 ? <View accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: done + remaining, now: done }} style={local.track}>
          <View style={[local.fill, { width: `${100 * done / (done + remaining)}%` }]} />
        </View> : null}
        {batchButton}
        {remaining && onOpen ? <Button label="查看复习列表" secondary action={onOpen} /> : null}
      </> : null}
    </Card>;
  }

  return <>
    <Heading title={title} detail={data && !loading ? `${data.total} 道题` : undefined} />
    {data && (data.topics.length || topic) ? <View style={local.filters}>
      {[undefined, ...new Set([...data.topics, ...(topic ? [topic] : [])])].map(value => <Pressable key={value === undefined ? 'all' : 'topic:' + value}
        accessibilityRole="button" accessibilityState={{ selected: value === topic }} onPress={() => selectTopic(value)}
        style={[local.filter, value === topic && local.selected]}>
        <Text style={local.filterText}>{value ?? '全部知识点'}</Text>
      </Pressable>)}
    </View> : null}
    {status}
    {batchButton}
    {data?.items.map(item => <Card key={`${item.resourceId}:${item.version}:${item.questionId}`}>
      <Text style={styles.detail}>{item.topic} · {item.title}</Text>
      <Text style={styles.rowTitle}>{item.question}</Text>
      <Text style={styles.detail}>错 {item.mistakeCount} 次 · 最近作答 {new Date(item.lastAnsweredAt).toLocaleString('zh-CN', {
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      })}</Text>
      {item.canReview ? <Row title="重练这道题" icon="repeat" onPress={() => onStart(item)} />
        : <Text style={styles.detail}>原题版本已不可用，仍可查看解析。</Text>}
      <Row title="查看错题解析" icon="file-text" onPress={() => onReport(item)} />
    </Card>)}
    {data && !data.items.length && !loading && !error ? <Notice text={today ? '今天暂无待复习的题目。' : '暂无待巩固的错题。'} /> : null}
    {data?.nextOffset != null ? <Button label="加载更多" secondary disabled={loading} action={() => setOffset(data.nextOffset!)} /> : null}
  </>;
}

const local = StyleSheet.create({
  summaryHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 5 },
  count: { color: color.green, backgroundColor: color.lightGreen, paddingHorizontal: 8, paddingVertical: 4,
    overflow: 'hidden', borderRadius: 10, fontWeight: '700', fontSize: 11 },
  track: { height: 7, backgroundColor: color.tint, borderRadius: 8, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: color.blue, borderRadius: 8 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filter: { borderRadius: 18, borderWidth: 1, borderColor: color.line, backgroundColor: color.white, paddingHorizontal: 12, paddingVertical: 9, minHeight: 44, justifyContent: 'center', maxWidth: '100%' },
  selected: { borderColor: color.blue, backgroundColor: color.tint },
  filterText: { color: color.ink, fontSize: 13, fontWeight: '600' },
});
