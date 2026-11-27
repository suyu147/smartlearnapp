import { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '@/lib/utils/database';
import { PATH_SESSION_MODE } from '@/lib/api/server/path-generation';
import { updateTopicMastery } from '@/lib/learning-graph/persistence';
import { normalizeAnswer, parseMobileQuestions } from './questions';

export const attemptIdSchema = z.string().uuid();
export const submissionSchema = z.object({
  attemptId: attemptIdSchema,
  version: z.number().int().min(1),
  answers: z.record(z.string().regex(/^[1-9][0-9]{0,2}$/), z.string().trim().min(1).max(2000)),
}).strict();

export function gradePractice(questions: ReturnType<typeof parseMobileQuestions>, answers: Record<string, string>, fallbackTopic: string) {
  if (Object.keys(answers).length !== questions.length || questions.some(question => !Object.hasOwn(answers, question.id))) return null;
  return questions.map(question => {
    const userAnswer = answers[question.id];
    return {
      questionId: question.id, topic: question.knowledgePoints[0] ?? fallbackTopic, question: question.question,
      difficulty: question.difficulty, userAnswer, correctAnswer: question.answers.join(' / '),
      correct: question.answers.some(answer => normalizeAnswer(answer) === normalizeAnswer(userAnswer)),
      explanation: question.explanation,
    };
  });
}

export function mobileQuizScope(userId: string): Prisma.PathNodeResourceWhereInput {
  return {
    path: { userId, deletedAt: null, session: {
      userId, mode: PATH_SESSION_MODE, deletedAt: null, metadata: { path: ['client'], equals: 'mobile' },
    } },
    resource: { userId, type: 'quiz', status: 'ready', deletedAt: null },
  };
}

export function findNodeQuiz(userId: string, resourceId: string, db: Prisma.TransactionClient = prisma) {
  return db.pathNodeResource.findFirst({
    where: { resourceId, ...mobileQuizScope(userId) },
    select: { nodeId: true, path: { select: { sessionId: true } }, resource: true },
  });
}

const reportInclude = { quizAttempts: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } } satisfies Prisma.LearningMasterySessionInclude;
type ReportRecord = Prisma.LearningMasterySessionGetPayload<{ include: typeof reportInclude }>;
export type ReviewQuestionRef = { resourceId: string; version: number; questionId: string };
export type ReviewSelection = { reportId: string } | { questionId: string };
type SingleReportMetadata = {
  source: 'mobile-practice' | 'mobile-review';
  resourceId: string; sessionId: string; nodeId: string; version: number; attemptId: string;
  answers: Record<string, string>; review?: ReviewSelection;
};
export type ReportMetadata = SingleReportMetadata | {
  source: 'mobile-review-batch'; attemptId: string; fingerprint: string;
};
type GradedAnswer = NonNullable<ReturnType<typeof gradePractice>>[number];
type SavedAnswer = GradedAnswer & { reference?: ReviewQuestionRef; resourceTitle?: string };

export function quizAnswerReference(metadata: ReportMetadata, answer: { metadata: Prisma.JsonValue }): ReviewQuestionRef | undefined {
  const question = answer.metadata as Partial<ReviewQuestionRef> | null;
  if (!question?.questionId) return;
  if (metadata.source !== 'mobile-review-batch') {
    return { resourceId: metadata.resourceId, version: metadata.version, questionId: question.questionId };
  }
  if (question.resourceId && question.version) {
    return { resourceId: question.resourceId, version: question.version, questionId: question.questionId };
  }
}

const attemptKey = (userId: string, attemptId: string) => `${userId}:mobile-practice:${attemptId}`;

export const mobileAnswerSources: Prisma.LearningMasterySessionWhereInput = {
  OR: [
    { metadata: { path: ['source'], equals: 'mobile-practice' } },
    { metadata: { path: ['source'], equals: 'mobile-review' } },
    { metadata: { path: ['source'], equals: 'mobile-review-batch' } },
  ],
};

function reportDto(record: ReportRecord, metadata: ReportMetadata) {
  const correctCount = record.quizAttempts.filter(answer => answer.correct).length;
  const total = record.quizAttempts.length;
  return {
    attemptId: metadata.attemptId,
    ...(metadata.source === 'mobile-review-batch' ? { kind: 'batch' as const } : {
      pathSessionId: metadata.sessionId, nodeId: metadata.nodeId, resourceId: metadata.resourceId,
      version: metadata.version, kind: metadata.review ? 'review' as const : 'practice' as const,
    }),
    title: record.title,
    total, correctCount, score: Math.round(correctCount / total * 100), completedAt: record.completedAt,
    focusTopics: (record.evaluation as { suggestedFocus?: string[] } | null)?.suggestedFocus ?? [],
    answers: record.quizAttempts.map(({ id, topic, question, userAnswer, correctAnswer, correct, explanation, metadata }) => ({
      id, topic, question, userAnswer, correctAnswer, correct, explanation,
      questionIndex: Number((metadata as { position?: string; questionId?: string } | null)?.position ??
        (metadata as { questionId?: string } | null)?.questionId ?? '0'),
    })).sort((a, b) => a.questionIndex - b.questionIndex),
  };
}

