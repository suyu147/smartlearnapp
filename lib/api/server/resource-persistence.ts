import { Prisma } from '@prisma/client';
import prisma from '@/lib/utils/database';
import type { Resource } from '@/lib/types/resource';
import { HistoryConflict, ensureHistoryUser } from '@/lib/history/server';
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
export async function saveResources(userId: string, resources: Resource[]): Promise<Resource[]> {
  await ensureHistoryUser(userId);
  return prisma.$transaction(async tx => {
    const saved: Resource[] = [];
    for (const resource of resources) {
      const existing = await tx.resource.findUnique({ where: { id: resource.id } });
      const data = { type: resource.type, title: resource.title, content: resource.content, metadata: json(resource.metadata ?? {}), sourceAgent: resource.sourceAgent, status: resource.status };
      if (!existing) {
        // Session resources are created atomically with their learning-history revision.
        if (resource.sessionId || resource.revision) throw new HistoryConflict();
        const record = await tx.resource.create({ data: { ...data, id: resource.id, userId } });
        saved.push(mapResource(record));
      } else {
        const changed = await tx.resource.updateMany({ where: { id: resource.id, userId, deletedAt: null, revision: resource.revision ?? 0 }, data: { ...data, revision: { increment: 1 } } });
        if (!changed.count) throw new HistoryConflict();
        if (existing.sessionId) {
          const session = await tx.dtSession.updateMany({ where: { id: existing.sessionId, userId, deletedAt: null }, data: { revision: { increment: 1 } } });
          if (!session.count) throw new HistoryConflict();
        }
        saved.push(mapResource((await tx.resource.findUniqueOrThrow({ where: { id: resource.id } }))));
      }
    }
    return saved;
  });
}
export async function loadResources(userId: string, sessionId?: string | null): Promise<Resource[]> {
  const records = await prisma.resource.findMany({ where: { userId, deletedAt: null, ...(sessionId !== undefined ? { sessionId } : {}), OR: [{ sessionId: null }, { session: { deletedAt: null } }] }, orderBy: { createdAt: 'desc' } });
  return records.map(mapResource);
}
export async function deleteResources(userId: string, ids?: string[]): Promise<number> {
  return prisma.$transaction(async tx => {
    const where = { userId, deletedAt: null, ...(ids ? { id: { in: ids } } : {}) };
    const targets = await tx.resource.findMany({ where, select: { id: true, sessionId: true } });
    const result = await tx.resource.updateMany({ where, data: { deletedAt: new Date(), revision: { increment: 1 } } });
    const sessionIds = [...new Set(targets.flatMap(r => r.sessionId ? [r.sessionId] : []))];
    await tx.dtSession.updateMany({ where: { userId, id: { in: sessionIds }, deletedAt: null }, data: { revision: { increment: 1 } } });
    const deleted = new Set(targets.map(r => r.id));
    const paths = await tx.learningPath.findMany({ where: { userId, sessionId: { in: sessionIds }, deletedAt: null } });
    for (const path of paths) {
      const nodes = (path.nodes as unknown as Array<{ resources?: Array<{ resourceId: string }> }>).map(node => ({ ...node, resources: node.resources?.filter(r => !deleted.has(r.resourceId)) ?? [] }));
      await tx.learningPath.update({ where: { id: path.id }, data: { nodes: json(nodes), revision: { increment: 1 } } });
    }
    return result.count;
  });
}
export function mapResource(record: NonNullable<Awaited<ReturnType<typeof prisma.resource.findFirst>>>): Resource {
  return { id: record.id, userId: record.userId, sessionId: record.sessionId, revision: record.revision, type: record.type, title: record.title, content: record.content, metadata: record.metadata as Resource['metadata'], sourceAgent: record.sourceAgent, status: record.status, createdAt: record.createdAt.toISOString(), updatedAt: record.updatedAt.toISOString() };
}
