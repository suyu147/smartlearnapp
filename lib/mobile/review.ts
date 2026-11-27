import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '@/lib/utils/database';
import { attemptIdSchema, findMobileReport, findNodeQuiz, gradePractice, mobileAnswerSources, mobileQuizScope, quizAnswerReference, saveMobileAttempt, submitPractice, submissionSchema, type QuestionSelectionResult, type ReportMetadata, type ReviewQuestionRef, type ReviewSelection } from './practice';
import { parseMobileQuestions, publicQuestions } from './questions';
import { createHash } from 'node:crypto';
import { dayMs, localDay, timezoneOffsetSchema } from './calendar';

const questionIdSchema = z.string().regex(/^[1-9][0-9]{0,2}$/);
export const reviewSelectionSchema = z.union([
  z.object({ reportId: attemptIdSchema }).strict(),
  z.object({ questionId: questionIdSchema }).strict(),
]);
export const reviewListSchema = z.object({
  mode: z.enum(['mistakes', 'today']).default('mistakes'),
  offset: z.coerce.number().int().min(0).default(0),
  topic: z.string().min(1).optional(),
  tzOffset: timezoneOffsetSchema,
});
export const reviewVersionSchema = z.coerce.number().int().min(1);

type ReviewItem = ReviewQuestionRef & {
  title: string; topic: string; question: string;
  mistakeCount: number; lastAnsweredAt: Date; lastWrongAttemptId: string; pending: boolean;
  reviewedToday: boolean;
};

const refKey = (ref: ReviewQuestionRef) => JSON.stringify([ref.resourceId, ref.version, ref.questionId]);

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

  const start = localDay(now, query.tzOffset);
  const tomorrow = start.getTime() + dayMs;
  const questions = new Map<string, ReviewItem>();
  for (const session of history) {
    const metadata = session.metadata as unknown as ReportMetadata;
    for (const answer of session.quizAttempts) {
      const reference = quizAnswerReference(metadata, answer);
      if (!reference || !session.completedAt) continue;
      const key = refKey(reference);
      const item = questions.get(key) ?? {
        ...reference, title: (answer.metadata as { resourceTitle?: string } | null)?.resourceTitle ?? session.title,
        topic: answer.topic, question: answer.question, lastAnsweredAt: session.completedAt,
        pending: !answer.correct, mistakeCount: 0, lastWrongAttemptId: '',
        reviewedToday: metadata.source !== 'mobile-practice' && session.completedAt >= start &&
          session.completedAt.getTime() < tomorrow,
      };
      if (answer.correct && metadata.source !== 'mobile-practice' && session.completedAt >= start &&
        session.completedAt.getTime() < tomorrow) item.reviewedToday = true;
      if (!answer.correct) {
        item.mistakeCount++;
        if (!item.lastWrongAttemptId) item.lastWrongAttemptId = metadata.attemptId;
      }
      questions.set(key, item);
    }
  }

  const revisions = new Map(quizzes.map(quiz => [quiz.resourceId, quiz.resource.revision]));
  const dueDates = new Map(mastery.map(entry => [entry.topic, entry.nextReviewAt]));
  let completedToday = 0;
  const items = [...questions.values()].flatMap(item => {
    if (!item.mistakeCount) return [];
    const canReview = revisions.get(item.resourceId) === item.version;
    const dueAt = dueDates.get(item.topic);
    const due = dueAt != null && dueAt.getTime() < tomorrow;
    if (query.mode === 'today' && item.reviewedToday && !item.pending && !due && (!query.topic || query.topic === item.topic)) completedToday++;
    if (query.mode === 'today' ? !canReview || (!item.pending && !due) : !item.pending) return [];
    return [{ ...item, canReview }];
  });
  if (query.mode === 'today') items.sort((a, b) => Number(b.pending) - Number(a.pending));
  const topics = [...new Set(items.map(item => item.topic))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const filtered = query.topic ? items.filter(item => item.topic === query.topic) : items;
  const pageSize = 20;
  return {
    items: filtered.slice(query.offset, query.offset + pageSize), total: filtered.length, topics, completedToday,
    batch: filtered.filter(item => item.canReview).slice(0, 10).map(({ resourceId, version, questionId }) => ({ resourceId, version, questionId })),
    nextOffset: query.offset + pageSize < filtered.length ? query.offset + pageSize : null,
  };
}

