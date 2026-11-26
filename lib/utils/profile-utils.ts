import { PROFILE_INFO_KEYS, REQUIRED_PROFILE_KEYS, type CollectionState, type ProfileDimensions, type ProfileInfoKey } from '@/lib/types/profile';

export const ROLE_LABELS = { student: '学生', professional: '职场人士', teacher: '教师', self_learner: '自主学习者', other: '其他学习者' };
export const LEVEL_LABELS = { beginner: '入门', intermediate: '进阶', advanced: '高级' };
export const GOAL_LABELS = { exam: '应试备考', skill: '技能提升', interest: '兴趣探索' };
export const FORMAT_LABELS = { video: '视频', document: '文档', code: '实操', quiz: '练习', mindmap: '思维导图' };

export function getInfoState(dimensions: ProfileDimensions | null | undefined, key: ProfileInfoKey): CollectionState {
  if (!dimensions) return 'pending';
  const state = dimensions.onboarding?.states[key];
  if (state) return state;
  // Old records have no collection metadata. Never infer identity or self-assessed foundation from defaults.
  switch (key) {
    case 'identity': return dimensions.identity?.role ? 'confirmed' : 'pending';
    case 'subjects': return dimensions.knowledgeBase?.subjects?.length ? 'confirmed' : 'pending';
    case 'foundation': return dimensions.knowledgeBase?.details ? 'confirmed' : 'pending';
    case 'goals': return dimensions.learningGoals?.kind || dimensions.learningGoals?.shortTerm?.length || dimensions.learningGoals?.longTerm ? 'confirmed' : 'pending';
    case 'difficulties': return dimensions.weakPoints?.topics?.length ? 'confirmed' : 'pending';
    case 'formats': return dimensions.interests?.preferredFormats?.length ? 'confirmed' : 'pending';
    case 'availability': return dimensions.timePreference?.preferredDuration > 0 || dimensions.timePreference?.preferredTimeSlot ? 'confirmed' : 'pending';
  }
}
export function calculateProfileCompleteness(dimensions: ProfileDimensions | null | undefined): number {
  return Math.round(REQUIRED_PROFILE_KEYS.filter(key => getInfoState(dimensions, key) === 'confirmed').length / REQUIRED_PROFILE_KEYS.length * 100);
}
export function isProfileComplete(dimensions: ProfileDimensions | null | undefined): boolean {
  return REQUIRED_PROFILE_KEYS.every(key => getInfoState(dimensions, key) === 'confirmed');
}
export function calculateDimensionScores(dimensions: ProfileDimensions): Record<ProfileInfoKey, number> {
  return Object.fromEntries(PROFILE_INFO_KEYS.map(key => [key, getInfoState(dimensions, key) === 'confirmed' ? 100 : 0])) as Record<ProfileInfoKey, number>;
}
export function getInfoDetails(d: ProfileDimensions, key: ProfileInfoKey): string[] {
  const list = (items: (string | undefined)[]) => items.filter((item): item is string => !!item);
  switch (key) {
    case 'identity': return list([d.identity?.role && ROLE_LABELS[d.identity.role], d.identity?.stage, d.identity?.detail]);
    case 'subjects': return (d.knowledgeBase?.subjects ?? []).map(s => s.name);
    case 'foundation': return getInfoState(d, key) === 'confirmed' ? list([d.knowledgeBase.selfAssessed ? LEVEL_LABELS[d.knowledgeBase.level] : '', d.knowledgeBase.details]) : [];
    case 'goals': {
      const kind = d.learningGoals?.kind && GOAL_LABELS[d.learningGoals.kind];
      const goals = list([...(d.learningGoals?.shortTerm ?? []), d.learningGoals?.longTerm]);
      return list([kind && !goals.some(goal => goal.startsWith(kind)) ? kind : '', ...goals,
        d.learningGoals?.targetDate && '目标日期：' + d.learningGoals.targetDate]);
    }
    case 'difficulties': return d.weakPoints?.topics ?? [];
    case 'formats': return (d.interests?.preferredFormats ?? []).map(f => FORMAT_LABELS[f]);
    case 'availability': return list([d.timePreference?.preferredDuration > 0 ? '每次 ' + d.timePreference.preferredDuration + ' 分钟' : '', d.timePreference?.preferredTimeSlot]);
  }
}
