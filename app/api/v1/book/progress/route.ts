import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/deeptutor/services/auth-middleware';
import { getBookEngine } from '@/lib/deeptutor/bootstrap';
import prisma from '@/lib/utils/database';
import { apiSuccess, apiError } from '@/lib/server/api-response';
import { mutateBook } from '@/lib/history/book-mutation';
import { HistoryConflict } from '@/lib/history/server';
import { z } from 'zod';
const schema = z.object({ bookId: z.string().min(1), pageId: z.string().min(1), quiz: z.object({ blockId: z.string(), score: z.number().min(0).max(1), attemptId: z.string().optional() }).optional() });
export async function POST(req: NextRequest) {
  return withAuth(req, async (_, { user }) => {
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return apiError('Invalid reading progress', 400);
    const { bookId, pageId, quiz } = parsed.data;
    const record = await prisma.book.findFirst({ where: { id: bookId, userId: user.id } });
    if (!record) return apiError('Book not found', 404);
    try {
      const engine = getBookEngine();
      const progress = await mutateBook(req, user.id, bookId, async () => {
        const storage = engine.getStorage();
        if (!await storage.loadPage(bookId, pageId)) throw new Error('Page not found');
        const progress = await storage.loadProgress(bookId);
        progress.currentPageId = pageId;
        if (!progress.visitedPageIds.includes(pageId)) progress.visitedPageIds.push(pageId);
        if (quiz) {
          const attemptKey = quiz.attemptId ?? crypto.randomUUID();
          if (!(progress.quizAttempts as Array<{ attemptId?: string }>).some(attempt => attempt.attemptId === attemptKey)) {
            progress.quizAttempts.push({ blockId: quiz.blockId, pageId, score: quiz.score, timestamp: new Date().toISOString(), attemptId: attemptKey } as typeof progress.quizAttempts[number]);
            progress.score = progress.quizAttempts.reduce((sum, attempt) => sum + attempt.score, 0) / progress.quizAttempts.length;
          }
        }
        await storage.saveProgress(bookId, progress);
        return progress;
      });
      return apiSuccess({ progress, revision: record.revision + 1 });
    } catch (error) {
      if (error instanceof HistoryConflict) return apiError(error.message, 409);
      throw error;
    }
  });
}
