import { describe, expect, it } from 'vitest';
import { DEFAULT_DIMENSIONS } from '@/lib/types/profile';
import { calculateProfileCompleteness, getInfoState, getInfoDetails } from '@/lib/utils/profile-utils';
import { createEmptyAnswers, OnboardingRequestSchema, type OnboardingRequest } from '../schema';
import { buildOnboardingDimensions, emptyAssessment, getTextIssues } from '../mapping';

const request = (overrides: Partial<OnboardingRequest['answers']> = {}): OnboardingRequest => ({
  submissionId: 'c7cd59e0-7aca-47f0-b0b3-06a1ad035346', mode: 'submit', textPolicy: 'extract',
  answers: { ...createEmptyAnswers(), role: 'student', subjects: ['数学'], goalKind: 'exam', ...overrides },
});
describe('onboarding validation and authoritative dimensions', () => {
  it('normalizes older partial JSON records while preserving observed mastery', () => {
    const old = { knowledgeBase: { subjects: [{ name: '数学', mastery: 0.8 }] } } as unknown as typeof DEFAULT_DIMENSIONS;
    const d = buildOnboardingDimensions(old, request(), emptyAssessment(), 'digest');
    expect(d.knowledgeBase.subjects[0].mastery).toBe(0.8);
    expect(d.interests.preferredFormats).toEqual([]);
    expect(d.errorPatterns.commonMistakes).toEqual([]);
  });
  it('requires identity, subject and goal for submit, but permits a complete skip', () => {
    const input = { ...request(), answers: createEmptyAnswers() };
    expect(OnboardingRequestSchema.safeParse(input).success).toBe(false);
    expect(OnboardingRequestSchema.safeParse({ ...input, mode: 'skip' }).success).toBe(true);
  });
  it('rejects forged choices, impossible dates, oversized fields and unknown fields', () => {
    for (const answers of [{ subjects: ['伪造选项'] }, { targetDate: '2026-02-30' }, { goalDescription: 'a'.repeat(501) }, { gender: 'x' }]) {
      expect(OnboardingRequestSchema.safeParse({ ...request(), answers: { ...request().answers, ...answers } }).success).toBe(false);
    }
    expect(OnboardingRequestSchema.safeParse(request({ targetDate: '2028-02-29' })).success).toBe(true);
  });
  it('does not count any default as confirmed information', () => {
    expect(calculateProfileCompleteness(DEFAULT_DIMENSIONS)).toBe(0);
    expect(getInfoState(DEFAULT_DIMENSIONS, 'foundation')).toBe('pending');
    expect(getInfoDetails(DEFAULT_DIMENSIONS, 'foundation')).toEqual([]);
  });
  it('maps selections to existing planner fields and counts only three required items', () => {
    const d = buildOnboardingDimensions(undefined, request({ targetDate: '2027-06-07', formats: ['video', 'quiz'], timeSlots: ['晚上', '清晨'], duration: 45 }), emptyAssessment(), 'digest');
    expect(calculateProfileCompleteness(d)).toBe(100);
    expect(d.learningGoals.targetDate).toBe('2027-06-07');
    expect(d.learningGoals.shortTerm[0]).toContain('数学');
    expect(d.interests.preferredFormats).toEqual(['video', 'quiz']);
    expect(d.timePreference.preferredTimeSlot).toBe('晚上、清晨');
    expect(getInfoState(d, 'foundation')).toBe('skipped');
  });
  it('drops invalid and ambiguous text while retaining valid selections and field states', () => {
    const input = request({ goalDescription: 'garbage-do-not-store', difficultyDetails: 'vague-do-not-store' });
    const d = buildOnboardingDimensions(undefined, input, { ...emptyAssessment(), difficultyDetails: 'pending_confirmation' }, 'digest');
    expect(JSON.stringify(d)).not.toContain('do-not-store');
    expect(getInfoState(d, 'goals')).toBe('confirmed');
    expect(getInfoState(d, 'difficulties')).toBe('pending_confirmation');
    expect(getTextIssues(d)).toHaveLength(2);
  });
  it('writes extracted facts, never the unprocessed original string', () => {
    const d = buildOnboardingDimensions(undefined, request({ goalDescription: '闲聊：想掌握线性代数' }), {
      ...emptyAssessment(), goalDescription: 'confirmed', values: { goalDescription: '掌握线性代数' },
    }, 'digest');
    expect(d.learningGoals.shortTerm).toEqual(['掌握线性代数']);
    expect(JSON.stringify(d)).not.toContain('闲聊');
  });
  it('supports custom subjects without assuming a self-assessed level', () => {
    const d = buildOnboardingDimensions(undefined, request({ subjects: [], customSubjects: '摄影、色彩' }), {
      ...emptyAssessment(), customSubjects: 'confirmed', values: { customSubjects: '摄影、色彩' },
    }, 'digest');
    expect(d.knowledgeBase.subjects.map(v => v.name)).toEqual(['摄影', '色彩']);
    expect(getInfoState(d, 'foundation')).toBe('skipped');
  });
  it('does not persist discarded text and keeps the missing subject pending', () => {
    const d = buildOnboardingDimensions(undefined, { ...request({ subjects: [], customSubjects: 'unverified' }), textPolicy: 'discard' }, emptyAssessment(), 'digest');
    expect(JSON.stringify(d)).not.toContain('unverified');
    expect(getInfoState(d, 'subjects')).toBe('pending');
    expect(calculateProfileCompleteness(d)).toBe(67);
  });
  it('records skip without polluting defaults and preserves existing learner evidence', () => {
    const old = structuredClone(DEFAULT_DIMENSIONS);
    old.knowledgeBase.subjects = [{ name: '数学', mastery: 0.73 }];
    old.errorPatterns.commonMistakes = ['符号错误'];
    const d = buildOnboardingDimensions(old, { ...request(), mode: 'skip' }, emptyAssessment(), 'digest');
    expect(d.knowledgeBase.subjects[0].mastery).toBe(0.73);
    expect(d.errorPatterns.commonMistakes).toEqual(['符号错误']);
    expect(getInfoState(d, 'identity')).toBe('skipped');
    expect(calculateProfileCompleteness(d)).toBe(33);
    expect(old.onboarding).toBeUndefined();
  });
});
