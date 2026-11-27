import { useEffect, useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ApiError, api, isTemporaryError } from './api';
import type { Practice, Report, ReviewBatch, ReviewTarget } from './types';
import { getLearning, isSubmissionQueued, queueSubmission, readDraft, saveBatch, saveDraft, sendQueuedSubmission, type PracticeDraft } from './learning-storage';
import { Button, Card, Field, Heading, Notice, Section, color, styles } from './ui';
import MarkdownContent from './MarkdownContent';

const reportEndpoint = (attemptId: string) => '/mobile/practice/attempts/' + encodeURIComponent(attemptId);

export default function PracticeView({ resourceId, accountId, token, reportId, review, batch, syncRevision, onBack, onAuthError, onReview, onPractice, onNextBatch }: {
  resourceId?: string; accountId: string; token: string; reportId?: string; review?: ReviewTarget; batch?: ReviewBatch;
  syncRevision: number;
  onBack: () => void; onAuthError: () => void; onReview: (report: Exclude<Report, { kind: 'batch' }>) => void;
  onPractice: (resourceId: string) => void; onNextBatch: (batch: ReviewBatch) => void;
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
  const [staleBatch, setStaleBatch] = useState(false);
  const [offline, setOffline] = useState(false);
  const [queued, setQueued] = useState(false);
  const request = useRef<AbortController | null>(null);
  const draftRef = useRef<PracticeDraft | undefined>(undefined);
  const encodedResource = encodeURIComponent(resourceId ?? '');
  const batchRefs = batch && JSON.stringify(batch.refs);
  const reviewKey = review && ('reportId' in review ? 'reportId=' + review.reportId : 'questionId=' + review.questionId);
  const reviewVersion = batch ? 1 : review?.version;
  const endpoint = batch ? '/mobile/review/batch' : reviewKey
    ? '/mobile/review/' + encodedResource + '?' + reviewKey
    : '/mobile/practice/' + encodedResource;
  const draftKey = batch ? 'review-batch' : reviewKey ? ['review', resourceId, reviewVersion, reviewKey].join('-') : resourceId ?? '';

  useEffect(() => {
    const active = new AbortController();
    setLoading(true);
    setError('');
    setStaleBatch(false);
    async function load() {
      if (reportId) {
        const result = await getLearning<Report>(accountId, reportEndpoint(reportId), token, active.signal);
        if (!active.signal.aborted) { setOffline(result.offline); setReport(result.data); }
        return;
      }
      const reviewDraft = reviewVersion === undefined ? undefined : readDraft(accountId, draftKey, reviewVersion);
      if (reviewDraft?.attemptId) {
        try {
          const result = await getLearning<Report>(accountId, reportEndpoint(reviewDraft.attemptId), token, active.signal);
          if (active.signal.aborted) return;
          try {
            saveDraft(accountId, draftKey);
            if (batchRefs) saveBatch(accountId);
          } catch { setStorageError(true); }
          setOffline(result.offline);
          setReport(result.data);
          return;
        } catch (cause) {
          if (!isTemporaryError(cause) && (!(cause instanceof ApiError) || cause.status !== 404)) throw cause;
        }
      }
      const url = batchRefs ? endpoint + '?refs=' + encodeURIComponent(batchRefs) : reviewKey ? endpoint + '&version=' + reviewVersion : endpoint;
      const result = await getLearning<Practice>(accountId, url, token, active.signal);
      if (active.signal.aborted) return;
      const current = result.data;
      setOffline(result.offline);
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
      setQueued(!!saved?.attemptId && isSubmissionQueued(accountId, saved.attemptId));
      const openReport = saved?.attemptId && !result.offline && !isSubmissionQueued(accountId, saved.attemptId) ? saved.attemptId : undefined;
      if (openReport) {
        try {
          const result = await getLearning<Report>(accountId, reportEndpoint(openReport), token, active.signal);
          if (active.signal.aborted) return;
          try { saveDraft(accountId, draftKey); } catch { setStorageError(true); }
          setRestored(false);
          setReport(result.data);
        } catch (cause) {
          if (!isTemporaryError(cause) && (!(cause instanceof ApiError) || cause.status !== 404)) throw cause;
        }
      }
    }
    void load().catch(cause => {
      if (active.signal.aborted) return;
      if (cause instanceof ApiError && cause.status === 401) onAuthError();
      else {
        setStaleBatch(!!batchRefs && cause instanceof ApiError && [404, 409].includes(cause.status));
        setError(cause instanceof Error ? cause.message : '无法读取题目');
      }
    }).finally(() => { if (!active.signal.aborted) setLoading(false); });
    return () => { active.abort(); request.current?.abort(); };
  }, [endpoint, token, retry, onAuthError, accountId, draftKey, reportId, reviewKey, reviewVersion, batchRefs]);

  useEffect(() => {
    const id = draftRef.current?.attemptId;
    if (!id || !queued || request.current || !syncRevision || isSubmissionQueued(accountId, id)) return;
    const controller = new AbortController();
    void getLearning<Report>(accountId, reportEndpoint(id), token, controller.signal).then(({ data }) => {
      if (controller.signal.aborted || draftRef.current?.attemptId !== id) return;
      setReport(data);
      setQueued(false);
      setError('');
      try { saveDraft(accountId, draftKey); if (batchRefs) saveBatch(accountId); } catch { setStorageError(true); }
    }).catch(cause => {
      if (!controller.signal.aborted && cause instanceof ApiError && cause.status === 404) {
        setQueued(false);
        setError('提交未被服务器接受，请重新提交或刷新题目。');
      }
    });
    return () => controller.abort();
  }, [syncRevision, queued, token, accountId, draftKey, batchRefs]);

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
    if (!previous || request.current || queued) return;
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
        const result = await getLearning<Report>(accountId, reportEndpoint(attemptId), token, active.signal);
        if (!active.signal.aborted) { setOffline(result.offline); setReport(result.data); }
      }
      else {
        const submission = { ...current, attemptId: current.attemptId ?? Crypto.randomUUID() };
        updateDraft(submission);
        const path = reviewKey || batch ? endpoint : endpoint + '/attempts';
        const body = {
          attemptId: submission.attemptId, answers: submission.answers,
          ...(batch ? { refs: batch.refs } : { version: submission.version }),
        };
        let persisted = false;
        try {
          queueSubmission(accountId, submission.attemptId, path, body);
          persisted = true;
        } catch { setStorageError(true); }
        const result = persisted ? await sendQueuedSubmission(accountId, submission.attemptId, token, active.signal)
          : await api<Report>(path, token, body, active.signal);
        if (active.signal.aborted) return;
        setQueued(false);
        setOffline(false);
        updateDraft({ version: current.version, answers: {}, step: 0 }, false);
        try { if (batch) saveBatch(accountId); } catch { setStorageError(true); }
        setPractice({ ...practice, latestAttemptId: reviewKey || batch ? null : result.attemptId });
        setRestored(false);
        setReport(result);
      }
    } catch (cause) {
      if (active.signal.aborted) return;
      if (cause instanceof ApiError && cause.status === 401) onAuthError();
      else if (!attemptId && isTemporaryError(cause) && draftRef.current?.attemptId &&
        isSubmissionQueued(accountId, draftRef.current.attemptId)) setQueued(true);
      else if (cause instanceof ApiError && cause.status === 409 && !attemptId) {
        setQueued(false);
        if (batch) setStaleBatch(true);
        setPractice(undefined);
        setRestored(false);
        setError(cause.message);
      } else {
        setQueued(false);
        setError(cause instanceof Error ? cause.message : '无法读取报告');
      }
    } finally {
      request.current = null;
      if (!active.signal.aborted) setBusy(false);
    }
  }

  if (report) return <>
    <Heading title={report.kind === 'practice' ? '练习报告' : '复习报告'} detail={report.title} />
    {offline ? <Notice text="正在查看本机缓存的报告" /> : null}
    <Card style={local.reportCard}><View style={local.scoreBlock}>
      <Text style={local.scoreLabel}>本次得分</Text>
      <Text style={local.score}>{report.score}<Text style={local.unit}> 分</Text></Text>
      <Text style={styles.detail}>本次 {report.total} 题，答对 {report.correctCount} 题</Text>
    </View></Card>
    {report.focusTopics.length ? <Notice text={'建议复习 ' + report.focusTopics.join('、')} /> : null}
    {report.kind !== 'batch' && report.correctCount < report.total && report.version ? <Button label="重练本次错题" action={() => onReview(report)} /> : null}
    {batch ? <Button label="返回列表查看剩余题目" action={() => onNextBatch(batch)} /> : null}
    <Section>逐题解析</Section>
    {report.answers.map(item => <Card key={item.id}>
      <Text style={[local.answerTag, item.correct ? local.correctTag : local.incorrectTag]}>{item.correct ? '回答正确' : '本次答错'} · {item.topic}</Text>
      <MarkdownContent content={item.question} />
      <Text style={styles.body}>你的答案　{item.userAnswer}</Text>
      <Text style={styles.body}>参考答案　{item.correctAnswer}</Text>
      {item.explanation ? <MarkdownContent content={item.explanation} /> : null}
    </Card>)}
    <Button label={report.kind === 'practice' ? '返回继续学习' : '返回'} secondary action={onBack} />
    {report.kind === 'practice' ? <Button label={Object.values(draft?.answers ?? {}).some(answer => answer.trim()) ? '返回答题草稿' : '再练一次'}
      secondary action={() => practice ? setReport(undefined) : onPractice(report.resourceId)} /> : null}
  </>;
  const answers = draft?.answers ?? {};
  const step = draft?.step ?? 0;
  const question = practice?.questions[step];
  const total = practice?.questions.length ?? 0;
  const answered = question ? Boolean(answers[question.id]?.trim()) : false;
  return <>
    <Heading title={reportId ? '练习报告' : batch ? '整组错题复习' : reviewKey ? '错题重练' : '随堂练习'} detail={batch ? undefined : practice?.title} />
    {loading ? <Notice text="正在读取题目" busy /> : null}
    {error ? <Notice text={error} error /> : null}
    {offline ? <Notice text="正在使用本机缓存的题目" /> : null}
    {queued ? <Notice text="答案已保存在本机，连接恢复后会自动提交。" /> : null}
    {storageError ? <Notice text="暂时无法保存本机草稿" error /> : null}
    {restored && !loading ? <Notice text="已恢复本机答题草稿" /> : null}
    {batch && staleBatch ? <Button label="返回列表重新选题" action={() => {
      try { saveBatch(accountId); } catch { setStorageError(true); return; }
      onNextBatch(batch);
    }} /> : !practice && !loading ? <Button label="重新加载" action={() => setRetry(value => value + 1)} /> : null}
    {practice && question && draft && !loading ? <>
      {practice.latestAttemptId ? <Button label="查看上次报告" secondary disabled={busy} action={() => void finish(practice.latestAttemptId ?? undefined)} /> : null}
      <View style={local.progressRow}>
        <Text style={local.questionTag}>{question.type === 'choice' ? '单选题' : '填空题'}</Text>
        <Text style={styles.detail}>第 {step + 1} / {total} 题</Text>
      </View>
      <View accessible accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: total, now: step + 1 }} style={local.track}>
        <View style={[local.bar, { width: `${(step + 1) / total * 100}%` }]} />
      </View>
      <Card><MarkdownContent content={question.question} /></Card>
      {question.type === 'choice' ? question.options?.map((option, index) => {
        const checked = answers[question.id] === option;
        return <Pressable accessibilityRole="radio" accessibilityState={{ checked }} disabled={busy || queued} key={index}
          onPress={() => changeAnswer(question.id, option)}
          style={[local.option, checked && local.selected]}>
          <View style={[local.letterBox, checked && local.letterSelected]}>
            <Text style={[local.letter, checked && local.letterSelectedText]}>{String.fromCharCode(65 + index)}</Text>
          </View>
          <View style={local.optionText}><MarkdownContent content={option} unwrap={false} /></View>
        </Pressable>;
      }) : <Field key={question.id} accessibilityLabel="答案" placeholder="输入答案" maxLength={2000} editable={!busy && !queued}
        value={answers[question.id] ?? ''} onChangeText={value => changeAnswer(question.id, value)} />}
      {step < total - 1 ?
        <Button label="下一题" disabled={!answered || busy} action={() => updateDraft({ ...draft, step: step + 1 })} /> :
        <Button label={busy ? '正在载入…' : queued ? '立即重试提交' : '提交并查看报告'}
          disabled={busy || practice.questions.some(item => !answers[item.id]?.trim())} action={() => void finish()} />}
      {step > 0 ? <Button label="上一题" secondary disabled={busy} action={() => updateDraft({ ...draft, step: step - 1 })} /> : null}
    </> : null}
  </>;
}

