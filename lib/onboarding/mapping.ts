import { z } from 'zod';
import { DEFAULT_DIMENSIONS, PROFILE_INFO_KEYS, type CollectionState, type ProfileDimensions, type ProfileInfoKey, type ProfileTextKey } from '@/lib/types/profile';
import { getInfoState, GOAL_LABELS } from '@/lib/utils/profile-utils';
import { TEXT_KEYS, type OnboardingAnswers, type OnboardingRequest } from './schema';

const stateSchema = z.enum(['confirmed', 'pending_confirmation', 'pending']);
export const TextAssessmentSchema = z.object({
  identityDetail: stateSchema, customSubjects: stateSchema, foundationDetails: stateSchema,
  goalDescription: stateSchema, difficultyDetails: stateSchema,
}).strict();
export type TextAssessment = z.infer<typeof TextAssessmentSchema> & { values?: Partial<Record<ProfileTextKey, string>> };
export const TextExtractionSchema = z.object({
  states: TextAssessmentSchema,
  values: z.object({
    identityDetail: z.string().trim().max(500).optional(),
    customSubjects: z.string().trim().max(500).optional(),
    foundationDetails: z.string().trim().max(500).optional(),
    goalDescription: z.string().trim().max(500).optional(),
    difficultyDetails: z.string().trim().max(500).optional(),
  }).strict(),
}).strict();
export const TEXT_FIELD_LABELS: Record<ProfileTextKey, string> = {
  identityDetail: '身份补充', customSubjects: '补充学科', foundationDetails: '已学内容',
  goalDescription: '目标描述', difficultyDetails: '困难描述',
};
export function emptyAssessment(): TextAssessment {
  return TextAssessmentSchema.parse(Object.fromEntries(TEXT_KEYS.map(key => [key, 'pending'])));
}
export function submittedText(a: OnboardingAnswers): Partial<Record<ProfileTextKey, string>> {
  return Object.fromEntries(TEXT_KEYS.filter(key => a[key].trim()).map(key => [key, a[key].trim()]));
}
export function buildOnboardingDimensions(
  current: ProfileDimensions | undefined, request: OnboardingRequest, assessment: TextAssessment, fingerprint: string,
): ProfileDimensions {
  const d: ProfileDimensions = structuredClone({
    ...DEFAULT_DIMENSIONS, ...current,
    knowledgeBase: { ...DEFAULT_DIMENSIONS.knowledgeBase, ...current?.knowledgeBase },
    cognitiveStyle: { ...DEFAULT_DIMENSIONS.cognitiveStyle, ...current?.cognitiveStyle },
    learningGoals: { ...DEFAULT_DIMENSIONS.learningGoals, ...current?.learningGoals },
    weakPoints: { ...DEFAULT_DIMENSIONS.weakPoints, ...current?.weakPoints },
    timePreference: { ...DEFAULT_DIMENSIONS.timePreference, ...current?.timePreference },
    interests: { ...DEFAULT_DIMENSIONS.interests, ...current?.interests },
    learningPace: { ...DEFAULT_DIMENSIONS.learningPace, ...current?.learningPace },
    errorPatterns: { ...DEFAULT_DIMENSIONS.errorPatterns, ...current?.errorPatterns },
  });
  const a = request.answers;
  const states = Object.fromEntries(PROFILE_INFO_KEYS.map(key => [key, getInfoState(current, key)])) as Record<ProfileInfoKey, CollectionState>;
  const fieldStates: Partial<Record<ProfileTextKey, CollectionState>> = {};
  const value = (key: ProfileTextKey) => assessment.values?.[key] ?? a[key].trim();
  const valid = (key: ProfileTextKey) => request.textPolicy === 'extract' && assessment[key] === 'confirmed' && !!a[key].trim() && !!value(key);
  const setState = (key: ProfileInfoKey, present: boolean, textKeys: ProfileTextKey[] = []) => {
    if (present || getInfoState(current, key) === 'confirmed') { states[key] = 'confirmed'; return; }
    states[key] = textKeys.some(k => fieldStates[k] === 'pending_confirmation') ? 'pending_confirmation'
      : textKeys.some(k => !!a[k]) ? 'pending' : 'skipped';
  };
  if (request.mode !== 'skip') {
    for (const key of TEXT_KEYS) {
      if (a[key]) fieldStates[key] = request.textPolicy === 'discard' ? 'pending' : assessment[key];
    }
    if (a.role) d.identity = { ...(d.identity?.role === a.role ? d.identity : {}), role: a.role, ...(a.role === 'student' && a.stage ? { stage: a.stage } : {}), ...(valid('identityDetail') ? { detail: value('identityDetail') } : {}) };
    setState('identity', !!d.identity?.role, ['identityDetail']);
    const custom = valid('customSubjects') ? value('customSubjects').split(/[、，,;；\n]+/).map(v => v.trim()).filter(Boolean).slice(0, 12) : [];
    const subjects = [...new Set([...a.subjects, ...custom])];
    if (subjects.length) d.knowledgeBase.subjects = subjects.map(name => ({
      name, mastery: current?.knowledgeBase?.subjects?.find(s => s.name === name)?.mastery ?? 0,
    }));
    setState('subjects', !!d.knowledgeBase.subjects.length, ['customSubjects']);
    if (a.level) { d.knowledgeBase.level = a.level; d.knowledgeBase.selfAssessed = true; }
    if (valid('foundationDetails')) d.knowledgeBase.details = value('foundationDetails');
    setState('foundation', !!a.level || valid('foundationDetails'), ['foundationDetails']);
    if (a.goalKind) {
      d.learningGoals.kind = a.goalKind;
      d.learningGoals.shortTerm = [valid('goalDescription') ? value('goalDescription')
        : (current?.learningGoals?.kind === a.goalKind && current.learningGoals.shortTerm.length ? current.learningGoals.shortTerm[0] : GOAL_LABELS[a.goalKind] + (d.knowledgeBase.subjects.length ? '：' + d.knowledgeBase.subjects.map(s => s.name).join('、') : ''))];
    }
    if (a.targetDate) d.learningGoals.targetDate = a.targetDate;
    setState('goals', !!a.goalKind, ['goalDescription']);
    const difficulties = [...a.difficulties, ...(valid('difficultyDetails') ? [value('difficultyDetails')] : [])];
    if (difficulties.length) d.weakPoints.topics = [...new Set(difficulties)];
    setState('difficulties', !!difficulties.length, ['difficultyDetails']);
    if (a.formats.length) d.interests.preferredFormats = a.formats;
    setState('formats', !!a.formats.length);
    if (a.duration) d.timePreference.preferredDuration = a.duration;
    if (a.timeSlots.length) d.timePreference.preferredTimeSlot = a.timeSlots.join('、');
    setState('availability', !!a.duration || !!a.timeSlots.length);
  } else {
    for (const key of PROFILE_INFO_KEYS) if (states[key] !== 'confirmed') states[key] = 'skipped';
  }
  d.onboarding = {
    schemaVersion: 1, states, fieldStates, submissionId: request.submissionId,
    submissionFingerprint: fingerprint, finishedBy: request.mode === 'skip' ? 'skipped' : 'submitted',
  };
  return d;
}
export function getTextIssues(d: ProfileDimensions) {
  return TEXT_KEYS.flatMap(key => {
    const state = d.onboarding?.fieldStates[key];
    return state && state !== 'confirmed' ? [{ field: key, label: TEXT_FIELD_LABELS[key], state }] : [];
  });
}
