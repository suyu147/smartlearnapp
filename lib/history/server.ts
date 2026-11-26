import { Prisma } from '@prisma/client';
import prisma from '@/lib/utils/database';
import type { LearningHistoryRecord, LearningHistorySnapshot } from './types';

export class HistoryConflict extends Error {
  constructor(message = '记录已在其他设备更新或删除，请刷新后重试') { super(message); }
}
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
export async function ensureHistoryUser(userId: string) {
  await prisma.user.upsert({ where: { id: userId }, create: { id: userId, name: userId }, update: {} });
}
export async function listLearningHistory(userId: string): Promise<LearningHistoryRecord[]> {
  const [records, resources, paths] = await prisma.$transaction(async tx => {
    const records = await tx.dtSession.findMany({ where: { userId, mode: 'smartlearn', revision: { gt: 0 } }, orderBy: { updatedAt: 'desc' } });
    const resources = await tx.resource.findMany({ where: { userId, sessionId: { in: records.map(r => r.id) }, deletedAt: null } });
    const paths = await tx.learningPath.findMany({ where: { userId, sessionId: { in: records.map(r => r.id) }, deletedAt: null } });
    return [records, resources, paths] as const;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  return records.map(record => {
    const state = record.learningState as unknown as LearningHistorySnapshot;
    const path = paths.find(p => p.sessionId === record.id);
    return { id: record.id, revision: record.revision, deletedAt: record.deletedAt?.toISOString() ?? null, snapshot: {
      ...state,
      resources: resources.filter(r => r.sessionId === record.id).map(r => ({ ...r, metadata: r.metadata ?? undefined, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() })) as unknown as LearningHistorySnapshot['resources'],
      path: path ? { ...state.path!, ...path, nodes: path.nodes, edges: path.edges, createdAt: path.createdAt.toISOString(), updatedAt: path.updatedAt.toISOString() } as unknown as LearningHistorySnapshot['path'] : null,
    } };
  });
}
export async function writeLearningHistory(userId: string, expectedRevision: number, snapshot: LearningHistorySnapshot) {
  await ensureHistoryUser(userId);
  const id = snapshot.session.id;
  return prisma.$transaction(async tx => {
    const existing = await tx.dtSession.findUnique({ where: { id } });
    const state = { ...snapshot, resources: [], path: snapshot.path ? { ...snapshot.path, userId, sessionId: id } : null };
    if (!existing) {
      if (expectedRevision !== 0) throw new HistoryConflict();
      await tx.dtSession.create({ data: { id, userId, mode: 'smartlearn', title: snapshot.session.title, revision: 1, learningState: json(state) } });
    } else {
      const updated = await tx.dtSession.updateMany({ where: { id, userId, mode: 'smartlearn', revision: expectedRevision, deletedAt: null }, data: { title: snapshot.session.title, learningState: json(state), revision: { increment: 1 } } });
      if (updated.count !== 1) throw new HistoryConflict();
    }
    const revision = expectedRevision + 1;
    const path = snapshot.path;
    if (path) {
      await tx.learningPath.updateMany({ where: { userId, sessionId: id, id: { not: path.id } }, data: { sessionId: null, deletedAt: new Date() } });
      const existingPath = await tx.learningPath.findUnique({ where: { id: path.id } });
      if (existingPath && (existingPath.userId !== userId || existingPath.sessionId !== id)) throw new HistoryConflict('路径归属不匹配');
      await tx.learningPath.upsert({ where: { id: path.id }, create: { id: path.id, userId, sessionId: id, goal: path.goal, nodes: json(path.nodes), edges: json(path.edges), status: path.status, revision }, update: { goal: path.goal, nodes: json(path.nodes), edges: json(path.edges), status: path.status, deletedAt: null, revision } });
    } else {
      await tx.learningPath.updateMany({ where: { userId, sessionId: id, deletedAt: null }, data: { deletedAt: new Date(), revision } });
    }
    const resourceIds = snapshot.resources.map(r => r.id);
    const existingResources = await tx.resource.findMany({ where: { id: { in: resourceIds } }, select: { id: true, userId: true, sessionId: true, deletedAt: true } });
    for (const r of existingResources) {
      if (r.userId !== userId || r.sessionId !== id || r.deletedAt) throw new HistoryConflict('资源已删除或归属不匹配');
    }
    for (const resource of snapshot.resources) {
      const data = { type: resource.type, title: resource.title, content: resource.content, metadata: json(resource.metadata ?? {}), sourceAgent: resource.sourceAgent, status: resource.status, revision };
      await tx.resource.upsert({ where: { id: resource.id }, create: { ...data, id: resource.id, userId, sessionId: id }, update: data });
    }
    await tx.resource.updateMany({ where: { userId, sessionId: id, id: { notIn: resourceIds }, deletedAt: null }, data: { deletedAt: new Date(), revision } });
    return { revision };
  }, { timeout: 30_000 });
}
export async function deleteLearningHistory(userId: string, id: string, expectedRevision: number) {
  return prisma.$transaction(async tx => {
    const result = await tx.dtSession.updateMany({ where: { id, userId, revision: expectedRevision, deletedAt: null }, data: { deletedAt: new Date(), revision: { increment: 1 } } });
    if (!result.count) throw new HistoryConflict();
    await tx.resource.updateMany({ where: { userId, sessionId: id, deletedAt: null }, data: { deletedAt: new Date(), revision: { increment: 1 } } });
    await tx.learningPath.updateMany({ where: { userId, sessionId: id, deletedAt: null }, data: { deletedAt: new Date(), revision: { increment: 1 } } });
    return { deleted: true };
  });
}
