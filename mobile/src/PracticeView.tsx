import { useEffect, useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ApiError, api } from './api';
import type { Practice, Report } from './types';
import { Button, Card, Field, Heading, Notice, Section, color, styles } from './ui';

export default function PracticeView({ resourceId, token, onBack, onAuthError }: {
  resourceId: string; token: string; onBack: () => void; onAuthError: () => void;
}) {
  const [practice, setPractice] = useState<Practice>();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [report, setReport] = useState<Report>();
  const [step, setStep] = useState(0);
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const attempt = useRef('');
  const endpoint = '/mobile/practice/' + encodeURIComponent(resourceId);

  useEffect(() => {
    const active = new AbortController();
    setLoading(true);
    setError('');
    api<Practice>(endpoint, token, undefined, active.signal).then(setPractice).catch(cause => {
      if (active.signal.aborted) return;
      if (cause instanceof ApiError && cause.status === 401) onAuthError();
      else setError(cause instanceof Error ? cause.message : '无法读取题目');
    }).finally(() => { if (!active.signal.aborted) setLoading(false); });
    return () => { active.abort(); request.current?.abort(); };
  }, [endpoint, token, retry, onAuthError]);

  async function finish(attemptId?: string) {
    if (!practice || request.current) return;
    const active = new AbortController();
    request.current = active;
    setBusy(true);
    setError('');
    try {
      if (attemptId) setReport(await api<Report>('/mobile/practice/attempts/' + encodeURIComponent(attemptId), token, undefined, active.signal));
      else {
        if (!attempt.current) attempt.current = Crypto.randomUUID();
        setReport(await api<Report>(endpoint + '/attempts', token, {
          attemptId: attempt.current, version: practice.version, answers,
        }, active.signal));
      }
    } catch (cause) {
      if (active.signal.aborted) return;
      if (cause instanceof ApiError && cause.status === 401) onAuthError();
      else if (cause instanceof ApiError && cause.status === 409 && !attemptId) {
        attempt.current = '';
        setPractice(undefined);
        setStep(0);
        setAnswers({});
        setError(cause.message);
      } else setError(cause instanceof Error ? cause.message : '无法读取报告');
    } finally {
      request.current = null;
      if (!active.signal.aborted) setBusy(false);
    }
  }

  if (report) return <>
    <Heading title="练习报告" detail={report.title} />
    <Card><View style={local.scoreBlock}>
      <Text style={local.score}>{report.score}<Text style={local.unit}> 分</Text></Text>
      <Text style={styles.detail}>本次 {report.total} 题，答对 {report.correctCount} 题</Text>
    </View></Card>
    {report.focusTopics.length ? <Notice text={'建议复习 ' + report.focusTopics.join('、')} /> : null}
    <Section>逐题解析</Section>
    {report.answers.map(item => <Card key={item.id}>
      <Text style={[styles.detail, { color: item.correct ? color.green : color.red }]}>{item.correct ? '回答正确' : '待巩固'} · {item.topic}</Text>
      <Text style={styles.rowTitle}>{item.question}</Text>
      <Text style={styles.body}>你的答案　{item.userAnswer}</Text>
      <Text style={styles.body}>参考答案　{item.correctAnswer}</Text>
      {item.explanation ? <Text style={styles.detail}>{item.explanation}</Text> : null}
    </Card>)}
    <Button label="返回继续学习" action={onBack} />
    <Button label="再练一次" secondary action={() => { attempt.current = ''; setStep(0); setAnswers({}); setReport(undefined); }} />
  </>;
  const question = practice?.questions[step];
  const total = practice?.questions.length ?? 0;
  const answered = question ? Boolean(answers[question.id]?.trim()) : false;
  return <>
    <Heading title="随堂练习" detail={practice?.title} />
    {loading ? <Notice text="正在读取题目" busy /> : null}
    {error ? <Notice text={error} error /> : null}
    {!practice && !loading ? <Button label="重新加载" action={() => setRetry(value => value + 1)} /> : null}
    {practice && question ? <>
      {practice.latestAttemptId ? <Button label="查看上次报告" secondary disabled={busy} action={() => void finish(practice.latestAttemptId ?? undefined)} /> : null}
      <Text style={styles.detail}>第 {step + 1} / {total} 题</Text>
      <View style={local.track}><View style={[local.bar, { width: `${(step + 1) / total * 100}%` }]} /></View>
      <Section>{question.question}</Section>
      {question.type === 'choice' ? question.options?.map((option, index) => {
        const checked = answers[question.id] === option;
        return <Pressable accessibilityRole="radio" accessibilityState={{ checked }} disabled={busy} key={index}
          onPress={() => { if (!request.current) { attempt.current = ''; setAnswers(previous => ({ ...previous, [question.id]: option })); } }}
          style={[local.option, checked && local.selected]}>
          <Text style={local.letter}>{String.fromCharCode(65 + index)}</Text><Text style={[styles.body, local.optionText]}>{option}</Text>
        </Pressable>;
      }) : <Field key={question.id} accessibilityLabel="答案" placeholder="输入答案" maxLength={2000} editable={!busy}
        value={answers[question.id] ?? ''} onChangeText={value => {
          if (!request.current) { attempt.current = ''; setAnswers(previous => ({ ...previous, [question.id]: value })); }
        }} />}
      {step < total - 1 ?
        <Button label="下一题" disabled={!answered || busy} action={() => setStep(step + 1)} /> :
        <Button label={busy ? '正在载入…' : '提交并查看报告'} disabled={busy || !answered} action={() => void finish()} />}
      {step > 0 ? <Button label="上一题" secondary disabled={busy} action={() => setStep(step - 1)} /> : null}
    </> : null}
  </>;
}

const local = StyleSheet.create({
  scoreBlock: { gap: 5, alignItems: 'center', padding: 12 },
  score: { color: color.blue, fontSize: 54, fontWeight: '800', fontVariant: ['tabular-nums'] },
  unit: { fontSize: 17, fontWeight: '700' },
  track: { height: 6, borderRadius: 5, backgroundColor: color.line, overflow: 'hidden' },
  bar: { height: 6, backgroundColor: color.blue, borderRadius: 5 },
  option: { flexDirection: 'row', gap: 12, alignItems: 'center', minHeight: 54, borderRadius: 15, borderWidth: 1,
    borderColor: color.line, backgroundColor: color.white, padding: 12 },
  selected: { backgroundColor: color.tint, borderColor: color.blue },
  optionText: { flex: 1 },
  letter: { color: color.blueDark, fontWeight: '800', width: 23 },
});
