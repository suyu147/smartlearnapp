import { api, apiDelete, apiPut } from './api';

export type Notebook = {
  id: string;
  name: string;
  description: string;
  recordCount: number;
  createdAt: string;
  updatedAt: string;
};

export type NotebookRecord = {
  id: string;
  type: string;
  title: string;
  summary: string;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type NoteSource = {
  title: string;
  content: string;
  metadata: { source: 'chat' | 'document'; sessionId?: string; messageId?: number; resourceId?: string };
};

export function listNotebooks(token: string, signal?: AbortSignal) {
  return api<Notebook[]>('/mobile/notebooks', token, undefined, signal);
}

export function getNotebook(token: string, id: string, signal?: AbortSignal) {
  return api<{ notebook: Notebook; records: NotebookRecord[] }>(
    '/mobile/notebooks/' + encodeURIComponent(id), token, undefined, signal,
  );
}

export function createNotebook(token: string, name: string, description: string) {
  return api<Notebook>('/mobile/notebooks', token, { name, description });
}

export function saveNote(token: string, notebookId: string, note: {
  recordId?: string;
  expectedUpdatedAt?: string;
  title: string;
  content: string;
  metadata?: NoteSource['metadata'];
}) {
  return apiPut<NotebookRecord>('/mobile/notebooks/' + encodeURIComponent(notebookId), token, note);
}

export function removeNotebook(token: string, id: string) {
  return apiDelete('/mobile/notebooks/' + encodeURIComponent(id), token);
}

export function removeNote(token: string, notebookId: string, recordId: string) {
  return apiDelete('/mobile/notebooks/' + encodeURIComponent(notebookId) + '/records/' + encodeURIComponent(recordId), token);
}
