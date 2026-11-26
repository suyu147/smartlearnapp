import { toast } from 'sonner';
import { useSettingsStoreV2 } from '@/lib/store/settings-store';
import { ApiRequestError } from '@/lib/api-client';
export function startSettingsSync(owner: string): () => void {
  let stopped = false, applying = false, dirty = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let work: Promise<void> | null = null;
  const cache = useSettingsStoreV2.getState();
  useSettingsStoreV2.setState({ ...(cache.cacheOwner === owner ? {} : useSettingsStoreV2.getInitialState()), cacheOwner: owner, hydrated: false, revision: 0 });
  const fingerprint = () => {
    const state = useSettingsStoreV2.getState();
    return JSON.stringify({
      theme: state.theme, language: state.language, defaultModel: state.defaultModel,
      temperature: state.temperature, maxTokens: state.maxTokens, thinkingMode: state.thinkingMode,
      autoContextWindow: state.autoContextWindow, contextWindowThreshold: state.contextWindowThreshold,
      rateLimitEnabled: state.rateLimitEnabled, sparkModelId: state.sparkModelId,
      generatePptImages: state.generatePptImages, pptMaxPages: state.pptMaxPages,
      enablePptInteractive: state.enablePptInteractive, enablePptQuiz: state.enablePptQuiz,
      maxTurns: state.maxTurns, selectedAgentIds: state.selectedAgentIds,
      smartlearnProviderId: state.smartlearnProviderId, smartlearnModelId: state.smartlearnModelId,
      smartlearnBaseUrl: state.smartlearnBaseUrl, disabledAgentIds: state.disabledAgentIds,
      maxResourceConcurrency: state.maxResourceConcurrency, ttsProviderId: state.ttsProviderId,
      ttsVoice: state.ttsVoice, ttsSpeed: state.ttsSpeed, asrProviderId: state.asrProviderId,
      asrLanguage: state.asrLanguage,
    });
  };
  let saved = fingerprint();
  async function flush() {
    if (stopped) return;
    if (work) return work;
    work = (async () => {
      try {
        while (dirty && !stopped) {
          const next = fingerprint();
          await useSettingsStoreV2.getState().syncToServer();
          if (stopped) return;
          saved = next; dirty = fingerprint() !== saved;
        }
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 409) {
          dirty = false;
          applying = true; await useSettingsStoreV2.getState().syncFromServer(true); applying = false; saved = fingerprint();
        }
        if (!stopped) toast.error(error instanceof Error ? error.message : '设置保存失败');
      }
    })().finally(() => { work = null; });
    return work;
  }
  const unsubscribe = useSettingsStoreV2.subscribe((state, previous) => {
    if (stopped || applying) return;
    if (!previous.hydrated && state.hydrated) { saved = fingerprint(); return; }
    if (!state.hydrated || fingerprint() === saved) return;
    dirty = true; clearTimeout(timer); timer = setTimeout(() => void flush(), 500);
  });
  async function refresh() {
    try {
      await flush();
      if (stopped || dirty || useSettingsStoreV2.getState().cacheOwner !== owner) return;
      applying = true; await useSettingsStoreV2.getState().syncFromServer(true); applying = false;
      if (!stopped && useSettingsStoreV2.getState().cacheOwner === owner) saved = fingerprint();
    } catch (error) { applying = false; if (!stopped && useSettingsStoreV2.getState().cacheOwner === owner) toast.error(error instanceof Error ? error.message : '加载设置失败'); }
  }
  const onFocus = () => { if (document.visibilityState === 'visible') void refresh(); };
  window.addEventListener('focus', onFocus); window.addEventListener('online', onFocus); document.addEventListener('visibilitychange', onFocus);
  void refresh();
  return () => { stopped = true; clearTimeout(timer); unsubscribe(); window.removeEventListener('focus', onFocus); window.removeEventListener('online', onFocus); document.removeEventListener('visibilitychange', onFocus); };
}
