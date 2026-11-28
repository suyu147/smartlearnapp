import prisma from '@/lib/utils/database';
import { ensureHistoryUser } from '@/lib/history/server';
import { InsightError } from './insight-proxy';

type Kind = 'task' | 'resume';

function key(kind: Kind, id: string) {
  return 'career:' + kind + ':' + id;
}

export async function rememberCareerItem(userId: string, kind: Kind, id: string) {
  const documentKey = key(kind, id);
  await ensureHistoryUser(userId);
  await prisma.userHistoryDocument.upsert({
    where: { userId_key: { userId, key: documentKey } },
    create: { userId, key: documentKey, payload: { id } },
    update: {},
  });
}

export async function requireCareerItem(userId: string, kind: Kind, id: string) {
  const owner = await prisma.userHistoryDocument.findUnique({
    where: { userId_key: { userId, key: key(kind, id) } },
    select: { payload: true },
  });
  if (!owner || (owner.payload as { deleted?: boolean })?.deleted) {
    throw new InsightError(kind === 'task' ? '简历解析任务不存在' : '简历不存在', 404, 'career_not_found');
  }
}

export async function ownedCareerResumes(userId: string) {
  const prefix = key('resume', '');
  const rows = await prisma.userHistoryDocument.findMany({
    where: { userId, key: { startsWith: prefix } },
    select: { key: true, payload: true },
  });
  return new Set(rows.filter(row => !(row.payload as { deleted?: boolean })?.deleted).map(row => row.key.slice(prefix.length)));
}

export async function forgetCareerResume(userId: string, resumeId: string) {
  await prisma.userHistoryDocument.updateMany({
    where: { userId, key: key('resume', resumeId) },
    data: { payload: { id: resumeId, deleted: true } },
  });
}
