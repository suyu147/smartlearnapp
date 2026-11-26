export interface KnowledgeBase {
  level: 'beginner' | 'intermediate' | 'advanced';
  subjects: { name: string; mastery: number }[];
  details?: string;
  selfAssessed?: boolean;
}
export interface CognitiveStyle {
  type: 'visual' | 'auditory' | 'reading' | 'kinesthetic';
  preference: string;
}
export interface LearningGoals {
  shortTerm: string[];
  longTerm: string;
  targetExam?: string;
  kind?: 'exam' | 'skill' | 'interest';
  targetDate?: string;
}
export interface WeakPoints { topics: string[]; errorPatterns: string[] }
export interface TimePreference {
  preferredDuration: number;
  preferredTimeSlot: string;
  frequency: 'daily' | 'weekly' | 'irregular';
}
export interface Interests {
  domains: string[];
  preferredFormats: ('document' | 'video' | 'code' | 'quiz' | 'mindmap')[];
}
export interface LearningPace { speed: 'slow' | 'moderate' | 'fast'; depthPreference: string }
export interface ErrorPatterns { commonMistakes: string[]; difficultAreas: string[] }

export type ProfileInfoKey = 'identity' | 'subjects' | 'foundation' | 'goals' | 'difficulties' | 'formats' | 'availability';
export type CollectionState = 'confirmed' | 'pending_confirmation' | 'pending' | 'skipped';
export type ProfileTextKey = 'identityDetail' | 'customSubjects' | 'foundationDetails' | 'goalDescription' | 'difficultyDetails';
export interface OnboardingMetadata {
  schemaVersion: 1;
  states: Record<ProfileInfoKey, CollectionState>;
  fieldStates: Partial<Record<ProfileTextKey, CollectionState>>;
  submissionId: string;
  submissionFingerprint: string;
  finishedBy: 'submitted' | 'skipped';
}

export interface ProfileDimensions {
  // Legacy dimensions remain available to learning/evaluation consumers.
  knowledgeBase: KnowledgeBase;
  cognitiveStyle: CognitiveStyle;
  learningGoals: LearningGoals;
  weakPoints: WeakPoints;
  timePreference: TimePreference;
  interests: Interests;
  learningPace: LearningPace;
  errorPatterns: ErrorPatterns;
  identity?: { role: 'student' | 'professional' | 'teacher' | 'self_learner' | 'other'; stage?: string; detail?: string };
  onboarding?: OnboardingMetadata;
}
export interface LearningProfile {
  id: string;
  userId: string;
  version: number;
  dimensions: ProfileDimensions;
  updatedAt: string;
  conversationHistory: ConversationMessage[];
}
export interface ConversationMessage { id: string; role: 'user' | 'assistant'; content: string; timestamp: number }
export const DEFAULT_DIMENSIONS: ProfileDimensions = {
  knowledgeBase: { level: 'beginner', subjects: [] },
  cognitiveStyle: { type: 'reading', preference: '' },
  learningGoals: { shortTerm: [], longTerm: '' },
  weakPoints: { topics: [], errorPatterns: [] },
  timePreference: { preferredDuration: 0, preferredTimeSlot: '', frequency: 'irregular' },
  interests: { domains: [], preferredFormats: [] },
  learningPace: { speed: 'moderate', depthPreference: '' },
  errorPatterns: { commonMistakes: [], difficultAreas: [] },
};
// Kept for the existing conversation component; seven-item displays use PROFILE_INFO_LABELS.
export const PROFILE_DIMENSION_LABELS = {
  knowledgeBase: '知识基础', cognitiveStyle: '认知风格', learningGoals: '学习目标',
  weakPoints: '薄弱知识点', timePreference: '时间偏好', interests: '兴趣方向',
  learningPace: '学习节奏', errorPatterns: '易错点', identity: '身份与学段',
};
export const PROFILE_INFO_LABELS: Record<ProfileInfoKey, string> = {
  identity: '身份与学段', subjects: '学科与领域', foundation: '现有基础',
  goals: '学习目标', difficulties: '薄弱与困难', formats: '内容形式偏好', availability: '可用时间',
};
export const PROFILE_INFO_KEYS = Object.keys(PROFILE_INFO_LABELS) as ProfileInfoKey[];
export const REQUIRED_PROFILE_KEYS: ProfileInfoKey[] = ['identity', 'subjects', 'goals'];
export const COLLECTION_STATE_LABELS: Record<CollectionState, string> = {
  confirmed: '已确认', pending_confirmation: '待确认', pending: '待补充', skipped: '已跳过',
};
