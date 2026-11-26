/* eslint-disable @typescript-eslint/no-explicit-any -- isolated dynamic mock transport fixtures */
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
const api = vi.hoisted(() => ({ records: [] as any[], profile: { revision: 0, canonicalVersion: 0, payload: { profile: null, archivedProfiles: {}, profileHistory: [] } }, puts: [] as any[], deletes: [] as string[], delay: null as null | (() => Promise<void>) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('@/lib/api-client', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/api-client')>();
  return { ...actual,
    apiGet: vi.fn(async (path: string) => structuredClone(path.includes('/history/profile') ? api.profile : api.records)),
    apiPut: vi.fn(async (path: string, body: any) => {
      if (api.delay) await api.delay();
      api.puts.push(structuredClone(body));
      if (path.includes('/history/profile')) { api.profile = { revision: body.expectedRevision + 1, canonicalVersion: 0, payload: body.payload }; return { revision: api.profile.revision, canonicalVersion: 0 }; }
      const existing = api.records.find(record => record.id === body.snapshot.session.id);
      if (existing && (existing.deletedAt || existing.revision !== body.expectedRevision)) throw new actual.ApiRequestError('conflict', 409);
      const record = { id: body.snapshot.session.id, revision: body.expectedRevision + 1, deletedAt: null, snapshot: structuredClone(body.snapshot) };
      api.records = [...api.records.filter(record => record.id !== body.snapshot.session.id), record];
      return { revision: record.revision };
    }),
    apiDelete: vi.fn(async (path: string) => { api.deletes.push(path); const id = new URL(`http://localhost${path}`).searchParams.get('id'); const record = api.records.find(record => record.id === id); if (record) record.deletedAt = 'deleted'; return { deleted: true }; }),
  };
});
import { startHistorySync, refreshLearningHistory, flushLearningHistory, useHistorySyncStatus } from '../client';
import { useSessionsStore } from '@/lib/store/sessions';
import { useLearningPathStore } from '@/lib/store/learning-path';
import { useResourcesStore } from '@/lib/store/resources';
let stop: (() => void) | undefined;
beforeEach(() => {
  api.records = []; api.puts = []; api.deletes = []; api.delay = null;
  api.profile = { revision: 0, canonicalVersion: 0, payload: { profile: null, archivedProfiles: {}, profileHistory: [] } };
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
});
afterEach(() => { stop?.(); vi.unstubAllGlobals(); });
describe('history client coordination', () => {
  it('never uploads a legacy cache and starts with server-owned records only', async () => {
    useSessionsStore.setState({ sessions: [{ id: 'legacy', title: 'old', goal: '', profileId: '', status: 'active', createdAt: '', updatedAt: '' }] });
    stop = startHistorySync('account'); await refreshLearningHistory();
    expect(useSessionsStore.getState().sessions).toEqual([]); expect(api.puts).toEqual([]); expect(useHistorySyncStatus.getState().ready).toBe(true);
  });
  it('serializes new records and deletions without reuploading unrelated sessions', async () => {
    stop = startHistorySync('account'); await refreshLearningHistory();
    const session = useSessionsStore.getState().createSession('p', 'one');
    await flushLearningHistory(); expect(api.records).toHaveLength(1);
    useSessionsStore.getState().appendTutorMessage(session.id, { id: 'm', role: 'user', content: 'hello' });
    await flushLearningHistory(); expect(api.records[0].revision).toBe(2); expect(api.records[0].snapshot.tutorMessages).toHaveLength(1);
    useSessionsStore.getState().deleteSession(session.id); await flushLearningHistory(); await refreshLearningHistory();
    expect(api.deletes).toHaveLength(1); expect(useSessionsStore.getState().sessions).toEqual([]);
  });
  it('retains edits made while a previous save is in flight', async () => {
    stop = startHistorySync('account'); await refreshLearningHistory();
    const session = useSessionsStore.getState().createSession('p', 'one');
    let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; });
    api.delay = () => pending;
    const saving = flushLearningHistory();
    useSessionsStore.getState().appendTutorMessage(session.id, { id: 'm', role: 'user', content: 'new during save' });
    api.delay = null; release(); await saving;
    expect(api.records[0].snapshot.tutorMessages).toHaveLength(1); expect(api.records[0].revision).toBe(2);
  });
  it('loads the current session resources and path after a remote change or deletion', async () => {
    stop = startHistorySync('account'); await refreshLearningHistory();
    useSessionsStore.getState().createSession('p', 'one'); await flushLearningHistory();
    api.records[0].snapshot.path = { id: 'path', nodes: [], edges: [], goal: 'remote', status: 'active' };
    await refreshLearningHistory(); expect(useLearningPathStore.getState().path?.goal).toBe('remote');
    api.records[0].deletedAt = 'deleted'; await refreshLearningHistory();
    expect(useLearningPathStore.getState().path).toBeNull(); expect(useResourcesStore.getState().resources).toEqual([]);
  });
  it('keeps an explicit new-learning selection when refreshing', async () => {
    stop = startHistorySync('account'); await refreshLearningHistory();
    useSessionsStore.getState().createSession('p', 'one'); await flushLearningHistory();
    useSessionsStore.getState().switchSession(null);
    await refreshLearningHistory();
    expect(useSessionsStore.getState().currentSessionId).toBeNull();
    expect(useLearningPathStore.getState().path).toBeNull();
    expect(useResourcesStore.getState().resources).toEqual([]);
  });
  it('refuses a stale write and refreshes to the newer server version', async () => {
    stop = startHistorySync('account'); await refreshLearningHistory();
    const session = useSessionsStore.getState().createSession('p', 'one'); await flushLearningHistory();
    api.records[0].revision = 2; api.records[0].snapshot.session.title = 'remote';
    useSessionsStore.getState().updateSessionTitle(session.id, 'stale');
    await expect(flushLearningHistory()).rejects.toThrow('conflict');
    await refreshLearningHistory(); expect(useSessionsStore.getState().sessions[0].title).toBe('remote'); expect(useHistorySyncStatus.getState().error).toBeNull();
  });
});
