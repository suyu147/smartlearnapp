import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '@/lib/utils/database';
import { attemptIdSchema, findMobileReport, findNodeQuiz, mobileAnswerSources, mobileQuizScope, submitPractice, submissionSchema, type QuestionSelectionResult, type ReportMetadata, type ReviewSelection } from './practice';
import { parseMobileQuestions, publicQuestions } from './questions';

const questionIdSchema = z.string().regex(/^[1-9][0-9]{0,2}$/);
export const reviewSelectionSchema = z.union([
  z.object({ reportId: attemptIdSchema }).strict(),
  z.object({ questionId: questionIdSchema }).strict(),
]);
export const reviewListSchema = z.object({
  mode: z.enum(['mistakes', 'today']).default('mistakes'),
  offset: z.coerce.number().int().min(0).default(0),
  topic: z.string().min(1).optional(),
  tzOffset: z.coerce.number().int().min(-840).max(840).default(0),
});
export const reviewVersionSchema = z.coerce.number().int().min(1);

type ReviewItem = {
  resourceId: string; version: number; questionId: string; title: string; topic: string; question: string;
  mistakeCount: number; lastAnsweredAt: Date; lastWrongAttemptId: string; pending: boolean;
};

export async function listReview(userId: string, query: z.infer<typeof reviewListSchema>, now = new Date()) {
  const [history, quizzes, mastery] = await Promise.all([
    prisma.learningMasterySession.findMany({
      where: { userId, completedAt: { not: null }, ...mobileAnswerSources },
      orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
      select: { title: true, metadata: true, completedAt: true, quizAttempts: {
        where: { userId }, select: { correct: true, topic: true, question: true, metadata: true },
      } },
    }),
    prisma.pathNodeResource.findMany({
      where: mobileQuizScope(userId),
      select: { resourceId: true, resource: { select: { revision: true } } },
    }),
    query.mode === 'today' ? prisma.learningSkillMastery.findMany({
      where: { userId, mastery: { lt: 0.6 }, nextReviewAt: { not: null } },
      select: { topic: true, nextReviewAt: true },
    }) : [],
  ]);

  const questions = new Map<string, ReviewItem>();
  for (const session of history) {
    const metadata = session.metadata as unknown as ReportMetadata;
    for (const answer of session.quizAttempts) {
      const questionId = (answer.metadata as { questionId?: string } | null)?.questionId;
      if (!questionId || !session.completedAt) continue;
      const key = JSON.stringify([metadata.resourceId, metadata.version, questionId]);
      const item = questions.get(key) ?? {
        resourceId: metadata.resourceId, version: metadata.version, questionId, title: session.title,
        topic: answer.topic, question: answer.question, lastAnsweredAt: session.completedAt,
        pending: !answer.correct, mistakeCount: 0, lastWrongAttemptId: '',
      };
      if (!answer.correct) {
        item.mistakeCount++;
        if (!item.lastWrongAttemptId) item.lastWrongAttemptId = metadata.attemptId;
      }
      questions.set(key, item);
    }
  }

  const revisions = new Map(quizzes.map(quiz => [quiz.resourceId, quiz.resource.revision]));
  const dueDates = new Map(mastery.map(entry => [entry.topic, entry.nextReviewAt]));
  const offsetMs = query.tzOffset * 60_000;
  const local = new Date(now.getTime() - offsetMs);
  const tomorrow = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1) + offsetMs;
  const items = [...questions.values()].flatMap(item => {
    if (!item.mistakeCount) return [];
    const canReview = revisions.get(item.resourceId) === item.version;
    const dueAt = dueDates.get(item.topic);
    const due = dueAt != null && dueAt.getTime() < tomorrow;
    if (query.mode === 'today' ? !canReview || (!item.pending && !due) : !item.pending) return [];
    return [{ ...item, canReview }];
  });
  if (query.mode === 'today') items.sort((a, b) => Number(b.pending) - Number(a.pending));
  const topics = [...new Set(items.map(item => item.topic))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const filtered = query.topic ? items.filter(item => item.topic === query.topic) : items;
  const pageSize = 20;
  return {
    items: filtered.slice(query.offset, query.offset + pageSize), total: filtered.length, topics,
    nextOffset: query.offset + pageSize < filtered.length ? query.offset + pageSize : null,
  };
}

async function resolveQuestions(
  userId: string, resourceId: string, version: number, selection: ReviewSelection, db: Prisma.TransactionClient,
): Promise<QuestionSelectionResult> {
  if ('reportId' in selection) {
    const report = await findMobileReport(userId, selection.reportId, db);
    const metadata = report?.metadata as unknown as ReportMetadata | undefined;
    if (!report || metadata?.resourceId !== resourceId) return { status: 404, error: '找不到练习报告' };
    if (metadata.version !== version) return { status: 409, error: '题目已更新，仍可查看原报告' };
    const questionIds = report.quizAttempts.filter(answer => answer.userId === userId && !answer.correct)
      .flatMap(answer => {
        const parsed = questionIdSchema.safeParse((answer.metadata as { questionId?: string } | null)?.questionId);
        return parsed.success ? [parsed.data] : [];
      });
    return questionIds.length ? { questionIds } : { status: 409, error: '这份报告没有错题' };
  }

  const wrongAnswer = await db.learningQuizAttempt.findFirst({
    where: {
      userId, correct: false, metadata: { path: ['questionId'], equals: selection.questionId },
      masterySession: { userId, completedAt: { not: null }, AND: [
        mobileAnswerSources,
        { metadata: { path: ['resourceId'], equals: resourceId } },
        { metadata: { path: ['version'], equals: version } },
      ] },
    },
    select: { id: true },
  });
  return wrongAnswer ? { questionIds: [selection.questionId] } : { status: 404, error: '找不到这道错题' };
}

export async function getReviewPractice(userId: string, resourceId: string, version: number, selection: ReviewSelection) {
  const linked = await findNodeQuiz(userId, resourceId);
  if (!linked?.path.sessionId) return { status: 404, error: '原练习已不可用，仍可查看历史报告' };
  if (linked.resource.revision !== version) return { status: 409, error: '题目已更新，仍可查看原报告' };
  const selected = await resolveQuestions(userId, resourceId, version, selection, prisma);
  if ('error' in selected) return selected;
  const ids = new Set(selected.questionIds);
  const questions = parseMobileQuestions(linked.resource.content).filter(question => ids.has(question.id));
  if (questions.length !== ids.size) return { status: 409, error: '题目已更新，仍可查看原报告' };
  return {
    data: {
      resourceId, version, title: linked.resource.title, pathSessionId: linked.path.sessionId, nodeId: linked.nodeId,
      latestAttemptId: null, questions: publicQuestions(questions),
    },
  };
}

export function submitReview(
  userId: string, resourceId: string, submission: z.infer<typeof submissionSchema>, selection: ReviewSelection,
) {
  return submitPractice(userId, resourceId, submission, {
    selection, resolve: tx => resolveQuestions(userId, resourceId, submission.version, selection, tx),
  });
}
