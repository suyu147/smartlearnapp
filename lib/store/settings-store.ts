import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { apiGet, apiPut } from '@/lib/api-client';
import { getApiToken } from '@/lib/auth-token';
import type {
  TTSProviderId,
  ASRProviderId,
  TTSProviderConfig,
  ASRProviderConfig,
} from '@/lib/audio/types';


/** Shape of settings returned by the server (all fields optional for safe merging) */
const SYNCED_FIELDS = ["theme", "language", "defaultModel", "temperature", "maxTokens", "thinkingMode", "autoContextWindow", "contextWindowThreshold", "rateLimitEnabled", "sparkModelId", "generatePptImages", "pptMaxPages", "enablePptInteractive", "enablePptQuiz", "maxTurns", "selectedAgentIds", "smartlearnProviderId", "smartlearnModelId", "smartlearnBaseUrl", "disabledAgentIds", "maxResourceConcurrency", "ttsProviderId", "ttsVoice", "ttsSpeed", "asrProviderId", "asrLanguage"] as const;
type ServerSettingsResponse = Partial<Pick<SettingsState, typeof SYNCED_FIELDS[number]>> & { revision?: number };

interface SettingsState {
  // LLM
  defaultModel: string;
  temperature: number;
  maxTokens: number;
  thinkingMode: boolean;
  autoContextWindow: boolean;
  contextWindowThreshold: number;
  rateLimitEnabled: boolean;
  // Appearance
  theme: 'light' | 'dark' | 'snow' | 'glass' | 'system';
  language: string;
  // SmartLearn-specific settings (bridged from v1 useSettingsStore)
  smartlearnProviderId?: string;
  smartlearnModelId?: string;
  smartlearnApiKey?: string;
  smartlearnBaseUrl?: string;
  disabledAgentIds?: string[];
  maxResourceConcurrency?: number;
  // V1 bridge: Spark LLM provider
  sparkApiKey: string;
  sparkApiSecret: string;
  sparkModelId: string;
  // V1 bridge: PPT / agent selection
  generatePptImages: boolean;
  pptMaxPages: number | null;
  enablePptInteractive: boolean;
  enablePptQuiz: boolean;
  maxTurns: string;
  selectedAgentIds: string[];
  // V1 bridge: TTS
  ttsProviderId: TTSProviderId;
  ttsVoice: string;
  ttsSpeed: number;
  ttsProvidersConfig: Partial<Record<TTSProviderId, TTSProviderConfig>>;
  // V1 bridge: ASR
  asrProviderId: ASRProviderId;
  asrLanguage: string;
  asrProvidersConfig: Partial<Record<ASRProviderId, ASRProviderConfig>>;
  // Sync state (not persisted — resets on each page load)
  hydrated: boolean;
  revision: number;
  cacheOwner: string | null;
  // Methods — LLM
  setDefaultModel: (m: string) => void;
  setTemperature: (t: number) => void;
  setMaxTokens: (n: number) => void;
  toggleThinkingMode: () => void;
  toggleAutoContextWindow: () => void;
  toggleRateLimit: () => void;
  // Methods — Appearance
  setTheme: (t: SettingsState['theme']) => void;
  setLanguage: (l: string) => void;
  // Methods — SmartLearn
  setSmartlearnModel: (providerId: string, modelId: string) => void;
  setSmartlearnApiKey: (key: string) => void;
  setSmartlearnBaseUrl: (url: string) => void;
  setDisabledAgentIds: (ids: string[]) => void;
  setMaxResourceConcurrency: (n: number) => void;
  // Methods — V1 bridge setters
  setSparkApiKey: (key: string) => void;
  setSparkApiSecret: (secret: string) => void;
  setSparkModelId: (id: string) => void;
  setGeneratePptImages: (enabled: boolean) => void;
  setPptMaxPages: (pages: number | null) => void;
  setEnablePptInteractive: (enabled: boolean) => void;
  setEnablePptQuiz: (enabled: boolean) => void;
  setMaxTurns: (turns: string) => void;
  setSelectedAgentIds: (ids: string[]) => void;
  // Methods — Server sync
  syncFromServer: (force?: boolean) => Promise<void>;
  syncToServer: () => Promise<void>;
}

// In-flight settings reads are scoped by account so a late request for A cannot block B.
const settingsReads = new Map<string, Promise<void>>();

