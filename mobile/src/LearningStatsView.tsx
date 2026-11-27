import { useEffect, useState } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { ApiError } from './api';
import { getLearning } from './learning-storage';
import type { WeeklyStats } from './types';
import { Button, Card, Notice, Row, Section, color, styles } from './ui';

export default function LearningStatsView({ accountId, token, syncRevision, compact = false, onOpen, onTopic, onAuthError }: {
  accountId: string; token: string; syncRevision: number; compact?: boolean;
  onOpen?: () => void; onTopic?: (topic: string) => void; onAuthError: () => void;
}) {
  const [data, setData] = useState<WeeklyStats>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const request = new AbortController();
    setError('');
    const query = '/mobile/stats?tzOffset=' + new Date().getTimezoneOffset();
    void getLearning<WeeklyStats>(accountId, query, token, request.signal).then(result => {
      if (!request.signal.aborted) { setData(result.data); setOffline(result.offline); }
    }).catch(cause => {
      if (request.signal.aborted) return;
      if (cause instanceof ApiError && cause.status === 401) onAuthError();
      else setError(cause instanceof Error ? cause.message : '无法读取学习统计');
    });
    return () => request.abort();
  }, [accountId, token, syncRevision, onAuthError, retry]);

  return <>
    <Card>
      <Section>近 7 天练习</Section>
      {offline ? <Text style={styles.detail}>本机缓存，联网后更新</Text> : null}
      {error ? <><Notice text={error} error /><Button label="重试" secondary action={() => setRetry(value => value + 1)} /></> : null}
      {!data && !error ? <Notice text="正在读取学习统计" busy /> : null}
      {data ? <>
        <View style={local.metrics}>
          <Metric title="练习天数" value={data.days + ' 天'} />
          <Metric title="作答次数" value={data.answered + ' 次'} />
          <Metric title="正确率" value={data.accuracy === null ? '—' : data.accuracy + '%'} />
        </View>
        <Text style={styles.detail}>连续练习 {data.streak} 天{data.accuracyChange === null ? '' :
          ` · 较前 7 天 ${data.accuracyChange > 0 ? '+' : ''}${data.accuracyChange} 个百分点`}</Text>
        {compact && onOpen ? <Button label="查看学习统计" secondary action={onOpen} /> : null}
      </> : null}
    </Card>
    {!compact && data ? <>
      <Card>
        <Section>每日练习</Section>
        {data.daily.map(day => <View key={day.date} style={local.day}>
          <Text style={styles.detail}>{day.date.slice(5)}</Text>
          <View style={local.track}>
            <View style={[local.bar, { width: `${100 * day.answered / Math.max(1, ...data.daily.map(item => item.answered))}%` }]} />
          </View>
          <Text style={styles.detail}>{day.answered} 题</Text>
        </View>)}
      </Card>
      <Card>
        <Section>薄弱知识点</Section>
        {data.weakTopics.length ? data.weakTopics.map(item => <Row key={item.topic} title={item.topic}
          detail={`掌握度 ${Math.round(100 * item.mastery)}%`} icon="target" onPress={() => onTopic?.(item.topic)} />)
          : <Text style={styles.detail}>暂无薄弱知识点。</Text>}
      </Card>
    </> : null}
  </>;
}

function Metric({ title, value }: { title: string; value: string }) {
  return <View style={local.metric}><Text style={local.metricValue}>{value}</Text><Text style={local.metricLabel}>{title}</Text></View>;
}

const local = StyleSheet.create({
  metrics: { flexDirection: 'row', gap: 5, padding: 8, borderRadius: 14, backgroundColor: color.background },
  metric: { flex: 1, alignItems: 'center', paddingVertical: 3, gap: 2 },
  metricValue: { color: color.ink, fontSize: 18, lineHeight: 25, fontWeight: '800', fontVariant: ['tabular-nums'], textAlign: 'center' },
  metricLabel: { color: color.muted, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  day: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  track: { flex: 1, height: 8, backgroundColor: color.tint, borderRadius: 8, overflow: 'hidden' },
  bar: { height: '100%', backgroundColor: color.blue, borderRadius: 8 },
});
