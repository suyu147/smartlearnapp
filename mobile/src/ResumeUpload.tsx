import { useEffect, useRef, useState } from 'react';
import { getDocumentAsync } from 'expo-document-picker';
import { File } from 'expo-file-system';
import { Text } from 'react-native';
import type { ParseTask, ResumeRecord, UploadTask } from '../../lib/career/types';
import { ApiError, api, isTemporaryError } from './api';
import { Button, Notice, Row, Section, styles } from './ui';

const maxBytes = 10 * 1024 * 1024;
const parseTimeout = 120_000;

async function waitForResume(token: string, taskId: string, signal: AbortSignal, onProgress: (progress: number) => void) {
  const deadline = Date.now() + parseTimeout;
  while (!signal.aborted && Date.now() < deadline) {
    const task = await api<ParseTask>('/career/tasks/' + encodeURIComponent(taskId), token, undefined, signal,
      { timeoutMs: Math.min(35_000, deadline - Date.now()) }).catch(error => {
      if (!signal.aborted && isTemporaryError(error)) return undefined;
      throw error;
    });
    if (task) {
      onProgress(task.progress);
      if (task.status === 'failed') throw new Error(task.error || '简历解析失败，请重新选择文件');
      if (task.status === 'completed') {
        if (!task.result?.resumeId) throw new Error('职业服务未返回解析结果');
        return task.result;
      }
    }
    await new Promise<void>(resolve => setTimeout(resolve, 1500));
  }
  if (signal.aborted) return;
  throw new ApiError('等待解析超时，可继续查询原任务', 408);
}

export default function ResumeUpload({ token, disabled, onParsed, onAuthError, onLoadingChange }: {
  token: string; disabled: boolean; onParsed: (record: ResumeRecord) => void; onAuthError: () => void;
  onLoadingChange: (loading: boolean) => void;
}) {
  const [phase, setPhase] = useState<'picking' | 'uploading' | 'parsing'>();
  const [submission, setSubmission] = useState<{ taskId: string; name: string }>();
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<ResumeRecord[]>();
  const [loadingHistory, setLoadingHistory] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);

  async function run(existing?: NonNullable<typeof submission>) {
    if (disabled || active.current) return;
    const controller = new AbortController();
    active.current = controller;
    const { signal } = controller;
    setError('');
    setPhase(existing ? 'parsing' : 'picking');
    onLoadingChange(true);
    let task = existing;
    try {
      if (!task) {
        const selection = await getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
        if (selection.canceled) return;
        const asset = selection.assets[0];
        if (!asset) return;
        const file = new File(asset.uri);
        try {
          if (signal.aborted) return;
          if (!/\.(pdf|docx|txt|md)$/i.test(asset.name)) throw new Error('请选择 PDF、DOCX、TXT 或 Markdown 文件');
          if (!file.exists || file.size === 0) throw new Error('无法读取文件，或文件为空');
          if (file.size > maxBytes) throw new Error('简历文件不能超过 10 MB');
          setPhase('uploading');
          setProgress(0);
          const form = new FormData();
          // Expo fetch reads file parts through bytes(), while the picker caches them under a generated name.
          form.append('file', {
            name: asset.name, type: asset.mimeType || 'application/octet-stream', bytes: () => file.bytes(),
          } as unknown as Blob);
          const uploaded = await api<UploadTask>('/career/resumes', token, form, signal, { timeoutMs: 130_000 });
          if (!uploaded.taskId) throw new Error('职业服务未返回解析任务');
          task = { taskId: uploaded.taskId, name: asset.name };
          setSubmission(task);
          setProgress(uploaded.progress);
        } finally {
          try { if (file.exists) file.delete(); } catch { /* The copy stays in the system cache. */ }
        }
      }
      if (signal.aborted) return;
      setPhase('parsing');
      const record = await waitForResume(token, task.taskId, signal, setProgress);
      if (signal.aborted || !record) return;
      setSubmission(undefined);
      setHistory(undefined);
      onParsed({ ...record, fileName: task.name });
    } catch (cause) {
      if (signal.aborted) return;
      if (cause instanceof ApiError && cause.status === 401 && !cause.code?.startsWith('career_')) onAuthError();
      else {
        if (task && !isTemporaryError(cause)) setSubmission(undefined);
        setError(cause instanceof Error ? cause.message : '简历上传失败，请重试');
      }
    } finally {
      active.current = null;
      if (!signal.aborted) {
        setPhase(undefined);
        onLoadingChange(false);
      }
    }
  }

  async function toggleHistory() {
    if (disabled || active.current) return;
    if (history) {
      setHistory(undefined);
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    setLoadingHistory(true);
    onLoadingChange(true);
    setError('');
    try {
      const data = await api<{ items: ResumeRecord[] }>('/career/resumes?limit=20', token, undefined, controller.signal, { timeoutMs: 60_000 });
      if (!controller.signal.aborted) setHistory(data.items);
    } catch (cause) {
      if (!controller.signal.aborted) {
        if (cause instanceof ApiError && cause.status === 401 && !cause.code?.startsWith('career_')) onAuthError();
        else setError(cause instanceof Error ? cause.message : '读取简历失败，请重试');
      }
    } finally {
      active.current = null;
      if (!controller.signal.aborted) {
        setLoadingHistory(false);
        onLoadingChange(false);
      }
    }
  }

  const percent = Number.isFinite(progress) ? Math.round(Math.max(0, Math.min(100, progress))) : 0;
  return <>
    <Section>上传简历</Section>
    <Text style={styles.detail}>支持 PDF、DOCX、TXT 和 Markdown，最大 10 MB。解析完成后可核对能力画像。</Text>
    <Button label={phase === 'uploading' ? '正在上传…' : '选择简历文件'} secondary disabled={disabled || !!phase || loadingHistory} action={() => void run()} />
    {phase === 'parsing' ? <Notice text={percent ? `正在解析简历 · ${percent}%` : '正在解析简历…'} busy /> : null}
    {error ? <Notice text={error} error /> : null}
    {submission && !phase ? <Button label="继续查询解析进度" secondary disabled={disabled || loadingHistory} action={() => void run(submission)} /> : null}
    <Button label={loadingHistory ? '正在读取简历…' : history ? '收起已有简历' : '选用已有简历'} secondary
      disabled={disabled || !!phase || loadingHistory} action={() => void toggleHistory()} />
    {history && !phase ? history.length ? history.map(record =>
      <Row key={record.resumeId} title={record.fileName || '简历'} detail={record.confirmed ? '已确认' : '待确认'} icon="file-text"
        onPress={() => {
          if (disabled || active.current) return;
          setHistory(undefined);
          onParsed(record);
        }} />,
    ) : <Text style={styles.detail}>当前账号暂无已解析的简历。</Text> : null}
  </>;
}