export const useSettingsStoreV2 = create<SettingsState>()(
  persist(
    (set, get) => ({
      // LLM defaults
      defaultModel: 'gpt-4o',
      temperature: 0.7,
      maxTokens: 4096,
      thinkingMode: true,
      autoContextWindow: true,
      contextWindowThreshold: 0.9,
      rateLimitEnabled: false,
      // Appearance defaults
      theme: 'system',
      language: 'zh-CN',
      // SmartLearn defaults
      smartlearnProviderId: '',
      smartlearnModelId: '',
      smartlearnApiKey: '',
      smartlearnBaseUrl: '',
      disabledAgentIds: [],
      maxResourceConcurrency: 3,
      // V1 bridge defaults — Spark
      sparkApiKey: '',
      sparkApiSecret: '',
      sparkModelId: 'generalv3',
      // V1 bridge defaults — PPT / agents
      generatePptImages: false,
      pptMaxPages: null,
      enablePptInteractive: true,
      enablePptQuiz: true,
      maxTurns: '',
      selectedAgentIds: [],
      // V1 bridge defaults — TTS
      ttsProviderId: 'openai-tts' as TTSProviderId,
      ttsVoice: 'alloy',
      ttsSpeed: 1.0,
      ttsProvidersConfig: {},
      // V1 bridge defaults — ASR
      asrProviderId: 'openai-whisper' as ASRProviderId,
      asrLanguage: 'auto',
      asrProvidersConfig: {},
      // Sync state
      hydrated: false,
      revision: 0,
      cacheOwner: null,

      // LLM methods
      setDefaultModel: (m) => set({ defaultModel: m }),
      setTemperature: (t) => set({ temperature: t }),
      setMaxTokens: (n) => set({ maxTokens: n }),
      toggleThinkingMode: () =>
        set((state) => ({ thinkingMode: !state.thinkingMode })),
      toggleAutoContextWindow: () =>
        set((state) => ({ autoContextWindow: !state.autoContextWindow })),
      toggleRateLimit: () =>
        set((state) => ({ rateLimitEnabled: !state.rateLimitEnabled })),

      // Appearance methods
      setTheme: (t) => set({ theme: t }),
      setLanguage: (l) => set({ language: l }),

      // SmartLearn methods
      setSmartlearnModel: (providerId, modelId) =>
        set({ smartlearnProviderId: providerId, smartlearnModelId: modelId }),
      setSmartlearnApiKey: (key) => set({ smartlearnApiKey: key }),
      setSmartlearnBaseUrl: (url) => set({ smartlearnBaseUrl: url }),
      setDisabledAgentIds: (ids) => set({ disabledAgentIds: ids }),
      setMaxResourceConcurrency: (n) => set({ maxResourceConcurrency: n }),

      // V1 bridge setters
      setSparkApiKey: (key) => set({ sparkApiKey: key }),
      setSparkApiSecret: (secret) => set({ sparkApiSecret: secret }),
      setSparkModelId: (id) => set({ sparkModelId: id }),
      setGeneratePptImages: (enabled) => set({ generatePptImages: enabled }),
      setPptMaxPages: (pages) => set({ pptMaxPages: pages }),
      setEnablePptInteractive: (enabled) => set({ enablePptInteractive: enabled }),
      setEnablePptQuiz: (enabled) => set({ enablePptQuiz: enabled }),
      setMaxTurns: (turns) => set({ maxTurns: turns }),
      setSelectedAgentIds: (ids) => set({ selectedAgentIds: ids }),

      // ------------------------------------------------------------------
      // Server sync
      // ------------------------------------------------------------------

      syncFromServer: async (force = false) => {
        const owner = get().cacheOwner;
        if (!owner || (get().hydrated && !force)) return;
        const token = getApiToken();
        const requestKey = `${owner}:${token ?? ''}`;
        const pending = settingsReads.get(requestKey);
        if (pending) return pending;
        const request = (async () => {
          const server = await apiGet<ServerSettingsResponse>('/api/v1/settings');
          if (getApiToken() !== token || get().cacheOwner !== owner) return;
          const merged: Record<string, unknown> = {};
          for (const field of SYNCED_FIELDS) if (server[field] !== undefined) merged[field] = server[field];
          set({ ...merged, revision: server.revision ?? 0, hydrated: true });
        })();
        settingsReads.set(requestKey, request);
        try { await request; }
        finally { if (settingsReads.get(requestKey) === request) settingsReads.delete(requestKey); }
      },
      syncToServer: async () => {
        const current = get();
        const token = getApiToken();
        const owner = current.cacheOwner;
        if (!current.hydrated) return;
        const payload = Object.fromEntries(SYNCED_FIELDS.map(field => [field, current[field]]));
        const server = await apiPut<ServerSettingsResponse>('/api/v1/settings', { ...payload, expectedRevision: current.revision });
        if (getApiToken() === token && get().cacheOwner === owner) set({ revision: server.revision ?? current.revision + 1 });
      },
    }),
    {
      name: 'settings-cloud-v1',
      partialize: (state) => {
        // Exclude hydrated from persistence so syncFromServer runs on each page load.
        // Methods are functions and automatically stripped by JSON serialization.
        const { hydrated: _hydrated, ...rest } = state;
        void _hydrated; // suppress unused-var lint
        return rest;
      },
    },
  ),
);
