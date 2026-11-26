import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { toast } from 'sonner';
import { useSettingsStoreV2 } from '@/lib/store/settings-store';
import { startSettingsSync } from '../settings-client';
const api = vi.hoisted(() => ({ body: {} as Record<string, unknown>, calls: [] as Array<{ path: string; body?: Record<string, unknown> }>, release: null as null | (() => void), requests: 0, failGet: false }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('@/lib/api-client', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/api-client')>();
  return { ...actual,
    apiGet: vi.fn(async () => { if (api.failGet) throw new Error('offline'); return { revision: 0, language: 'zh-CN', theme: 'system', pptMaxPages: null, ...api.body }; }),
    apiPut: vi.fn(async (path: string, body: Record<string, unknown>) => {
      api.calls.push({ path, body: structuredClone(body) }); const request = ++api.requests;
      if (api.release) await new Promise<void>(resolve => { api.release = resolve; });
      return { revision: Number(body.expectedRevision) + 1, ...body, request };
    }),
  };
});
let stop: (() => void) | undefined;
beforeEach(() => { api.body = {}; api.calls = []; api.release = null; api.requests = 0; api.failGet = false; vi.stubGlobal('window', new EventTarget()); vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' })); useSettingsStoreV2.setState({ ...useSettingsStoreV2.getInitialState(), cacheOwner: null, hydrated: false, revision: 0 }); vi.useFakeTimers(); });
afterEach(() => { stop?.(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('account-scoped settings sync', () => {
  it('syncs locale and PPT choices but never sends browser-only credentials', async () => {
    stop = startSettingsSync('account-a');
    await vi.waitFor(() => expect(useSettingsStoreV2.getState().hydrated).toBe(true));
    useSettingsStoreV2.getState().setLanguage('en-US'); useSettingsStoreV2.getState().setSmartlearnApiKey('browser-only-key'); useSettingsStoreV2.getState().setPptMaxPages(12);
    await vi.advanceTimersByTimeAsync(600);
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].body).toMatchObject({ language: 'en-US', pptMaxPages: 12, expectedRevision: 0 });
    expect(JSON.stringify(api.calls[0].body)).not.toContain('browser-only-key');
    expect(useSettingsStoreV2.getState().smartlearnApiKey).toBe('browser-only-key');
  });
  it('stops A before B starts and ignores a late A write even when credentials match', async () => {
    stop = startSettingsSync('account-a');
    await vi.waitFor(() => expect(useSettingsStoreV2.getState().hydrated).toBe(true));
    api.release = () => {}; 
    useSettingsStoreV2.getState().setLanguage('en-US');
    const pending = vi.advanceTimersByTimeAsync(600);
    await vi.waitFor(() => expect(api.requests).toBe(1));
    const release = api.release!;
    stop(); stop = startSettingsSync('account-b'); api.release = null;
    await vi.waitFor(() => expect(useSettingsStoreV2.getState().cacheOwner).toBe('account-b'));
    await vi.waitFor(() => expect(useSettingsStoreV2.getState().hydrated).toBe(true));
    const languageB = useSettingsStoreV2.getState().language;
    release(); await pending;
    expect(useSettingsStoreV2.getState().cacheOwner).toBe('account-b'); expect(useSettingsStoreV2.getState().language).toBe(languageB);
  });
  it('keeps settings unhydrated when the server is offline and never writes defaults', async () => {
    api.failGet = true; stop = startSettingsSync('account-a');
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(api.calls).toHaveLength(0); expect(useSettingsStoreV2.getState().hydrated).toBe(false);
  });
});
