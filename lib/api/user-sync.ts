import { flushAccountHistory, refreshAccountHistory } from '@/lib/history/account-client';
export async function saveUserStateToServer(userId: string): Promise<void> { await flushAccountHistory(userId); }
export async function loadUserStateFromServer(userId: string): Promise<void> { await refreshAccountHistory(userId); }
