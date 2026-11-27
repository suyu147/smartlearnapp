import type { LearningPathNode } from '@/lib/types/learning-path';

export function applyStageProgress(nodes: LearningPathNode[], practicedQuizIds: ReadonlySet<string>) {
  let locked = false;
  let stageId: string | undefined;
  let previousStageComplete = true;

  return nodes.map((node): LearningPathNode => {
    if (node.stage?.id !== stageId) {
      stageId = node.stage?.id;
      locked ||= !previousStageComplete;
      previousStageComplete = true;
    }

    const quiz = node.resources.find(resource => resource.type === 'quiz');
    if (node.status === 'completed' || (quiz && practicedQuizIds.has(quiz.resourceId))) {
      return { ...node, status: 'completed' };
    }

    previousStageComplete = false;
    const started = node.resources.length > 0 || !!node.recommendedTypes?.length;
    return { ...node, status: locked ? 'locked' : started ? 'in_progress' : 'available' };
  });
}

export function currentStageTask(nodes: LearningPathNode[]) {
  return nodes.find(node => node.status === 'in_progress') ?? nodes.find(node => node.status === 'available');
}
