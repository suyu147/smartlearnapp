import { Directory, File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { ApiError, api, apiUrl, isTemporaryError } from './api';
import type { Report, ReviewBatch } from './types';

export type PracticeDraft = { version: number; step: number; answers: Record<string, string>; attemptId?: string };

type Submission = {
  attemptId: string; path: string; body: Record<string, unknown>; server: string;
};

export function readBatch(accountId: string): ReviewBatch | undefined {
  try {
    const { file } = storageFile(accountId, 'review-batch', 'selection');
    const value = JSON.parse(file.textSync());
    if (value.server === apiUrl('/') && Array.isArray(value.batch?.refs) && value.batch.refs.length) return value.batch;
  } catch { /* A batch can still be started online. */ }
}

export function saveBatch(accountId: string, batch?: ReviewBatch) {
  const { folder, file } = storageFile(accountId, 'review-batch', 'selection');
  if (batch) {
    folder.create({ idempotent: true, intermediates: true });
    file.write(JSON.stringify({ server: apiUrl('/'), batch }));
  } else if (file.exists) file.delete();
}

async function cacheFile(accountId: string, path: string) {
  const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, apiUrl(path));
  return storageFile(accountId, hash, 'cache');
}

export async function cacheLearning(accountId: string, path: string, value: unknown) {
  try {
    const { folder, file } = await cacheFile(accountId, path);
    const data = JSON.stringify(value);
    if (data.length > 4_000_000) return;
    folder.create({ idempotent: true, intermediates: true });
    file.write(data);
    const files = folder.list().filter((entry): entry is File => entry instanceof File && entry.name.endsWith('.cache'));
    if (files.length > 80) {
      files.sort((a, b) => (b.modificationTime ?? 0) - (a.modificationTime ?? 0));
      for (const old of files.slice(80)) old.delete();
    }
  } catch { /* Online content remains available. */ }
}

export async function getLearning<T>(accountId: string, path: string, token: string, signal?: AbortSignal) {
  try {
    const data = await api<T>(path, token, undefined, signal);
    if (!signal?.aborted && data !== null) void cacheLearning(accountId, path, data);
    return { data, offline: false };
  } catch (cause) {
    if (!isTemporaryError(cause) || signal?.aborted) throw cause;
    try {
      const { file } = await cacheFile(accountId, path);
      if (!signal?.aborted && file.exists) return { data: JSON.parse(file.textSync()) as T, offline: true };
    } catch { /* Report the original connection error. */ }
    throw cause;
  }
}

const outbox = (accountId: string) => new Directory(Paths.document, 'learning', encodeURIComponent(accountId), 'outbox');
const inFlight = new Map<string, Promise<Report>>();

export function queueSubmission(accountId: string, attemptId: string, path: string, body: Record<string, unknown>) {
  const folder = outbox(accountId);
  folder.create({ idempotent: true, intermediates: true });
  const file = new File(folder, attemptId + '.json');
  file.write(JSON.stringify({ attemptId, path, body, server: apiUrl('/') } satisfies Submission));
}

export function isSubmissionQueued(accountId: string, attemptId: string) {
  try { return new File(outbox(accountId), attemptId + '.json').exists; } catch { return false; }
}

export function sendQueuedSubmission(accountId: string, attemptId: string, token: string, signal?: AbortSignal): Promise<Report> {
  const file = new File(outbox(accountId), attemptId + '.json');
  const key = JSON.stringify([file.uri, token]);
  const active = inFlight.get(key);
  if (active) return active;
  const send = async () => {
    const reportPath = '/mobile/practice/attempts/' + encodeURIComponent(attemptId);
    if (!file.exists) return (await getLearning<Report>(accountId, reportPath, token, signal)).data;
    const submission = JSON.parse(file.textSync()) as Submission;
    if (submission.server !== apiUrl('/')) throw new ApiError('这份答案属于另一台学习服务器', 409);
    try {
      const report = await api<Report>(submission.path, token, submission.body, signal);
      await cacheLearning(accountId, reportPath, report);
      try { if (file.exists) file.delete(); } catch { /* The server will deduplicate another attempt. */ }
      return report;
    } catch (cause) {
      if (cause instanceof ApiError && [400, 404, 409].includes(cause.status)) {
        try { if (file.exists) file.delete(); } catch { /* A retry will surface the same validation error. */ }
      }
      throw cause;
    }
  };
  const pending = send().finally(() => inFlight.delete(key));
  inFlight.set(key, pending);
  return pending;
}

export async function flushSubmissions(accountId: string, token: string, signal: AbortSignal, onSync: () => void) {
  const folder = outbox(accountId);
  if (!folder.exists) return;
  for (const file of folder.list()) {
    if (signal.aborted) return;
    if (!(file instanceof File) || !/^[\da-f-]{36}\.json$/i.test(file.name)) continue;
    try {
      await sendQueuedSubmission(accountId, file.name.slice(0, -5), token, signal);
      if (!signal.aborted) onSync();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) throw cause;
      if (isTemporaryError(cause)) return;
      if (!signal.aborted && cause instanceof ApiError && [400, 404, 409].includes(cause.status)) onSync();
    }
  }
}

function storageFile(accountId: string, resourceId: string, kind: string) {
  const folder = new Directory(Paths.document, 'learning', encodeURIComponent(accountId));
  return { folder, file: new File(folder, encodeURIComponent(resourceId) + '.' + kind) };
}

export function readDraft(accountId: string, resourceId: string, version: number): PracticeDraft | undefined {
  try {
    const { file } = storageFile(accountId, resourceId, 'draft');
    if (!file.exists) return;
    const draft: PracticeDraft | null = JSON.parse(file.textSync());
    if (draft?.version === version && Number.isInteger(draft.step) && draft.answers &&
      typeof draft.answers === 'object' && !Array.isArray(draft.answers) &&
      (draft.attemptId === undefined || typeof draft.attemptId === 'string') &&
      Object.values(draft.answers).every(answer => typeof answer === 'string')) return draft;
  } catch { /* The current exercise can still be opened. */ }
}

export function saveDraft(accountId: string, resourceId: string, draft?: PracticeDraft) {
  const { folder, file } = storageFile(accountId, resourceId, 'draft');
  if (!draft) {
    if (file.exists) file.delete();
    return;
  }
  folder.create({ idempotent: true, intermediates: true });
  file.write(JSON.stringify(draft));
}

export function documentProgress(accountId: string, resourceId: string, mark?: 'opened' | 'read'): 'new' | 'opened' | 'read' {
  try {
    const { folder, file } = storageFile(accountId, resourceId, 'opened');
    const previous = file.exists ? file.textSync() : '';
    if (previous === 'read') return 'read';
    if (mark && (mark === 'read' || !previous)) {
      folder.create({ idempotent: true, intermediates: true });
      file.write(mark);
      return mark;
    }
    return previous ? 'opened' : 'new';
  } catch {
    return 'new';
  }
}
