import type { NextRequest } from 'next/server';
import prisma from '@/lib/utils/database';
import { HistoryConflict } from './server';
export async function mutateBook<T>(req: NextRequest, userId: string, bookId: string, operation: () => Promise<T>): Promise<T> {
  const header = req.headers.get('x-book-revision');
  const expectedRevision = header === null ? NaN : Number(header);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new HistoryConflict('请先加载书籍的最新版本');
  const token = crypto.randomUUID();
  const lock = await prisma.book.updateMany({ where: { id: bookId, userId, revision: expectedRevision, OR: [{ mutationUntil: null }, { mutationUntil: { lt: new Date() } }] }, data: { mutationToken: token, mutationUntil: new Date(Date.now() + 120_000), revision: { increment: 1 } } });
  if (lock.count !== 1) throw new HistoryConflict('书籍已更新、删除或正在生成，请刷新后重试');
  const heartbeat = setInterval(() => { void prisma.book.updateMany({ where: { id: bookId, userId, mutationToken: token }, data: { mutationUntil: new Date(Date.now() + 120_000) } }).catch(() => {}); }, 30_000);
  heartbeat.unref();
  try { return await operation(); }
  finally { clearInterval(heartbeat); await prisma.book.updateMany({ where: { id: bookId, userId, mutationToken: token }, data: { mutationToken: null, mutationUntil: null } }); }
}
