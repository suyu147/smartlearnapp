import { create } from 'zustand';
import { toast } from 'sonner';
import { apiGet, apiPut, apiDelete, ApiRequestError } from '@/lib/api-client';
import { useSessionsStore } from '@/lib/store/sessions';
import { useLearningPathStore } from '@/lib/store/learning-path';
import { useResourcesStore } from '@/lib/store/resources';
import { useResourceDecisionsStore } from '@/lib/store/resource-decisions';
import { useLearningProfileStore } from '@/lib/store/learning-profile';
import type { LearningHistorySnapshot, LearningHistoryRecord, ProfileHistoryRecord, ProfileHistoryPayload } from './types';

export const useHistorySyncStatus = create<{ owner: string | null; ready: boolean; saving: boolean; error: string | null }>(() => ({ owner: null, ready: false, saving: false, error: null }));
interface Controller { owner: string; refresh: () => Promise<void>; flush: () => Promise<void>; stop: () => void; }
let active: Controller | null = null;
const busySessions = new Set<string>();
export function setHistoryBusy(id: string, busy: boolean) {
  if (busy) busySessions.add(id); else { busySessions.delete(id); void active?.refresh().catch(() => {}); }
}
export async function refreshLearningHistory(expectedOwner?: string) {
  if (!active || (expectedOwner && active.owner !== expectedOwner)) return;
  await active.refresh();
}
export async function flushLearningHistory(expectedOwner?: string) {
  if (!active || (expectedOwner && active.owner !== expectedOwner)) throw new ApiRequestError('账号状态已切换，请刷新后重试', 409);
  await active.flush();
}

export function snapshotForSession(id: string): LearningHistorySnapshot | null {
  const sessions = useSessionsStore.getState();
  const session = sessions.sessions.find(s => s.id === id && s.cloudVersion === 1);
  if (!session) return null;
  const decisions = useResourceDecisionsStore.getState();
  return { session: { ...session, serverRevision: undefined }, path: useLearningPathStore.getState().storedPaths[id] ?? null,
    resources: useResourcesStore.getState().storedResources[id] ?? [], tutorMessages: sessions.tutorMessagesBySession[id] ?? [],
    decisions: { logs: decisions.logsBySession[id] ?? [], overrides: decisions.overridesBySession[id] ?? {}, feedback: decisions.feedbackBySession[id] ?? [] } };
}
function profilePayload(): ProfileHistoryPayload {
  const { profile, archivedProfiles, profileHistory } = useLearningProfileStore.getState();
  return { profile, archivedProfiles, profileHistory };
}

