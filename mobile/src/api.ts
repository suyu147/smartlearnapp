import { fetch } from 'expo/fetch';

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
  const response = await fetch(apiUrl(path), {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const details = await response.json().catch(() => null) as { error?: string } | null;
    throw new ApiError(details?.error || '请求失败，请稍后重试', response.status);
  }
  return response;
}

export async function api<T>(path: string, token?: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await request(path, token, body, signal);
  const payload = await response.json();
  return payload.success === true && 'data' in payload ? payload.data : payload;
}

export type StreamEvent = {
  type: string;
  stage?: string;
  sessionId?: string;
  content?: string;
  metadata?: { learnEventType?: string; resourceType?: string; message?: string };
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
