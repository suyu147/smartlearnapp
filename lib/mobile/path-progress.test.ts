import { describe, expect, it } from 'vitest';
import type { LearningPathNode } from '@/lib/types/learning-path';
import { applyStageProgress, currentStageTask } from './path-progress';

function task(id: string, stageId: string, hasQuiz = false): LearningPathNode {
  return {
    id, stage: { id: stageId, title: stageId }, title: id, estimatedMinutes: 30, knowledgePoints: [id],
    prerequisites: [], status: 'locked',
    resources: hasQuiz ? [{ resourceId: 'quiz-' + id, title: id, type: 'quiz' }] : [],
  };
}

describe('mobile stage progress', () => {
  it('unlocks a whole stage together and waits for every practice regardless of completion order', () => {
    const nodes = [task('one', 'first', true), task('two', 'first', true), task('three', 'second'), task('four', 'third')];
    const before = applyStageProgress(nodes, new Set());
    expect(before.map(node => node.status)).toEqual(['in_progress', 'in_progress', 'locked', 'locked']);

    const afterSecond = applyStageProgress(nodes, new Set(['quiz-two', 'not-a-task-quiz']));
    expect(afterSecond.map(node => node.status)).toEqual(['in_progress', 'completed', 'locked', 'locked']);

    const afterBoth = applyStageProgress(nodes, new Set(['quiz-one', 'quiz-two']));
    expect(afterBoth.map(node => node.status)).toEqual(['completed', 'completed', 'available', 'locked']);
    expect(currentStageTask(afterBoth)?.id).toBe('three');
    expect(nodes.every(node => node.status === 'locked')).toBe(true);
  });

  it('keeps legacy completions and resumes a started task before an unstarted one', () => {
    const legacy = { ...task('legacy', 'first'), status: 'completed' as const };
    const started = { ...task('chosen', 'second'), recommendedTypes: ['quiz'] as const };
    const nodes = [legacy, task('first-option', 'second'), { ...started, recommendedTypes: [...started.recommendedTypes] }];
    const progress = applyStageProgress(nodes, new Set());
    expect(progress.map(node => node.status)).toEqual(['completed', 'available', 'in_progress']);
    expect(currentStageTask(progress)?.id).toBe('chosen');
  });
});
