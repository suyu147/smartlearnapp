import { useEffect, useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ApiError, api } from './api';
import type { Practice, Report, ReviewTarget } from './types';
import { readDraft, saveDraft, type PracticeDraft } from './learning-storage';
import { Button, Card, Field, Heading, Notice, Section, color, styles } from './ui';

const reportEndpoint = (attemptId: string) => '/mobile/practice/attempts/' + encodeURIComponent(attemptId);

export default function PracticeView({ resourceId, accountId, token, reportId, review, onBack, onAuthError, onReview, onPractice }: {
  resourceId: string; accountId: string; token: string; reportId?: string; review?: ReviewTarget;
  onBack: () => void; onAuthError: () => void; onReview: (report: Report) => void;
  onPractice: (resourceId: string) => void;
}) {
  const [practice, setPractice] = useState<Practice>();
  const [draft, setDraft] = useState<PracticeDraft>();
  const [restored, setRestored] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [report, setReport] = useState<Report>();
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const draftRef = useRef<PracticeDraft | undefined>(undefined);
  const encodedResource = encodeURIComponent(resourceId);
  const reviewKey = review && ('reportId' in review ? 'reportId=' + review.reportId : 'questionId=' + review.questionId);
  const reviewVersion = review?.version;
  const endpoint = reviewKey
    ? '/mobile/review/' + encodedResource + '?' + reviewKey
    : '/mobile/practice/' + encodedResource;
  const draftKey = reviewKey ? ['review', resourceId, reviewVersion, reviewKey].join('-') : resourceId;

  useEffect(() => {
    const active = new AbortController();
    setLoading(true);
    setError('');
    async function load() {
      if (reportId) {
        const result = await api<Report>(reportEndpoint(reportId), token, undefined, active.signal);
        if (!active.signal.aborted) setReport(result);
        return;
      }
      const reviewDraft = reviewVersion === undefined ? undefined : readDraft(accountId, draftKey, reviewVersion);
      if (reviewDraft?.attemptId) {
        try {
          const result = await api<Report>(reportEndpoint(reviewDraft.attemptId), token, undefined, active.signal);
          if (active.signal.aborted) return;
          try { saveDraft(accountId, draftKey); } catch { setStorageError(true); }
          setReport(result);
          return;
        } catch (cause) {
          if (!(cause instanceof ApiError) || cause.status !== 404) throw cause;
        }
      }
      const url = reviewKey ? endpoint + '&version=' + reviewVersion : endpoint;
      const current = await api<Practice>(url, token, undefined, active.signal);
      if (active.signal.aborted) return;
      const saved = reviewDraft ?? readDraft(accountId, draftKey, current.version);
      const answers = Object.fromEntries(current.questions.flatMap(question => {
        const answer = saved?.answers[question.id];
        return typeof answer === 'string' ? [[question.id, answer]] : [];
      }));
      const firstUnanswered = current.questions.findIndex(question => !answers[question.id]?.trim());
      const lastReachable = firstUnanswered < 0 ? current.questions.length - 1 : firstUnanswered;
      const initial = { version: current.version, answers, attemptId: saved?.attemptId, step: Math.max(0, Math.min(saved?.step ?? 0, lastReachable)) };
      draftRef.current = initial;
      setDraft(initial);
      setRestored(!!saved && Object.values(answers).some(answer => answer.trim()));
      setPractice(current);
      const openReport = saved?.attemptId === current.latestAttemptId ? saved?.attemptId : undefined;
      if (openReport) {
        const result = await api<Report>(reportEndpoint(openReport), token, undefined, active.signal);
        if (active.signal.aborted) return;
        if (openReport === saved?.attemptId) {
          try { saveDraft(accountId, draftKey); } catch { setStorageError(true); }
          setRestored(false);
        }
        setReport(result);
      }
    }
    void load().catch(cause => {
      if (active.signal.aborted) return;
      if (cause instanceof ApiError && cause.status === 401) onAuthError();
      else setError(cause instanceof Error ? cause.message : '无法读取题目');
    }).finally(() => { if (!active.signal.aborted) setLoading(false); });
    return () => { active.abort(); request.current?.abort(); };
  }, [endpoint, token, retry, onAuthError, accountId, draftKey, reportId, reviewKey, reviewVersion]);

  function updateDraft(value: PracticeDraft, persist = true) {
    draftRef.current = value;
    setDraft(value);
    try {
      saveDraft(accountId, draftKey, persist ? value : undefined);
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }

  function changeAnswer(questionId: string, answer: string) {
    const previous = draftRef.current;
    if (!previous || request.current) return;
    if (previous.answers[questionId] === answer) return;
    updateDraft({ ...previous, attemptId: undefined, answers: { ...previous.answers, [questionId]: answer } });
  }

  async function finish(attemptId?: string) {
    const current = draftRef.current;
    if (!practice || !current || request.current) return;
    const active = new AbortController();
    request.current = active;
    setBusy(true);
    setError('');
    try {
      if (attemptId) {
        const result = await api<Report>(reportEndpoint(attemptId), token, undefined, active.signal);
        if (!active.signal.aborted) setReport(result);
      }
      else {
        const submission = { ...current, attemptId: current.attemptId ?? Crypto.randomUUID() };
        updateDraft(submission);
        const result = await api<Report>(reviewKey ? endpoint : endpoint + '/attempts', token, {
          attemptId: submission.attemptId, version: submission.version, answers: submission.answers,
        }, active.signal);
        if (active.signal.aborted) return;
        updateDraft({ version: current.version, answers: {}, step: 0 }, false);
        setPractice({ ...practice, latestAttemptId: reviewKey ? null : result.attemptId });
        setRestored(false);
        setReport(result);
      }
    } catch (cause) {
      if (active.signal.aborted) return;
      if (cause instanceof ApiError && cause.status === 401) onAuthError();
      else if (cause instanceof ApiError && cause.status === 409 && !attemptId) {
        updateDraft({ version: current.version, step: 0, answers: {} }, false);
        setPractice(undefined);
        setRestored(false);
        setError(cause.message);
      } else setError(cause instanceof Error ? cause.message : '无法读取报告');
    } finally {
      request.current = null;
      if (!active.signal.aborted) setBusy(false);
    }
  }

  if (report) return <>
    <Heading title={report.kind === 'review' ? '重练报告' : '练习报告'} detail={report.title} />
    <Card><View style={local.scoreBlock}>
      <Text style={local.score}>{report.score}<Text style={local.unit}> 分</Text></Text>
      <Text style={styles.detail}>本次 {report.total} 题，答对 {report.correctCount} 题</Text>
    </View></Card>
    {report.focusTopics.length ? <Notice text={'建议复习 ' + report.focusTopics.join('、')} /> : null}
    {report.correctCount < report.total && report.version ? <Button label="重练本次错题" action={() => onReview(report)} /> : null}
    <Section>逐题解析</Section>
    {report.answers.map(item => <Card key={item.id}>
      <Text style={[styles.detail, { color: item.correct ? color.green : color.red }]}>{item.correct ? '回答正确' : '本次答错'} · {item.topic}</Text>
      <Text style={styles.rowTitle}>{item.question}</Text>
      <Text style={styles.body}>你的答案　{item.userAnswer}</Text>
      <Text style={styles.body}>参考答案　{item.correctAnswer}</Text>
      {item.explanation ? <Text style={styles.detail}>{item.explanation}</Text> : null}
    </Card>)}
    <Button label={report.kind === 'review' ? '返回复习入口' : '返回继续学习'} secondary action={onBack} />
    {report.kind !== 'review' ? <Button label={Object.values(draft?.answers ?? {}).some(answer => answer.trim()) ? '返回答题草稿' : '再练一次'}
      secondary action={() => practice ? setReport(undefined) : onPractice(resourceId)} /> : null}
  </>;
  const answers = draft?.answers ?? {};
  const step = draft?.step ?? 0;
  const question = practice?.questions[step];
  const total = practice?.questions.length ?? 0;
  const answered = question ? Boolean(answers[question.id]?.trim()) : false;
  return <>
    <Heading title={reportId ? '练习报告' : reviewKey ? '错题重练' : '随堂练习'} detail={practice?.title} />
    {loading ? <Notice text="正在读取题目" busy /> : null}
    {error ? <Notice text={error} error /> : null}
    {storageError ? <Notice text="暂时无法保存本机草稿" error /> : null}
    {restored && !loading ? <Notice text="已恢复本机答题草稿" /> : null}
    {!practice && !loading ? <Button label="重新加载" action={() => setRetry(value => value + 1)} /> : null}
    {practice && question && draft && !loading ? <>
      {practice.latestAttemptId ? <Button label="查看上次报告" secondary disabled={busy} action={() => void finish(practice.latestAttemptId ?? undefined)} /> : null}
      <Text style={styles.detail}>第 {step + 1} / {total} 题</Text>
      <View style={local.track}><View style={[local.bar, { width: `${(step + 1) / total * 100}%` }]} /></View>
      <Section>{question.question}</Section>
      {question.type === 'choice' ? question.options?.map((option, index) => {
        const checked = answers[question.id] === option;
        return <Pressable accessibilityRole="radio" accessibilityState={{ checked }} disabled={busy} key={index}
          onPress={() => changeAnswer(question.id, option)}
          style={[local.option, checked && local.selected]}>
          <Text style={local.letter}>{String.fromCharCode(65 + index)}</Text><Text style={[styles.body, local.optionText]}>{option}</Text>
        </Pressable>;
      }) : <Field key={question.id} accessibilityLabel="答案" placeholder="输入答案" maxLength={2000} editable={!busy}
        value={answers[question.id] ?? ''} onChangeText={value => changeAnswer(question.id, value)} />}
      {step < total - 1 ?
        <Button label="下一题" disabled={!answered || busy} action={() => updateDraft({ ...draft, step: step + 1 })} /> :
        <Button label={busy ? '正在载入…' : '提交并查看报告'}
          disabled={busy || practice.questions.some(item => !answers[item.id]?.trim())} action={() => void finish()} />}
      {step > 0 ? <Button label="上一题" secondary disabled={busy} action={() => updateDraft({ ...draft, step: step - 1 })} /> : null}
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