/** One account-scoped writer. Serializes changes, compares server revisions, and never uploads legacy caches. */
export function startHistorySync(owner: string): () => void {
  active?.stop();
  let stopped = false, applying = false, initialized = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let work: Promise<void> | null = null, refreshWork: Promise<void> | null = null;
  let canonicalVersion = 0;
  let profileRevision = 0, profileFingerprint = '', profileDirty = false, profileConflicted = false;
  const revisions = new Map<string, number>();
  const fingerprints = new Map<string, string>();
  const dirty = new Map<string, LearningHistorySnapshot>();
  const removed = new Set<string>(), conflicted = new Set<string>();
  const subscriptions: Array<() => void> = [];
  useHistorySyncStatus.setState({ owner, ready: false, error: null, saving: false });
  // Clear memory as well as persisted cache on account changes. Legacy storage keys are untouched.
  applying = true;
  useSessionsStore.setState({ sessions: [], currentSessionId: null, tutorMessagesBySession: {} });
  useLearningPathStore.setState({ storedPaths: {}, path: null, isPlanning: false, synced: false });
  useResourcesStore.setState({ storedResources: {}, resources: [], generatingTypes: [], synced: false, lastSyncedUserId: owner });
  useResourceDecisionsStore.setState({ logsBySession: {}, overridesBySession: {}, feedbackBySession: {} });
  useLearningProfileStore.getState().resetForNewUser();
  applying = false;

  function collect() {
    if (stopped || applying || !initialized) return;
    const ids = new Set<string>();
    for (const session of useSessionsStore.getState().sessions) {
      if (session.cloudVersion !== 1) continue;
      ids.add(session.id);
      const snapshot = snapshotForSession(session.id)!;
      const fingerprint = JSON.stringify(snapshot);
      if (fingerprint !== fingerprints.get(session.id) && !conflicted.has(session.id)) dirty.set(session.id, snapshot);
      else if (fingerprint === fingerprints.get(session.id)) dirty.delete(session.id);
    }
    for (const id of fingerprints.keys()) if (!ids.has(id) && !conflicted.has(id)) { removed.add(id); dirty.delete(id); }
    const fingerprint = JSON.stringify(profilePayload());
    profileDirty = !profileConflicted && fingerprint !== profileFingerprint;
    if (dirty.size || removed.size || profileDirty) {
      useHistorySyncStatus.setState({ saving: true });
      clearTimeout(timer);
      timer = setTimeout(() => { void flush().catch(() => {}); }, 700);
    }
  }
  async function flush(): Promise<void> {
    if (stopped || !initialized) return;
    if (work) return work;
    clearTimeout(timer);
    work = (async () => {
      try {
        while (!stopped && (dirty.size || removed.size || profileDirty)) {
          for (const id of [...removed]) {
            const revision = revisions.get(id) ?? 0;
            try {
              if (revision) await apiDelete(`/api/v1/learning-history?id=${encodeURIComponent(id)}&revision=${revision}`);
            } catch (error) {
              if (error instanceof ApiRequestError && error.status === 409) { removed.delete(id); conflicted.add(id); }
              throw error;
            }
            if (stopped) return;
            removed.delete(id); fingerprints.delete(id); revisions.delete(id);
          }
          for (const [id, snapshot] of [...dirty]) {
            if (stopped) return;
            try {
              const result = await apiPut<{ revision: number }>('/api/v1/learning-history', { expectedRevision: revisions.get(id) ?? 0, snapshot });
              if (stopped) return;
              revisions.set(id, result.revision); fingerprints.set(id, JSON.stringify(snapshot));
              if (dirty.get(id) === snapshot) dirty.delete(id);
              applying = true;
              useSessionsStore.setState(s => ({ sessions: s.sessions.map(session => session.id === id ? { ...session, serverRevision: result.revision } : session) }));
              applying = false;
            } catch (error) {
              if (error instanceof ApiRequestError && error.status === 409) { conflicted.add(id); dirty.delete(id); }
              throw error;
            }
          }
          if (profileDirty) {
            const payload = profilePayload();
            const fingerprint = JSON.stringify(payload);
            try {
              const result = await apiPut<{ revision: number; canonicalVersion: number }>('/api/v1/history/profile', { expectedRevision: profileRevision, expectedProfileVersion: canonicalVersion, payload });
              if (stopped) return;
              canonicalVersion = result.canonicalVersion; profileRevision = result.revision; profileFingerprint = fingerprint;
              profileDirty = JSON.stringify(profilePayload()) !== fingerprint;
            } catch (error) {
              if (error instanceof ApiRequestError && error.status === 409) { profileConflicted = true; profileDirty = false; }
              throw error;
            }
          }
        }
        if (!stopped) useHistorySyncStatus.setState({ saving: false, error: null });
      } catch (error) {
        if (stopped) return;
        const message = error instanceof Error ? error.message : '保存历史失败';
        useHistorySyncStatus.setState({ saving: false, error: message });
        toast.error(message, { id: 'history-sync-error' });
        throw error;
      }
    })().finally(() => { work = null; });
    return work;
  }
  async function refresh() {
    if (stopped || busySessions.size) return;
    if (refreshWork) return refreshWork;
    refreshWork = (async () => {
      try {
        // Flush new local edits before replacing caches. A conflict is resolved by loading the server copy.
        try { await flush(); } catch (error) { if (!(error instanceof ApiRequestError && error.status === 409)) throw error; }
        const [records, profile] = await Promise.all([apiGet<LearningHistoryRecord[]>('/api/v1/learning-history'), apiGet<ProfileHistoryRecord>('/api/v1/history/profile')]);
        if (stopped || busySessions.size || dirty.size || profileDirty) return;
        applying = true;
        const live = records.filter(r => !r.deletedAt);
        const current = useSessionsStore.getState().currentSessionId;
        const next = initialized && current === null ? null : live.some(r => r.id === current) ? current : live[0]?.id ?? null;
        const paths = Object.fromEntries(live.filter(r => r.snapshot.path).map(r => [r.id, r.snapshot.path!]));
        const resources = Object.fromEntries(live.map(r => [r.id, r.snapshot.resources]));
        useLearningPathStore.setState({ storedPaths: paths, path: next ? paths[next] ?? null : null });
        useResourcesStore.setState({ storedResources: resources, resources: next ? resources[next] ?? [] : [] });
        useResourceDecisionsStore.setState({ logsBySession: Object.fromEntries(live.map(r => [r.id, r.snapshot.decisions.logs])), overridesBySession: Object.fromEntries(live.map(r => [r.id, r.snapshot.decisions.overrides])), feedbackBySession: Object.fromEntries(live.map(r => [r.id, r.snapshot.decisions.feedback])) });
        useSessionsStore.setState({ sessions: live.map(r => ({ ...r.snapshot.session, cloudVersion: 1, serverRevision: r.revision })), currentSessionId: next, tutorMessagesBySession: Object.fromEntries(live.map(r => [r.id, r.snapshot.tutorMessages])) });
        useLearningProfileStore.setState({ ...profile.payload, lastSyncedUserId: owner });
        revisions.clear(); fingerprints.clear(); removed.clear(); conflicted.clear();
        for (const record of live) { revisions.set(record.id, record.revision); fingerprints.set(record.id, JSON.stringify(snapshotForSession(record.id))); }
        canonicalVersion = profile.canonicalVersion; profileRevision = profile.revision; profileFingerprint = JSON.stringify(profilePayload()); profileConflicted = false;
        initialized = true; applying = false;
        useHistorySyncStatus.setState({ ready: true, saving: false, error: null });
      } catch (error) {
        applying = false;
        if (!stopped) useHistorySyncStatus.setState({ error: error instanceof Error ? error.message : '加载历史失败' });
        throw error;
      }
    })().finally(() => { refreshWork = null; });
    return refreshWork;
  }
  function beforeUnload(event: BeforeUnloadEvent) {
    if (dirty.size || removed.size || profileDirty || work || busySessions.size) { event.preventDefault(); event.returnValue = ''; }
  }
  const onRefresh = () => { if (document.visibilityState === 'visible') void refresh().catch(() => {}); };
  const controller: Controller = { owner, refresh, flush, stop() {
    stopped = true; clearTimeout(timer); subscriptions.forEach(unsubscribe => unsubscribe());
    window.removeEventListener('focus', onRefresh); window.removeEventListener('online', onRefresh);
    document.removeEventListener('visibilitychange', onRefresh); window.removeEventListener('beforeunload', beforeUnload);
    busySessions.clear(); if (active === controller) active = null;
  } };
  active = controller;
  subscriptions.push(useSessionsStore.subscribe(collect), useLearningPathStore.subscribe(collect), useResourcesStore.subscribe(collect), useResourceDecisionsStore.subscribe(collect), useLearningProfileStore.subscribe(collect));
  window.addEventListener('focus', onRefresh); window.addEventListener('online', onRefresh);
  document.addEventListener('visibilitychange', onRefresh); window.addEventListener('beforeunload', beforeUnload);
  void refresh().catch(() => {});
  return controller.stop;
}
