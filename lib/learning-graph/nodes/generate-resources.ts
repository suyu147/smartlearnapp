import { generateStandardPptDeck, generateStandardPptOutline, type StandardPptGenerationOptions } from '@/lib/generation/standard-ppt';
import type { LearningPath } from '@/lib/types/learning-path';
import { RESOURCE_TYPE_LABELS, type Resource, type ResourceType } from '@/lib/types/resource';
import { generateResource } from '../helpers/resource-generators';
import type { LearningStateType } from '../state';
import type { LearnEvent } from '../types';

export interface PathGenerationPersistence {
  path: LearningPath | null;
  saveNode(path: LearningPath): Promise<LearningPath>;
  saveResource(nodeId: string, resource: Resource): Promise<Resource>;
  saveRecommendation(nodeId: string, types: ResourceType[]): Promise<void>;
  readPath(): Promise<LearningPath | null>;
  signal: AbortSignal;
}

async function generateContent(type: ResourceType, state: LearningStateType, signal: AbortSignal) {
  const node = state.currentNode!;
  if (type !== 'ppt') return generateResource(type, node.knowledgePoints, state.profile, state.aiConfig);

  const options: StandardPptGenerationOptions = {
    topic: node.title.slice(0, 200), slideCount: 8, language: 'zh-CN',
    style: 'professional', includeImages: false, aiConfig: state.aiConfig,
  };
  const outline = await generateStandardPptOutline(options, signal);
  const deck = await generateStandardPptDeck(options, outline, signal);
  return {
    title: deck.title,
    content: deck.slides.map(slide => slide.title).join('\n'),
    metadata: { language: deck.language, standardPptData: deck },
  };
}

export async function generateResourcesNode(
  state: LearningStateType,
  config: { configurable?: {
    writer?: (event: LearnEvent) => void;
    userId?: string;
    pathPersistence?: PathGenerationPersistence;
  } },
) {
  const write = config.configurable?.writer ?? (() => undefined);
  const persistence = config.configurable?.pathPersistence;
  const userId = config.configurable?.userId ?? 'anonymous';
  const node = state.currentNode;
  const plan = state.resourcePlan;
  if (!node || !plan) return { phase: 'generate' };
  write({ type: 'phase_start', phase: 'generate' });

  const regenerating = state.action === 'generate_resources';
  const override = state.nodeDecisionOverrides?.[node.id];
  const recommended = plan.items.filter(item => item.action === 'generate' ||
    (override?.includes(item.type) && node.resources.some(resource => resource.type === item.type))).map(item => item.type);
  let types = recommended;
  if (regenerating && state.retryResourceType) types = [state.retryResourceType];
  else if (regenerating && !override) types = node.recommendedTypes ?? recommended;
  const plannedNode = { ...node, recommendedTypes: types };
  const previousPath = persistence?.path;
  const nodes = state.action === 'generate_resources' && previousPath
    ? previousPath.nodes
    : [...state.completedNodes.filter(item => item.id !== node.id), plannedNode];
  const now = new Date().toISOString();
  let path: LearningPath = {
    id: previousPath?.id ?? state.sessionId,
    sessionId: state.sessionId,
    userId,
    goal: state.goal,
    nodes,
    edges: state.action === 'generate_resources' && previousPath
      ? previousPath.edges
      : [...(previousPath?.edges ?? []), ...node.prerequisites.map(from => ({ from, to: node.id }))],
    estimatedDays: Math.max(1, nodes.length),
    status: previousPath?.status ?? 'active',
    createdAt: previousPath?.createdAt ?? now,
    updatedAt: now,
  };

  if (persistence && state.action !== 'generate_resources') path = await persistence.saveNode(path);
  if (persistence && regenerating && !state.retryResourceType && (override || !node.recommendedTypes)) {
    await persistence.saveRecommendation(node.id, types);
  }

  const generatedResources: Resource[] = [];
  const signal = persistence?.signal ?? new AbortController().signal;
  for (let start = 0; start < types.length; start += 3) {
    await Promise.all(types.slice(start, start + 3).map(async (type) => {
      if (node.resources.some(resource => resource.type === type)) return;
      const label = RESOURCE_TYPE_LABELS[type];
      write({ type: 'agent_status', agentId: type, agentName: label, status: 'running', resourceType: type });
      try {
        signal.throwIfAborted();
        const data = await generateContent(type, state, signal);
        signal.throwIfAborted();
        let resource: Resource = {
          ...data,
          id: crypto.randomUUID(), userId, type, status: 'ready',
          sourceAgent: type === 'ppt' ? 'resource-ppt' : 'learning-path',
          sessionId: state.sessionId, createdAt: new Date().toISOString(),
          metadata: { ...data.metadata, knowledgePoints: node.knowledgePoints, origin: 'learning-path', nodeId: node.id },
        };
        if (persistence) resource = await persistence.saveResource(node.id, resource);
        generatedResources.push(resource);
        write({ type: 'resource_delta', resource });
        write({ type: 'agent_status', agentId: type, agentName: label, status: 'completed', resourceType: type });
      } catch {
        write({ type: 'resource_failed', nodeId: node.id, resourceType: type, message: `${label}生成失败，可以单独重试` });
        write({ type: 'agent_status', agentId: type, agentName: label, status: 'failed', resourceType: type });
      }
    }));
  }

  if (persistence) {
    path = await persistence.readPath() ?? path;
  } else {
    path.nodes = path.nodes.map(item => item.id === node.id ? {
      ...item,
      resources: [...item.resources, ...generatedResources.map(resource => ({
        resourceId: resource.id, type: resource.type, title: resource.title,
      }))],
    } : item);
  }
  write({ type: 'path_update', path });
  write({ type: 'phase_end', phase: 'generate' });
  return { generatedResources, phase: 'generate' };
}