const local = StyleSheet.create({
  reportCard: { backgroundColor: '#EEF3FF', borderColor: '#DAE6FF' },
  scoreBlock: { gap: 4, alignItems: 'center', padding: 12 },
  scoreLabel: { color: color.blueDark, fontWeight: '700', fontSize: 13 },
  score: { color: color.blue, fontSize: 54, fontWeight: '800', fontVariant: ['tabular-nums'] },
  unit: { fontSize: 17, fontWeight: '700' },
  track: { height: 6, borderRadius: 5, backgroundColor: color.line, overflow: 'hidden' },
  bar: { height: 6, backgroundColor: color.blue, borderRadius: 5 },
  option: { flexDirection: 'row', gap: 12, alignItems: 'center', minHeight: 54, borderRadius: 15, borderWidth: 1,
    borderColor: color.line, backgroundColor: color.white, padding: 12 },
  selected: { backgroundColor: color.tint, borderColor: color.blue },
  optionText: { flex: 1 },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  questionTag: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 8, overflow: 'hidden',
    backgroundColor: color.tint, color: color.blueDark, fontSize: 12, fontWeight: '700' },
  letterBox: { width: 30, height: 30, borderRadius: 9, backgroundColor: color.tint, alignItems: 'center', justifyContent: 'center' },
  letterSelected: { backgroundColor: color.blue },
  letter: { color: color.blueDark, fontWeight: '800' },
  letterSelectedText: { color: color.white },
  answerTag: { alignSelf: 'flex-start', overflow: 'hidden', borderRadius: 10, paddingVertical: 4, paddingHorizontal: 8,
    fontSize: 12, fontWeight: '700' },
  correctTag: { color: color.green, backgroundColor: color.lightGreen },
  incorrectTag: { color: color.red, backgroundColor: color.lightRed },
});
