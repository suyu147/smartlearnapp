import prisma from '@/lib/utils/database';
import { createLogger } from '@/lib/logger';
import type { Resource as FrontendResource } from '@/lib/types/resource';

const log = createLogger('server:resource-persistence');

/** Serialize value to a Prisma-safe JSON input using the same pattern as the existing codebase. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toJsonSafe(value: unknown): any {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Save a batch of resources for a user to the database.
 * Uses upsert (by id) so repeated saves are idempotent.
 */
export async function saveResources(
  userId: string,
  resources: FrontendResource[],
): Promise<void> {
  if (resources.length === 0) return;

  const operations = resources.map((r) =>
    prisma.resource.upsert({
      where: { id: r.id },
      update: {
        type: r.type,
        title: r.title,
        content: r.content,
        metadata: toJsonSafe(r.metadata ?? {}),
        sourceAgent: r.sourceAgent,
        status: r.status,
      },
      create: {
        id: r.id,
        userId,
        type: r.type,
        title: r.title,
        content: r.content,
        metadata: toJsonSafe(r.metadata ?? {}),
        sourceAgent: r.sourceAgent,
        status: r.status,
      },
    }),
  );

  await prisma.$transaction(operations);
  log.info(`Saved ${resources.length} resources for user=${userId}`);
}

/**
 * Load all resources for a user from the database.
 * Returns the most recently created resources first.
 */
export async function loadResources(userId: string): Promise<FrontendResource[]> {
  const records = await prisma.resource.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });

  return records.map(mapDbResourceToFrontend);
}

/**
 * Delete resources for a user.
 * When ids is omitted, deletes all resources owned by the user.
 * Returns the number of deleted records.
 */
export async function deleteResources(userId: string, ids?: string[]): Promise<number> {
  const targets = await prisma.resource.findMany({
    where: {
      userId,
      ...(ids && ids.length > 0 ? { id: { in: ids } } : {}),
    },
    select: { id: true },
  });
  const targetIds = targets.map((target) => target.id);
  if (targetIds.length === 0) return 0;

  // 资源可能被学习路径节点引用，先清理关联再删除，避免外键约束导致整批删除失败
  const [, result] = await prisma.$transaction([
    prisma.pathNodeResource.deleteMany({ where: { resourceId: { in: targetIds } } }),
    prisma.resource.deleteMany({ where: { id: { in: targetIds }, userId } }),
  ]);

  log.info(`Deleted ${result.count} resources for user=${userId}`);
  return result.count;
}

/**
 * Map a Prisma Resource record to the frontend Resource type.
 */
function mapDbResourceToFrontend(
  record: Awaited<ReturnType<typeof prisma.resource.findFirst>>,
): FrontendResource {
  if (!record) throw new Error('Unexpected null resource record');
  return {
    id: record.id,
    userId: record.userId,
    type: record.type as FrontendResource['type'],
    title: record.title,
    content: record.content,
    metadata: record.metadata as FrontendResource['metadata'],
    sourceAgent: record.sourceAgent,
    status: record.status as FrontendResource['status'],
    createdAt: record.createdAt.toISOString(),
  };
}
