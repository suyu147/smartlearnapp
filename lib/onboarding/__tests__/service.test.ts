import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DIMENSIONS, type ProfileDimensions } from '@/lib/types/profile';
import { createEmptyAnswers, type OnboardingRequest } from '../schema';
import { emptyAssessment } from '../mapping';

const mocks = vi.hoisted(() => ({
  call: vi.fn(), resolve: vi.fn(), find: vi.fn(), profileUpsert: vi.fn(), userUpsert: vi.fn(), lock: vi.fn(), transaction: vi.fn(), getProfile: vi.fn(),
}));
vi.mock('@/lib/ai/llm', () => ({ callLLM: mocks.call }));
vi.mock('@/lib/server/resolve-model', () => ({ resolveModel: mocks.resolve }));
vi.mock('@/lib/db/client', () => ({ prisma: {
  learningProfile: { findUnique: mocks.find }, $transaction: mocks.transaction,
} }));
vi.mock('@/lib/deeptutor/services/learner-profile', () => ({ getLearnerProfileService: () => ({ getProfile: mocks.getProfile }) }));
import { assessOnboardingText, submissionFingerprint, submitOnboarding } from '../service';

function request(): OnboardingRequest {
  return { submissionId: 'c7cd59e0-7aca-47f0-b0b3-06a1ad035346', mode: 'submit', textPolicy: 'extract',
    answers: { ...createEmptyAnswers(), role: 'student', subjects: ['数学'], goalKind: 'exam' } };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.resolve.mockReturnValue({ model: 'test-model' });
  mocks.find.mockResolvedValue(null);
  mocks.getProfile.mockResolvedValue({ dimensions: DEFAULT_DIMENSIONS });
  mocks.transaction.mockImplementation(async callback => callback({
    $queryRaw: mocks.lock, learningProfile: { findUnique: mocks.find, upsert: mocks.profileUpsert }, user: { upsert: mocks.userUpsert },
  }));
});
describe('questionnaire extraction and persistence', () => {
  it('does not call a model for choices, skip or explicit discard', async () => {
    await assessOnboardingText(request());
    await assessOnboardingText({ ...request(), mode: 'skip', answers: { ...request().answers, goalDescription: 'raw' } });
    await assessOnboardingText({ ...request(), textPolicy: 'discard', answers: { ...request().answers, goalDescription: 'raw' } });
    expect(mocks.call).not.toHaveBeenCalled();
  });
  it('makes one extraction call and rejects model values for missing or unconfirmed input', async () => {
    mocks.call.mockResolvedValue({ text: JSON.stringify({
      states: { ...emptyAssessment(), customSubjects: 'confirmed', goalDescription: 'confirmed' },
      values: { customSubjects: '幻觉学科', goalDescription: '掌握微积分', difficultyDetails: '应丢弃' },
    }) });
    const result = await assessOnboardingText({ ...request(), answers: { ...request().answers, goalDescription: '我想掌握微积分' } });
    expect(mocks.call).toHaveBeenCalledTimes(1);
    expect(result.customSubjects).toBe('pending');
    expect(result.values).toEqual({ goalDescription: '掌握微积分' });
  });
  it('leaves the database untouched if extraction fails', async () => {
    mocks.call.mockRejectedValue(new Error('provider request with raw private text'));
    await expect(submitOnboarding('test-user', { ...request(), answers: { ...request().answers, goalDescription: 'private raw' } }))
      .rejects.toMatchObject({ code: 'extraction_unavailable', status: 503 });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.userUpsert).not.toHaveBeenCalled();
  });
  it('writes profile and completion inside one locked transaction', async () => {
    await submitOnboarding('test-user', request());
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.lock).toHaveBeenCalledTimes(1);
    expect(mocks.profileUpsert.mock.calls[0][0].create.dimensions.onboarding.finishedBy).toBe('submitted');
    expect(mocks.userUpsert.mock.calls[0][0].update.profileCompletedAt).toBeInstanceOf(Date);
  });
  it('replays a saved submission without model calls, writes or version increments', async () => {
    const r = request();
    const dimensions: ProfileDimensions = { ...DEFAULT_DIMENSIONS, onboarding: {
      schemaVersion: 1, states: { identity: 'confirmed', subjects: 'confirmed', foundation: 'skipped', goals: 'confirmed', difficulties: 'skipped', formats: 'skipped', availability: 'skipped' },
      fieldStates: {}, submissionId: r.submissionId, submissionFingerprint: submissionFingerprint(r), finishedBy: 'submitted',
    } };
    mocks.find.mockResolvedValue({ dimensions });
    await submitOnboarding('test-user', r);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.call).not.toHaveBeenCalled();
  });
  it('detects accidental reuse of a submission ID for changed answers', async () => {
    const r = request();
    mocks.find.mockResolvedValue({ dimensions: { onboarding: { submissionId: r.submissionId, submissionFingerprint: 'different' } } });
    await expect(submitOnboarding('test-user', r)).rejects.toMatchObject({ code: 'submission_conflict', status: 409 });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
