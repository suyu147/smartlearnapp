/**
 * Clear all user-specific persisted store data from localStorage
 * Called on logout to prevent cross-user data contamination
 */

// List of all localStorage keys used by Zustand stores that need to be cleared on logout
// IMPORTANT: Keep in sync with the `name` option in each store's persist() middleware
const PERSISTED_STORE_KEYS = [
  'auth-jwt',
  'settings-cloud-v1',
  'learning-sessions-cloud-v1',
  'learning-path-cloud-v1',
  'resources-cloud-v1',
  'resource-decisions-cloud-v1',
  'learning-profile-cloud-v1',
  'chat-messages-cloud-v1',
  'chat-sessions-cloud-v1',
  'user-profile-storage',
  'learning-profile-storage',
  'chat-storage',
  'sl-session-storage',
  'learning-sessions-storage',
  'sl-settings-storage',
  'settings-storage',
  'sl-book-storage',
  'sl-knowledge-storage',
  'sl-memory-storage',
  'sl-cowriter-storage',
  'resources-storage',
  'learning-path-storage',
  'sl-ui-storage',
  'agent-activity-storage',
  'resource-decisions-storage',
] as const;

export function clearAllUserData(): void {
  if (typeof window === 'undefined') return;

  PERSISTED_STORE_KEYS.forEach((key) => {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      console.warn(`Failed to clear localStorage key ${key}:`, e);
    }
  });
}
