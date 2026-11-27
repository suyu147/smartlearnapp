export type Account = { id: string; username: string };
export type ResourceType = 'document' | 'mindmap' | 'quiz' | 'video' | 'code' | 'reading' | 'ppt';

export const resourceLabels: Record<ResourceType, string> = {
  document: '讲解文档', mindmap: '思维导图', quiz: '随堂练习', video: '教学视频',
  code: '代码案例', reading: '拓展阅读', ppt: 'PPTX',
};

export type Resource = {
  id: string;
  title: string;
  type: ResourceType;
  content: string;
  metadata?: {
    nodeId?: string;
    structuredDocument?: {
      introduction?: string; summary?: string;
      sections: { id: string; title: string; blocks: {
        type: string; title?: string; content?: string; headers?: string[]; rows?: string[][];
      }[] }[];
    };
    structuredReading?: {
      intro?: string;
      cards: { id: string; title: string; description: string; reason?: string }[];
      externalLinks: { title: string; url: string }[];
    };
    videoData?: { videos: { id: string; title: string; url: string; author?: string; duration?: string }[] };
  };
};

export type Node = {
  id: string;
  stage?: { id: string; title: string };
  title: string;
  status: 'locked' | 'available' | 'in_progress' | 'completed';
  knowledgePoints: string[];
  estimatedMinutes: number;
  recommendedTypes?: ResourceType[];
  resources: { resourceId: string; type: ResourceType; title: string }[];
};
export type LearningPath = { goal: string; revision?: number; nodes: Node[] };
export type Resume = {
  sessionId: string;
  nodeId: string;
  document?: { id: string };
  quiz?: { id: string; revision: number };
  attemptId: string | null;
};
export type PathSummary = {
  sessionId: string; goal: string; status: string; updatedAt: string;
  staged?: boolean;
  currentNode: { id: string; title: string } | null; completedCount: number; nodeCount: number;
};
export type Stats = { answered: number; accuracy: number; days: number };
export type WeeklyStats = {
  answered: number; accuracy: number | null; days: number; streak: number; accuracyChange: number | null;
  daily: { date: string; answered: number; correct: number }[];
  weakTopics: { topic: string; mastery: number }[];
};
export type Practice = {
  title: string; version: number;
  latestAttemptId: string | null;
  questions: { id: string; type: 'choice' | 'fill'; question: string; options?: string[] }[];
};
export type Report = ({ kind: 'practice' | 'review'; resourceId: string; version: number } | { kind: 'batch' }) & {
  attemptId: string;
  title: string; total: number; correctCount: number; score: number;
  focusTopics: string[];
  answers: { id: string; question: string; topic: string; userAnswer: string; correctAnswer: string; correct: boolean; explanation?: string }[];
};
export type ReviewTarget = { version: number } & ({ reportId: string } | { questionId: string });
export type ReviewMode = 'mistakes' | 'today';
export type ReviewQuestionRef = { resourceId: string; version: number; questionId: string };
export type ReviewBatch = { refs: ReviewQuestionRef[]; mode: ReviewMode; topic?: string };
export type ReviewItem = ReviewQuestionRef & {
  title: string; topic: string; question: string;
  mistakeCount: number; lastAnsweredAt: string; lastWrongAttemptId: string; pending: boolean; canReview: boolean;
};
export type ReviewList = { items: ReviewItem[]; total: number; topics: string[]; nextOffset: number | null; batch: ReviewQuestionRef[]; completedToday: number };
export type Chat = { id: string; title: string };
export type Message = { id: number; role: string; content: string };
