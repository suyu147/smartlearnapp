/**
 * CowriterDbService — PostgreSQL-backed co-writer document persistence
 */

import { createLogger } from '@/lib/logger';
import prisma from '@/lib/db/client';
import { Prisma } from '@prisma/client';
import { HistoryConflict } from '@/lib/history/server';

const log = createLogger('CowriterDbService');

export interface CowriterDocRecord {
  id: string;
  userId: string;
  title: string;
  content: string;
  version: number;
  status: string;
  lastEdited: Date;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export class CowriterDbService {
  async listDocuments(userId: string): Promise<CowriterDocRecord[]> {
    try {
      return await prisma.cowriterDocument.findMany({
        where: { userId },
        orderBy: { lastEdited: 'desc' },
      }) as CowriterDocRecord[];
    } catch (err) {
      log.error('listDocuments failed:', err);
      return [];
    }
  }

  async getDocument(docId: string): Promise<CowriterDocRecord | null> {
    try {
      return await prisma.cowriterDocument.findUnique({ where: { id: docId } }) as CowriterDocRecord | null;
    } catch (err) {
      log.error('getDocument failed:', err);
      return null;
    }
  }

  async createDocument(userId: string, data: { id?: string; title: string; content?: string }): Promise<CowriterDocRecord | null> {
    try {
      await prisma.user.upsert({
        where: { id: userId },
        update: {},
        create: { id: userId, name: 'anonymous' },
      });

      const createData: Record<string, unknown> = {
        userId,
        title: data.title,
        content: data.content ?? '',
      };
      if (data.id) createData.id = data.id;

      return await prisma.cowriterDocument.create({ data: createData as any }) as CowriterDocRecord;
    } catch (err) {
      log.error('createDocument failed:', err);
      return null;
    }
  }

  async updateDocument(docId: string, data: Partial<{ title: string; content: string; status: string; metadata: Record<string, unknown> }>, expectedVersion?: number): Promise<CowriterDocRecord | null> {
    try {
      const updateData: Record<string, unknown> = { version: { increment: 1 }, lastEdited: new Date() };
      if (data.title !== undefined) updateData.title = data.title;
      if (data.content !== undefined) updateData.content = data.content;
      if (data.status !== undefined) updateData.status = data.status;
      if (data.metadata !== undefined) updateData.metadata = JSON.parse(JSON.stringify(data.metadata));
      const current = await prisma.cowriterDocument.findUnique({ where: { id: docId } });
      if (!current) return null;
      const result = await prisma.cowriterDocument.updateMany({ where: { id: docId, version: expectedVersion ?? current.version }, data: updateData as Prisma.CowriterDocumentUpdateManyMutationInput });
      if (!result.count) throw new HistoryConflict('文档已在其他设备修改或删除，请刷新');
      return await prisma.cowriterDocument.findUnique({ where: { id: docId } }) as CowriterDocRecord;

    } catch (err) {
      if (err instanceof HistoryConflict) throw err;
      log.error('updateDocument failed:', err);
      return null;
    }
  }

  async deleteDocument(docId: string): Promise<boolean> {
    try {
      await prisma.cowriterDocument.delete({ where: { id: docId } });
      return true;
    } catch (err) {
      log.error('deleteDocument failed:', err);
      return false;
    }
  }
}
