import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { api, ApiError } from './api';
import type { ReviewItem, ReviewList, ReviewMode } from './types';
import { Button, Card, Heading, Notice, Row, Section, color, styles } from './ui';

export default function ReviewView({ token, mode, compact = false, onStart, onOpen, onReport, onAuthError }: {
  token: string; mode: ReviewMode; compact?: boolean;
  onStart: (item: ReviewItem) => void; onOpen?: () => void;
  onReport: (item: ReviewItem) => void; onAuthError: () => void;
}) {
  const [topic, setTopic] = useState<string>();
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<ReviewList>();
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const today = mode === 'today';
  const title = today ? '今日待复习' : '错题本';

  useEffect(() => {
    const request = new AbortController();
    const query = new URLSearchParams({ mode, offset: String(offset), tzOffset: String(new Date().getTimezoneOffset()) });
    if (topic) query.set('topic', topic);
    setLoading(true);
    setError('');
    void api<ReviewList>('/mobile/review?' + query.toString(), token, undefined, request.signal).then(result => {
      if (request.signal.aborted) return;
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
  }, [mode, offset, topic, token, retry, onAuthError]);

  function selectTopic(value?: string) {
    if (topic === value) return;
    setTopic(value);
    setOffset(0);
    setLoading(true);
    setData(previous => previous && { ...previous, items: [], total: 0, nextOffset: null });
  }

  const status = <>
    {loading ? <Notice text="正在读取复习记录" busy /> : null}
    {error ? <><Notice text={error} error /><Button label="重试" secondary action={() => setRetry(value => value + 1)} /></> : null}
  </>;

  if (compact) {
    const first = data?.items[0];
    return <Card>
      <Section>{title}</Section>
      {status}
      {first ? <>
        <Text style={styles.detail}>{data?.total} 道题 · 先复习 {first.topic}</Text>
        <Button label="开始复习" action={() => onStart(first)} />
        <Button label="查看复习列表" secondary action={() => onOpen?.()} />
      </> : data && !loading ? <Text style={styles.detail}>今天暂无待复习的题目。</Text> : null}
    </Card>;
  }

  return <>
    <Heading title={title} detail={data && !loading ? `${data.total} 道题` : undefined} />
    {data?.topics.length ? <View style={local.filters}>
      {[undefined, ...data.topics].map(value => <Pressable key={value === undefined ? 'all' : 'topic:' + value}
        accessibilityRole="button" accessibilityState={{ selected: value === topic }} onPress={() => selectTopic(value)}
        style={[local.filter, value === topic && local.selected]}>
        <Text style={local.filterText}>{value ?? '全部知识点'}</Text>
      </Pressable>)}
    </View> : null}
    {status}
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
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filter: { borderRadius: 18, borderWidth: 1, borderColor: color.line, backgroundColor: color.white, paddingHorizontal: 12, paddingVertical: 9, minHeight: 44, justifyContent: 'center', maxWidth: '100%' },
  selected: { borderColor: color.blue, backgroundColor: color.tint },
  filterText: { color: color.ink, fontSize: 13, fontWeight: '600' },
});
