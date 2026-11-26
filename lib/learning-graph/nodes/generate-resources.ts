import { generateId } from '@/lib/utils';
import type { Resource } from '@/lib/types/resource';
import type { LearnEvent } from '../types';
import type { LearningStateType } from '../state';
import { generatePptScenes } from '../helpers/ppt-generator';
import type { Scene } from '@/lib/types/stage';

function getWriter(config: { configurable?: { writer?: (event: LearnEvent) => void } }) {
  return config.configurable?.writer ?? (() => undefined);
}

function getUserId(config: { configurable?: { userId?: string } }): string {
  return config.configurable?.userId ?? 'anonymous';
}

/**
 * 生成 PPT 资源。
 * 内容 + 动作合并生成，页面并行，并逐页推送 scene_ready。
 */
async function generatePptResource(
  knowledgePoints: string[],
  aiConfig: LearningStateType['aiConfig'],
  userId: string,
  write: (event: LearnEvent) => void,
  nodeId: string,
  generatePptImages: boolean,
): Promise<{ resource: Resource; pptScenes: Scene[] } | null> {
  write({ type: 'agent_status', agentId: 'ppt', agentName: '课件Agent', status: 'running', resourceType: 'ppt' });

  try {
    const pptScenes = await generatePptScenes(
      `讲解：${knowledgePoints.join('、')}`,
      aiConfig,
      generatePptImages,
      true,
      knowledgePoints,
      (msg) => write({ type: 'text_delta', text: `[PPT] ${msg}` }),
      (scene, completed, total) => {
        write({
          type: 'scene_ready',
          scene,
          index: completed - 1,
          total,
          nodeId,
          userId,
          knowledgePoints,
        });
      },
    );

    if (pptScenes.length > 0) {
      write({ type: 'ppt_ready', scenes: pptScenes, nodeId, userId, knowledgePoints });
      const resource: Resource = {
        id: generateId(),
        userId,
        type: 'ppt',
        title: `${knowledgePoints.join('、')} - 动态课件`,
        content: `PPT课件：共${pptScenes.length}页`,
        sourceAgent: 'ppt',
        status: 'ready',
        createdAt: new Date().toISOString(),
        metadata: { knowledgePoints, profileUsed: true, pptData: pptScenes },
      };
      write({ type: 'resource_delta', resource });
      write({ type: 'agent_status', agentId: 'ppt', agentName: '课件Agent', status: 'completed', resourceType: 'ppt' });
      return { resource, pptScenes };
    }

    // PPT 场景为空视为失败
    write({ type: 'agent_status', agentId: 'ppt', agentName: '课件Agent', status: 'failed', resourceType: 'ppt' });
    const fallbackResource: Resource = {
      id: generateId(),
      userId,
      type: 'ppt',
      title: `${knowledgePoints.join('、')} - ppt（生成失败）`,
      content: '资源生成失败，请重试',
      sourceAgent: 'ppt',
      status: 'failed',
      createdAt: new Date().toISOString(),
      metadata: { knowledgePoints, error: true },
    };
    write({ type: 'resource_delta', resource: fallbackResource });
    return null;
  } catch (_err) {
    write({ type: 'agent_status', agentId: 'ppt', agentName: '课件Agent', status: 'failed', resourceType: 'ppt' });
    const fallbackResource: Resource = {
      id: generateId(),
      userId,
      type: 'ppt',
      title: `${knowledgePoints.join('、')} - ppt（生成失败）`,
      content: '资源生成失败，请重试',
      sourceAgent: 'ppt',
      status: 'failed',
      createdAt: new Date().toISOString(),
      metadata: { knowledgePoints, error: true },
    };
    write({ type: 'resource_delta', resource: fallbackResource });
    return null;
  }
}

export async function generateResourcesNode(
  state: LearningStateType,
  config: { configurable?: { writer?: (event: LearnEvent) => void; userId?: string } },
) {
  const write = getWriter(config);
  const node = state.currentNode;
  const resourcePlan = state.resourcePlan;
  if (!node || !resourcePlan) return { phase: 'generate' };
  write({ type: 'phase_start', phase: 'generate' });

  try {
    // 智能学习只生成动态课件；PPT 内部仍保留 quiz / interactive 场景。
    const generatedResources: Resource[] = [];
    let pptScenes: Scene[] | null = null;

    if (resourcePlan.execution.shouldGeneratePPT) {
      const result = await generatePptResource(
        node.knowledgePoints,
        state.aiConfig,
        getUserId(config),
        write,
        node.id,
        state.generatePptImages ?? false,
      );
      if (result) {
        generatedResources.push(result.resource);
        pptScenes = result.pptScenes;
      }
    }

    // Build the full node list: all completed nodes + the current node with resource refs
    const nodeWithResources = { ...node, resources: generatedResources.map((resource) => ({ resourceId: resource.id, type: resource.type, title: resource.title })) };
    const allNodes = [...state.completedNodes, nodeWithResources]

    // Build edges: link each completed node to its successor, plus edge from last completed to current
    const allEdges: { from: string; to: string }[] = []
    for (let i = 0; i < state.completedNodes.length - 1; i++) {
      allEdges.push({ from: state.completedNodes[i].id, to: state.completedNodes[i + 1].id })
    }
    if (state.completedNodes.length > 0) {
      allEdges.push({ from: state.completedNodes[state.completedNodes.length - 1].id, to: node.id })
    }

    const path = {
      id: state.sessionId,
      userId: getUserId(config),
      goal: state.goal,
      nodes: allNodes,
      edges: allEdges,
      estimatedDays: Math.max(1, allNodes.length),
      status: 'active' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    write({ type: 'path_update', path });
    write({ type: 'phase_end', phase: 'generate' });
    return { generatedResources, pptScenes, phase: 'generate' };
  } catch (error) {
    write({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    write({ type: 'phase_end', phase: 'generate' });
    return { phase: 'generate' };
  }
}
