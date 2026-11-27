import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, stream } from './api';
import type { LearningPath, Resource, ResourceType } from './types';

export type Generation = {
  sessionId?: string;
  nodeId?: string;
  resourceType?: ResourceType;
  running: boolean;
  stage: string;
  path?: LearningPath;
  resources: Resource[];
  statuses: Partial<Record<ResourceType, 'running' | 'completed' | 'failed'>>;
  error?: string;
};

const phases: Record<string, string> = {
  plan: '正在规划课节', analyze: '正在分析学习画像',
  resource_plan: '正在选择课节资源', generate: '正在生成课节资源',
};

export function usePathGeneration(token: string | undefined, onAuthError: () => void) {
  const [generation, setGeneration] = useState<Generation>();
  const controller = useRef<AbortController | null>(null);
  const reset = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    setGeneration(undefined);
  }, []);
  useEffect(() => () => controller.current?.abort(), []);

  async function run(
    endpoint: string, body: { currentNodeId?: string; resourceType?: ResourceType; [key: string]: unknown },
    sessionId?: string, onSession?: (id: string) => void,
  ) {
    if (!token || controller.current) return;
    const active = new AbortController();
    controller.current = active;
    let currentId = sessionId;
    setGeneration({
      sessionId, nodeId: body.currentNodeId,
      resourceType: body.resourceType, running: true, stage: '正在连接学习服务', resources: [], statuses: {},
    });
    try {
      await stream(endpoint, token, body, event => {
        if (active.signal.aborted) return;
        if (!currentId && event.sessionId) {
          currentId = event.sessionId;
          onSession?.(currentId);
        }
        const { metadata } = event;
        const resource = metadata?.resource ?? metadata?.practice;
        const path = metadata?.path;
        const type = metadata?.resourceType;
        const status = metadata?.learnEventType === 'resource_failed' ? 'failed' : metadata?.status;
        setGeneration(previous => {
          if (!previous) return previous;
          return {
            ...previous,
            sessionId: currentId,
            nodeId: metadata?.node?.id ?? previous.nodeId ?? path?.nodes.find(node => node.status === 'in_progress')?.id,
            stage: phases[event.stage ?? ''] ?? previous.stage,
            path: path ?? previous.path,
            resources: resource ? [...previous.resources.filter(item => item.id !== resource.id), resource] : previous.resources,
            statuses: type && status ? { ...previous.statuses, [type]: status } : previous.statuses,
          };
        });
      }, active.signal);
    } catch (cause) {
      if (active.signal.aborted) return;
      if (cause instanceof ApiError && cause.status === 401) onAuthError();
      else setGeneration(previous => previous && ({
        ...previous, error: cause instanceof Error ? cause.message : '生成中断，可重试缺少的资源',
      }));
    } finally {
      if (controller.current === active) {
        controller.current = null;
        setGeneration(previous => previous && ({ ...previous, running: false }));
      }
    }
  }

  return { generation, reset, run };
}
