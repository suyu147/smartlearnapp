import { startHistorySync, refreshLearningHistory as refreshHistory, flushLearningHistory as flushHistory, setHistoryBusy as markBusy } from './client';
import { startSettingsSync } from './settings-client';
interface AccountController { owner: string; stop: () => void; }
let active: AccountController | null = null;
let generation = 0;
export function startAccountSync(owner: string): () => void {
  if (active?.owner === owner) return active.stop;
  active?.stop();
  generation++;
  let stopped = false;
  const stopHistory = startHistorySync(owner);
  const stopSettings = startSettingsSync(owner);
  const controller: AccountController = { owner, stop() {
    if (stopped) return;
    stopped = true;
    stopHistory(); stopSettings();
    if (active === controller) { active = null; generation++; }
  } };
  active = controller;
  return controller.stop;
}
export function refreshAccountHistory(owner: string) {
  if (active?.owner === owner) return refreshHistory();
}
export async function flushAccountHistory(owner: string) {
  if (active?.owner !== owner) throw new Error('账号状态已切换，请刷新后重试');
  const generationAtStart = generation;
  await flushHistory();
  if (active?.owner !== owner || generation !== generationAtStart) throw new Error('账号状态已切换，请刷新后重试');
}
export function setAccountHistoryBusy(owner: string, id: string, busy: boolean) {
  if (active?.owner === owner) markBusy(id, busy);
}