async function resolveQuestions(
  userId: string, resourceId: string, version: number, selection: ReviewSelection, db: Prisma.TransactionClient,
): Promise<QuestionSelectionResult> {
  if ('reportId' in selection) {
    const report = await findMobileReport(userId, selection.reportId, db);
    const metadata = report?.metadata as unknown as ReportMetadata | undefined;
    if (!report || !metadata || metadata.source === 'mobile-review-batch' || metadata.resourceId !== resourceId) {
      return { status: 404, error: '找不到练习报告' };
    }
    if (metadata.version !== version) return { status: 409, error: '题目已更新，仍可查看原报告' };
    const questionIds = report.quizAttempts.filter(answer => answer.userId === userId && !answer.correct)
      .flatMap(answer => {
        const parsed = questionIdSchema.safeParse((answer.metadata as { questionId?: string } | null)?.questionId);
        return parsed.success ? [parsed.data] : [];
      });
    return questionIds.length ? { questionIds } : { status: 409, error: '这份报告没有错题' };
  }

  const known = await findWrongReferences(userId, [{ resourceId, version, questionId: selection.questionId }], db);
  return known.size ? { questionIds: [selection.questionId] } : { status: 404, error: '找不到这道错题' };
}

async function findWrongReferences(userId: string, refs: ReviewQuestionRef[], db: Prisma.TransactionClient) {
  const wrongAnswers = await db.learningQuizAttempt.findMany({
    where: {
      userId, correct: false,
      masterySession: { userId, completedAt: { not: null }, ...mobileAnswerSources },
      OR: refs.map(({ resourceId, version, questionId }) => ({
        metadata: { path: ['questionId'], equals: questionId },
        OR: [
          { masterySession: { AND: [
            { metadata: { path: ['resourceId'], equals: resourceId } },
            { metadata: { path: ['version'], equals: version } },
          ] } },
          { AND: [
            { metadata: { path: ['resourceId'], equals: resourceId } },
            { metadata: { path: ['version'], equals: version } },
          ] },
        ],
      })),
    },
    select: { metadata: true, masterySession: { select: { metadata: true } } },
  });
  return new Set(wrongAnswers.flatMap(answer => {
    const ref = quizAnswerReference(answer.masterySession!.metadata as unknown as ReportMetadata, answer);
    return ref ? [refKey(ref)] : [];
  }));
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

export const batchRefsSchema = z.array(z.object({
  resourceId: z.string().min(1).max(128), version: z.number().int().min(1), questionId: questionIdSchema,
}).strict()).min(1).max(10).refine(refs => new Set(refs.map(refKey)).size === refs.length);

export const batchSubmissionSchema = submissionSchema.omit({ version: true }).extend({ refs: batchRefsSchema });

async function loadBatch(userId: string, refs: ReviewQuestionRef[], db: Prisma.TransactionClient): Promise<
  { selected: { title: string; question: ReturnType<typeof parseMobileQuestions>[number] }[] } | { status: number; error: string }
> {
  const resourceIds = [...new Set(refs.map(ref => ref.resourceId))];
  const [links, known] = await Promise.all([
    db.pathNodeResource.findMany({ where: { ...mobileQuizScope(userId), resourceId: { in: resourceIds } },
      select: { resource: { select: { id: true, revision: true, title: true, content: true } } },
    }),
    findWrongReferences(userId, refs, db),
  ]);
  if (refs.some(ref => !known.has(refKey(ref)))) return { status: 404, error: '找不到这组错题' } as const;
  const quizzes = new Map(links.map(({ resource }) => [resource.id, { ...resource, questions: parseMobileQuestions(resource.content) }]));
  const selected = refs.flatMap((ref, index) => {
    const quiz = quizzes.get(ref.resourceId);
    const question = quiz?.revision === ref.version ? quiz.questions.find(item => item.id === ref.questionId) : undefined;
    return question && quiz ? [{ title: quiz.title, question: { ...question, id: String(index + 1) } }] : [];
  });
  return selected.length === refs.length ? { selected } as const
    : { status: 409, error: '这组题目有更新，请返回复习列表重新开始' } as const;
}

export async function getReviewBatch(userId: string, refs: ReviewQuestionRef[]) {
  const result = await loadBatch(userId, refs, prisma);
  if ('error' in result) return result;
  return { data: {
    refs, title: '整组错题复习', version: 1, latestAttemptId: null,
    questions: publicQuestions(result.selected.map(item => item.question)),
  } };
}

export function submitReviewBatch(userId: string, submission: z.infer<typeof batchSubmissionSchema>) {
  const { refs, answers, attemptId } = submission;
  const fingerprint = createHash('sha256')
    .update(JSON.stringify([refs.map(refKey), Object.entries(answers).sort()])).digest('hex');
  return saveMobileAttempt(userId, attemptId, async tx => {
    const result = await loadBatch(userId, refs, tx);
    if ('error' in result) return result;
    const graded = gradePractice(result.selected.map(({ question, title }) => ({
      ...question, knowledgePoints: question.knowledgePoints.length ? question.knowledgePoints : [title],
    })), answers, '整组错题复习');
    if (!graded) return { status: 400, error: '请作答全部题目' };
    return {
      title: '整组错题复习', metadata: { source: 'mobile-review-batch', attemptId, fingerprint },
      graded: graded.map((answer, index) => ({
        ...answer, reference: refs[index], resourceTitle: result.selected[index].title,
      })),
    };
  }, metadata => metadata.source === 'mobile-review-batch' && metadata.fingerprint === fingerprint);
}
