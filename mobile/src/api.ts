import { fetch } from 'expo/fetch';
import type { LearningPath, Resource, ResourceType } from './types';

const base = (process.env.EXPO_PUBLIC_API_URL ?? '').trim().replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

export function apiUrl(path: string) {
  if (!/^https?:\/\/[^/]+/i.test(base)) throw new Error('请在 mobile/.env 设置 EXPO_PUBLIC_API_URL');
  return base + '/api/v1' + path;
}

async function request(path: string, token?: string, body?: unknown, signal?: AbortSignal) {
  const url = apiUrl(path);
  const response = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  }).catch(cause => {
    if (signal?.aborted) throw cause;
    throw new ApiError('无法连接学习服务器，请检查网络', 0);
  });
  if (!response.ok) {
    const details = await response.json().catch(() => null) as { error?: string } | null;
    throw new ApiError(details?.error || '请求失败，请稍后重试', response.status);
  }
  return response;
}

export async function api<T>(path: string, token?: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const active = new AbortController();
  const cancel = () => active.abort();
  if (signal?.aborted) cancel();
  signal?.addEventListener('abort', cancel);
  const timeout = setTimeout(cancel, 15_000);
  try {
    const response = await request(path, token, body, active.signal);
    const payload = await response.json();
    return payload.success === true && 'data' in payload ? payload.data : payload;
  } catch (cause) {
    if (signal?.aborted || cause instanceof ApiError) throw cause;
    if (active.signal.aborted || cause instanceof SyntaxError ||
      (cause instanceof Error && cause.message.startsWith('fetch failed:'))) {
      throw new ApiError('连接中断，请稍后重试', 0);
    }
    throw cause;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
  }
}

export const isTemporaryError = (cause: unknown) =>
  cause instanceof ApiError && (cause.status === 0 || cause.status === 408 || cause.status === 429 || cause.status >= 500);

export type StreamEvent = {
  type: string;
  stage?: string;
  sessionId?: string;
  content?: string;
  metadata?: {
    learnEventType?: string;
    resourceType?: ResourceType;
    status?: 'running' | 'completed' | 'failed';
    message?: string;
    resource?: Resource;
    practice?: Resource;
    path?: LearningPath;
  };
};

export async function stream(
  path: string, token: string, body: unknown, onEvent: (event: StreamEvent) => void, signal: AbortSignal,
) {
  const response = await request(path, token, body, signal);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('无法读取流式响应');
  const decoder = new TextDecoder();
  let buffer = '';
  let failure = '';
  let completed = false;
  function readLine(line: string) {
    if (!line.startsWith('data:')) return;
    const wire = JSON.parse(line.slice(5).trim()) as StreamEvent & { data?: StreamEvent };
    const event = wire.data ?? wire;
    if (event.type === 'error') failure = event.content || '生成失败，请重试';
    if (event.type === 'done' || event.type === 'session_complete') completed = true;
    onEvent(event);
  }

  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      buffer += decoder.decode(result.value, { stream: true });
      let end = buffer.indexOf('\n');
      while (end >= 0) {
        readLine(buffer.slice(0, end).trimEnd());
        buffer = buffer.slice(end + 1);
        end = buffer.indexOf('\n');
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) readLine(buffer.trimEnd());
    if (failure) throw new Error(failure);
    if (!completed) throw new Error('连接已断开，已保存的内容可重新打开');
  } finally {
    reader.releaseLock();
  }
}
