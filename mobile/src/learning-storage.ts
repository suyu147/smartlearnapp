import { Directory, File, Paths } from 'expo-file-system';

export type PracticeDraft = { version: number; step: number; answers: Record<string, string>; attemptId?: string };

function storageFile(accountId: string, resourceId: string, kind: string) {
  const folder = new Directory(Paths.document, 'learning', encodeURIComponent(accountId));
  return { folder, file: new File(folder, encodeURIComponent(resourceId) + '.' + kind) };
}

export function readDraft(accountId: string, resourceId: string, version: number): PracticeDraft | undefined {
  try {
    const { file } = storageFile(accountId, resourceId, 'draft');
    if (!file.exists) return;
    const draft: PracticeDraft | null = JSON.parse(file.textSync());
    if (draft?.version === version && Number.isInteger(draft.step) && draft.answers &&
      typeof draft.answers === 'object' && !Array.isArray(draft.answers) &&
      (draft.attemptId === undefined || typeof draft.attemptId === 'string') &&
      Object.values(draft.answers).every(answer => typeof answer === 'string')) return draft;
  } catch { /* The current exercise can still be opened. */ }
}

export function saveDraft(accountId: string, resourceId: string, draft?: PracticeDraft) {
  const { folder, file } = storageFile(accountId, resourceId, 'draft');
  if (!draft) {
    if (file.exists) file.delete();
    return;
  }
  folder.create({ idempotent: true, intermediates: true });
  file.write(JSON.stringify(draft));
}

export function documentProgress(accountId: string, resourceId: string, mark?: 'opened' | 'read'): 'new' | 'opened' | 'read' {
  try {
    const { folder, file } = storageFile(accountId, resourceId, 'opened');
    const previous = file.exists ? file.textSync() : '';
    if (previous === 'read') return 'read';
    if (mark && (mark === 'read' || !previous)) {
      folder.create({ idempotent: true, intermediates: true });
      file.write(mark);
      return mark;
    }
    return previous ? 'opened' : 'new';
  } catch {
    return 'new';
  }
}
