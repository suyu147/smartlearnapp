import type { LearningSession, TutorChatMessage } from '@/lib/store/sessions';
import type { LearningPath } from '@/lib/types/learning-path';
import type { Resource } from '@/lib/types/resource';
import type { ResourceDecisionLog, NodeDecisionOverride, NodeDecisionFeedback } from '@/lib/store/resource-decisions';
import type { LearningProfile, ProfileDimensions } from '@/lib/types/profile';

export interface LearningHistorySnapshot {
  session: LearningSession;
  path: LearningPath | null;
  resources: Resource[];
  tutorMessages: TutorChatMessage[];
  decisions: {
    logs: ResourceDecisionLog[];
    overrides: Record<string, NodeDecisionOverride>;
    feedback: NodeDecisionFeedback[];
  };
}
export interface LearningHistoryRecord {
  id: string;
  revision: number;
  deletedAt: string | null;
  snapshot: LearningHistorySnapshot;
}
export interface ProfileHistoryPayload {
  profile: LearningProfile | null;
  archivedProfiles: Record<string, LearningProfile>;
  profileHistory: Array<{ version: number; dimensions: ProfileDimensions; updatedAt: string }>;
}
export interface ProfileHistoryRecord {
  revision: number;
  canonicalVersion: number;
  payload: ProfileHistoryPayload;
}
