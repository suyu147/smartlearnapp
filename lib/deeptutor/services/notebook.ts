import prisma from '@/lib/utils/database';
import { ensureHistoryUser, HistoryConflict } from '@/lib/history/server';
import type { Prisma } from '@prisma/client';
export interface Notebook { id: string; name: string; description: string; color: string; icon: string; recordCount: number; createdAt: string; updatedAt: string; }
export interface NotebookRecord { id: string; type: string; title: string; summary: string; content: string; metadata: Record<string, unknown>; createdAt: string; updatedAt: string; }
interface NotebookData { notebook: Notebook; records: NotebookRecord[]; deleted?: boolean; }
const key = (id: string) => `notebook:${id}`;
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
export class NotebookServiceImpl {
  async listNotebooks(userId: string): Promise<Notebook[]> {
    const docs = await prisma.userHistoryDocument.findMany({ where: { userId, key: { startsWith: 'notebook:' } }, orderBy: { updatedAt: 'desc' } });
    return docs.map(doc => doc.payload as unknown as NotebookData).filter(data => !data.deleted).map(data => data.notebook);
  }
  async createNotebook(userId: string, name: string, description = ''): Promise<Notebook> {
    await ensureHistoryUser(userId);
    const now = new Date().toISOString();
    const notebook: Notebook = { id: crypto.randomUUID(), name, description, color: '#3B82F6', icon: 'book', recordCount: 0, createdAt: now, updatedAt: now };
    await prisma.userHistoryDocument.create({ data: { userId, key: key(notebook.id), payload: json({ notebook, records: [] }) } });
    return notebook;
  }
  private async read(userId: string, id: string) {
    const record = await prisma.userHistoryDocument.findUnique({ where: { userId_key: { userId, key: key(id) } } });
    if (!record) return null;
    const data = record.payload as unknown as NotebookData;
    return data.deleted ? null : { record, data };
  }
  private async mutate<T>(userId: string, id: string, change: (data: NotebookData) => T): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await this.read(userId, id);
      if (!current) throw new HistoryConflict('笔记本已删除或不存在');
      const value = change(current.data);
      current.data.notebook.recordCount = current.data.records.length;
      current.data.notebook.updatedAt = new Date().toISOString();
      const result = await prisma.userHistoryDocument.updateMany({ where: { id: current.record.id, userId, revision: current.record.revision }, data: { payload: json(current.data), revision: { increment: 1 } } });
      if (result.count) return value;
    }
    throw new HistoryConflict('笔记正在其他设备编辑，请刷新');
  }
  async getNotebook(userId: string, id: string): Promise<Notebook | null> { return (await this.read(userId, id))?.data.notebook ?? null; }
  async getRecords(userId: string, id: string): Promise<NotebookRecord[]> { return (await this.read(userId, id))?.data.records ?? []; }
  async deleteNotebook(userId: string, id: string): Promise<boolean> {
    if (!await this.read(userId, id)) return false;
    return this.mutate(userId, id, data => { data.deleted = true; return true; });
  }
  async addRecord(userId: string, id: string, record: Omit<NotebookRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<NotebookRecord> {
    const now = new Date().toISOString();
    const full = { ...record, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
    return this.mutate(userId, id, data => { data.records.push(full); return full; });
  }
  async updateRecord(userId: string, id: string, recordId: string, expectedUpdatedAt: string, update: { title?: string; content: string }): Promise<NotebookRecord> {
    return this.mutate(userId, id, data => {
      const record = data.records.find(r => r.id === recordId);
      if (!record || record.updatedAt !== expectedUpdatedAt) throw new HistoryConflict('笔记已修改或删除，请刷新后重试');
      Object.assign(record, update, { updatedAt: new Date(Math.max(Date.now(), new Date(record.updatedAt).getTime() + 1)).toISOString() });
      return record;
    });
  }
  async deleteRecord(userId: string, id: string, recordId: string): Promise<boolean> {
    return this.mutate(userId, id, data => { const old = data.records.length; data.records = data.records.filter(r => r.id !== recordId); return old !== data.records.length; });
  }
}
export interface NotebookService { list(userId: string): Promise<Record<string, unknown>[]>; create(userId: string, name: string): Promise<string>; addNote(notebookId: string, content: string): Promise<string>; }