export async function findMobileReport(userId: string, attemptId: string, db: Prisma.TransactionClient = prisma) {
  return db.learningMasterySession.findFirst({
    where: { id: attemptKey(userId, attemptId), userId, ...mobileAnswerSources }, include: reportInclude,
  });
}

export async function getPracticeReport(userId: string, attemptId: string) {
  const record = await findMobileReport(userId, attemptId);
  return record ? reportDto(record, record.metadata as unknown as ReportMetadata) : null;
}

export async function latestNodePractice(userId: string, sessionId: string, nodeId: string, resourceId: string) {
  return prisma.learningMasterySession.findFirst({
    where: { userId, AND: [
      { metadata: { path: ['source'], equals: 'mobile-practice' } },
      { metadata: { path: ['sessionId'], equals: sessionId } },
      { metadata: { path: ['nodeId'], equals: nodeId } },
      { metadata: { path: ['resourceId'], equals: resourceId } },
    ] },
    orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
    select: { metadata: true, evaluation: true },
  });
}

export type QuestionSelectionResult = { questionIds: string[] } | { status: number; error: string };
type ResolveReviewQuestions = (db: Prisma.TransactionClient) => Promise<QuestionSelectionResult>;

export function saveMobileAttempt(
  userId: string, attemptId: string,
  prepare: (tx: Prisma.TransactionClient) => Promise<
    { status: number; error: string } | { graded: SavedAnswer[]; metadata: ReportMetadata; title: string }
  >,
  matches: (metadata: ReportMetadata) => boolean,
) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const id = attemptKey(userId, attemptId);
    const previous = await tx.learningMasterySession.findFirst({ where: { id, userId }, include: reportInclude });
    if (previous) {
      const metadata = previous.metadata as unknown as ReportMetadata;
      return matches(metadata) ? { data: reportDto(previous, metadata) } : { status: 409, error: '此提交编号已用于其他答案' };
    }

    const prepared = await prepare(tx);
    if ('error' in prepared) return prepared;
    const { graded, metadata, title } = prepared;
    const topics = [...new Set(graded.map(answer => answer.topic))];
    const weakPoints = [...new Set(graded.filter(answer => !answer.correct).map(answer => answer.topic))];
    const overallScore = Math.round(graded.filter(answer => answer.correct).length / graded.length * 100);
    const now = new Date();
    const record = await tx.learningMasterySession.create({
      data: {
        id, userId, title, topics, startedAt: now, completedAt: now, metadata,
        evaluation: {
          weakPoints, strongPoints: topics.filter(topic => !weakPoints.includes(topic)), suggestedFocus: weakPoints, overallScore,
          feedback: weakPoints.length ? '建议复习：' + weakPoints.join('、') : '已答对全部题目',
        },
        quizAttempts: { create: graded.map(({ questionId, reference, resourceTitle, ...answer }) => ({
          ...answer, userId, metadata: reference ? { ...reference, resourceTitle, position: questionId } : { questionId },
        })) },
      },
      include: reportInclude,
    });
    for (const { topic, correct, difficulty } of graded) {
      const where = { userId_topic: { userId, topic } };
      const existing = await tx.learningSkillMastery.findUnique({ where });
      const data = updateTopicMastery(existing, correct, difficulty, now);
      await tx.learningSkillMastery.upsert({ where, create: { userId, topic, ...data }, update: data });
    }
    return { data: reportDto(record, metadata) };
  });
}

export async function submitPractice(
  userId: string, resourceId: string, submission: z.infer<typeof submissionSchema>,
  review?: { selection: ReviewSelection; resolve: ResolveReviewQuestions },
) {
  return saveMobileAttempt(userId, submission.attemptId, async tx => {
    const linked = await findNodeQuiz(userId, resourceId, tx);
    if (!linked?.path.sessionId) return { status: 404, error: '找不到随堂练习' };
    if (linked.resource.revision !== submission.version) return { status: 409, error: '题目已更新，请重新打开练习' };
    let questions = parseMobileQuestions(linked.resource.content);
    if (!questions.length) return { status: 409, error: '题目尚未准备好' };
    if (review) {
      const selected = await review.resolve(tx);
      if ('error' in selected) return selected;
      const ids = new Set(selected.questionIds);
      questions = questions.filter(question => ids.has(question.id));
      if (!questions.length || questions.length !== ids.size) return { status: 409, error: '题目已更新，请从错题本重新选择' };
    }
    const graded = gradePractice(questions, submission.answers, linked.resource.title);
    if (!graded) return { status: 400, error: '请作答全部题目' };

    const metadata: SingleReportMetadata = {
      source: review ? 'mobile-review' : 'mobile-practice', resourceId, sessionId: linked.path.sessionId, nodeId: linked.nodeId,
      version: submission.version, attemptId: submission.attemptId, answers: submission.answers,
      ...(review ? { review: review.selection } : {}),
    };
    return { graded, metadata, title: linked.resource.title };
  }, metadata => metadata.source !== 'mobile-review-batch' && metadata.resourceId === resourceId &&
    metadata.version === submission.version && JSON.stringify(metadata.review ?? null) === JSON.stringify(review?.selection ?? null) &&
    Object.keys(metadata.answers).length === Object.keys(submission.answers).length &&
    Object.entries(metadata.answers).every(([key, answer]) => submission.answers[key] === answer));
}
