import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Resource, ResourceType } from '@/lib/types/resource';
import { useSessionsStore } from './sessions';

interface StoredResourcesData {
  [sessionId: string]: Resource[];
}

interface ResourcesState {
  storedResources: StoredResourcesData;
  resources: Resource[];
  generatingTypes: ResourceType[];
  /** Whether data has been synced FROM the server for the current userId */
  synced: boolean;
  /** Which userId the synced flag refers to (reset when user switches) */
  lastSyncedUserId: string;

  addResource: (resource: Resource) => void;
  updateResource: (id: string, updates: Partial<Resource>) => void;
  removeResource: (id: string) => void;
  setGeneratingTypes: (types: ResourceType[]) => void;
  getResourcesByType: (type: ResourceType) => Resource[];
  loadResourcesForSession: (sessionId: string) => void;
  getResourcesForSession: (sessionId: string) => Resource[];
  reset: () => void;
  /** 彻底删除指定会话的资源数据 */
  deleteSessionData: (sessionId: string) => void;
  /** Fetch resources from server (by userId) and merge into current session */
  syncFromServer: (userId: string, sessionId: string) => Promise<void>;
  /** Push resources for all sessions to server (by userId) */
  syncToServer: (userId: string) => Promise<void>;
}

export const useResourcesStore = create<ResourcesState>()(
  persist(
    (set, get) => ({
      storedResources: {},
      resources: [],
      generatingTypes: [],
      synced: false,
      lastSyncedUserId: '',

      addResource: (resource) => {
        const sessionId = useSessionsStore.getState().currentSessionId;
        set((state) => {
          const updated = [...state.resources.filter(r => r.id !== resource.id), { ...resource, sessionId }];
          if (!sessionId) return { resources: updated };
          return {
            resources: updated,
            storedResources: { ...state.storedResources, [sessionId]: updated },
          };
        });
      },

      updateResource: (id, updates) => {
        const sessionId = useSessionsStore.getState().currentSessionId;
        set((state) => {
          const updated = state.resources.map((r) =>
            r.id === id ? { ...r, ...updates } : r,
          );
          if (!sessionId) return { resources: updated };
          return {
            resources: updated,
            storedResources: { ...state.storedResources, [sessionId]: updated },
          };
        });
      },

      removeResource: (id) => {
        const sessionId = useSessionsStore.getState().currentSessionId;
        set((state) => {
          const updated = state.resources.filter((r) => r.id !== id);
          if (!sessionId) return { resources: updated };
          return {
            resources: updated,
            storedResources: { ...state.storedResources, [sessionId]: updated },
          };
        });
      },

      setGeneratingTypes: (generatingTypes) => set({ generatingTypes }),

      getResourcesByType: (type) => get().resources.filter((r) => r.type === type),

      loadResourcesForSession: (sessionId) => {
        set((state) => ({
          resources: state.storedResources[sessionId] ?? [],
        }));
      },

      getResourcesForSession: (sessionId: string) => {
        return get().storedResources[sessionId] ?? [];
      },

      deleteSessionData: (sessionId: string) => {
        set((state) => {
          const { [sessionId]: _, ...rest } = state.storedResources;
          return { storedResources: rest, resources: state.resources, generatingTypes: state.generatingTypes };
        });
      },

      reset: () => {
        const sessionId = useSessionsStore.getState().currentSessionId;
        if (!sessionId) return set({ resources: [], generatingTypes: [] });
        set((state) => {
          const { [sessionId]: _, ...rest } = state.storedResources;
          return { storedResources: rest, resources: [], generatingTypes: [] };
        });
      },

      /**
       * Load resources from server for the given userId and merge them
       * into the current session's resource list.
       */
      syncFromServer: async (_userId: string, sessionId: string) => {
        const { refreshLearningHistory } = await import('@/lib/history/client');
        await refreshLearningHistory(_userId);
        if (useSessionsStore.getState().currentSessionId === sessionId) get().loadResourcesForSession(sessionId);
      },
      syncToServer: async (_userId: string) => {
        const { flushLearningHistory } = await import('@/lib/history/client');
        await flushLearningHistory(_userId);
      },
    }),
    {
      name: 'resources-cloud-v1',
      version: 3,
      partialize: () => ({}),
      migrate: (persisted: unknown) => {
        const old = persisted as { storedResources?: StoredResourcesData };
        return { storedResources: old.storedResources ?? {}, lastSyncedUserId: '' };
      },
    },
  ),
);
