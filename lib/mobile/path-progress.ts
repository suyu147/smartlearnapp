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

export function nextUnlockedStageTask(nodes: LearningPathNode[], finishedTaskId: string) {
  const finishedIndex = nodes.findIndex(node => node.id === finishedTaskId && node.status === 'completed');
  const stage = nodes[finishedIndex]?.stage;
  if (!stage) return;
  const firstTask = nodes.slice(finishedIndex + 1).find(node => node.stage?.id !== stage.id);
  if (firstTask?.stage && firstTask.status !== 'locked') return firstTask;
}

export function isStageFirstTask(nodes: LearningPathNode[], task: LearningPathNode) {
  return !!task.stage && nodes.find(node => node.stage?.id === task.stage?.id)?.id === task.id;
}
