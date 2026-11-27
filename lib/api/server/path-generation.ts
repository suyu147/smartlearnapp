import { Prisma } from '@prisma/client';
import prisma from '@/lib/utils/database';
import { HistoryConflict, ensureHistoryUser } from '@/lib/history/server';
import { mapResource } from './resource-persistence';
import type { LearningPath, LearningPathNode } from '@/lib/types/learning-path';
import type { Resource, ResourceType } from '@/lib/types/resource';

export const PATH_SESSION_MODE = 'learning-path';

export function isMobilePath(session: { metadata: unknown }) {
  return (session.metadata as { client?: string } | null)?.client === 'mobile';
}
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));

export function mapPath(record: NonNullable<Awaited<ReturnType<typeof prisma.learningPath.findFirst>>>): LearningPath {
  const nodes = record.nodes as unknown as LearningPathNode[];
  return {
    id: record.id, sessionId: record.sessionId, revision: record.revision, userId: record.userId, goal: record.goal,
    nodes, edges: record.edges as unknown as LearningPath['edges'], status: record.status,
    estimatedDays: Math.max(1, nodes.length),
    createdAt: record.createdAt.toISOString(), updatedAt: record.updatedAt.toISOString(),
  };
}

export function findPathSession(userId: string, id: string, includeLegacy = false) {
  return prisma.dtSession.findFirst({
    where: { id, userId, mode: { in: includeLegacy ? [PATH_SESSION_MODE, 'smartlearn'] : [PATH_SESSION_MODE] }, deletedAt: null },
  });
}

export async function createPathSession(userId: string, goal: string, mobile = false) {
  await ensureHistoryUser(userId);
  return prisma.dtSession.create({
    data: { userId, title: goal, mode: PATH_SESSION_MODE, ...(mobile ? { metadata: { client: 'mobile' } } : {}) },
  });
}

export async function readGeneratedPath(userId: string, sessionId: string) {
  const record = await prisma.learningPath.findFirst({
    where: { userId, sessionId, deletedAt: null, session: { userId, deletedAt: null } },
  });
  return record ? mapPath(record) : null;
}

export async function persistPlannedNode(userId: string, path: LearningPath, expectedSessionRevision: number) {
  const { sessionId } = path;
  if (!sessionId) throw new HistoryConflict();
  return prisma.$transaction(async tx => {
    // Reserve the next node against the session revision read before generation.
    const changed = await tx.dtSession.updateMany({
      where: { id: sessionId, userId, mode: PATH_SESSION_MODE, deletedAt: null, revision: expectedSessionRevision },
      data: { revision: { increment: 1 } },
    });
    if (!changed.count) throw new HistoryConflict('路径已更新，请刷新后重试');
    const data = { goal: path.goal, nodes: json(path.nodes), edges: json(path.edges), status: path.status };
    const record = await tx.learningPath.upsert({
      where: { sessionId },
      create: { ...data, id: sessionId, sessionId, userId },
      update: { ...data, revision: { increment: 1 } },
    });
    return mapPath(record);
  });
}

export async function persistNodeResource(userId: string, sessionId: string, nodeId: string, resource: Resource) {
  return prisma.$transaction(async tx => {
    const session = await tx.dtSession.updateMany({
      where: { id: sessionId, userId, mode: PATH_SESSION_MODE, deletedAt: null },
      data: { revision: { increment: 1 } },
    });
    if (!session.count) throw new HistoryConflict('学习会话已删除');
    const path = await tx.learningPath.findFirstOrThrow({ where: { userId, sessionId, deletedAt: null } });
    const nodes = path.nodes as unknown as LearningPathNode[];
    const node = nodes.find(item => item.id === nodeId);
    if (!node) throw new HistoryConflict('学习节点已更新');
    const previous = node.resources.find(item => item.type === resource.type);
    if (previous) {
      const existing = await tx.resource.findFirst({
        where: { id: previous.resourceId, userId, sessionId, deletedAt: null },
      });
      if (existing) return mapResource(existing);
    }
    const record = await tx.resource.create({ data: {
      id: resource.id, userId, sessionId, type: resource.type, title: resource.title, content: resource.content,
      metadata: json(resource.metadata), sourceAgent: resource.sourceAgent, status: 'ready',
    } });
    node.resources = [...node.resources.filter(item => item.type !== resource.type), {
      resourceId: record.id, type: record.type, title: record.title,
    }];
    await tx.pathNodeResource.create({ data: { pathId: path.id, nodeId, resourceId: record.id } });
    await tx.learningPath.update({
      where: { id: path.id }, data: { nodes: json(nodes), revision: { increment: 1 } },
    });
    return mapResource(record);
  });
}

export async function persistNodeRecommendation(userId: string, sessionId: string, nodeId: string, types: ResourceType[]) {
  await prisma.$transaction(async tx => {
    const session = await tx.dtSession.updateMany({
      where: { id: sessionId, userId, mode: PATH_SESSION_MODE, deletedAt: null },
      data: { revision: { increment: 1 } },
    });
    if (!session.count) throw new HistoryConflict('学习会话已删除');
    const path = await tx.learningPath.findFirstOrThrow({ where: { userId, sessionId, deletedAt: null } });
    const nodes = path.nodes as unknown as LearningPathNode[];
    const node = nodes.find(item => item.id === nodeId);
    if (!node) throw new HistoryConflict('学习节点已更新');
    node.recommendedTypes = types;
    await tx.learningPath.update({ where: { id: path.id }, data: { nodes: json(nodes), revision: { increment: 1 } } });
  });
}
