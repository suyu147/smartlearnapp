import { describe, it, expect } from 'vitest';
import { historyWriteSchema } from '../schemas';
import { SettingsUpdateSchema } from '@/lib/server/schemas';
describe('history contracts', () => {
  it('does not accept an unversioned browser bulk snapshot', () => {
    expect(historyWriteSchema.safeParse({ sessions: [] }).success).toBe(false);
    expect(historyWriteSchema.safeParse({ expectedRevision: -1, snapshot: {} }).success).toBe(false);
  });
  it('retains PPT settings, converts maxTurns, and accepts an explicit default reset', () => {
    const result = SettingsUpdateSchema.parse({ expectedRevision: 3, generatePptImages: true, pptMaxPages: null, enablePptInteractive: false, enablePptQuiz: false, maxTurns: '60' });
    expect(result).toMatchObject({ expectedRevision: 3, pptMaxPages: null, enablePptInteractive: false, enablePptQuiz: false, maxTurns: 60 });
  });
});
