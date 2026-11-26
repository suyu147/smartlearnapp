import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/deeptutor/services/auth-middleware';
import prisma from '@/lib/utils/database';
import { ensureHistoryUser } from '@/lib/history/server';
import { z } from 'zod';
const schema = z.object({ attemptId: z.string().min(1), title: z.string(), sessionId: z.string().nullable().optional(), answers: z.array(z.object({ questionId: z.string(), topic: z.string(), question: z.string(), userAnswer: z.string(), correctAnswer: z.string(), correct: z.boolean(), difficulty: z.number().optional() })) });
export async function POST(req: NextRequest) {
  return withAuth(req, async (_, { user }) => {
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: 'Invalid quiz attempt' }, { status: 400 });
    const body = parsed.data;
    await ensureHistoryUser(user.id);
    if (body.sessionId && !await prisma.dtSession.findFirst({ where: { id: body.sessionId, userId: user.id, deletedAt: null } })) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    const id = `${user.id}:quiz:${body.attemptId}`;
    await prisma.$transaction(async tx => {
      const existing = await tx.learningMasterySession.findUnique({ where: { id } });
      if (existing) return;
      await tx.learningMasterySession.create({ data: { id, userId: user.id, title: body.title, topics: [...new Set(body.answers.map(answer => answer.topic))], metadata: { sessionId: body.sessionId ?? null, source: 'quiz-submit' }, completedAt: new Date(), quizAttempts: { create: body.answers.map(answer => ({ userId: user.id, topic: answer.topic, question: answer.question, userAnswer: answer.userAnswer, correctAnswer: answer.correctAnswer, correct: answer.correct, difficulty: answer.difficulty, metadata: { questionId: answer.questionId } })) } } });
    });
    return NextResponse.json({ success: true, data: { saved: true } });
  });
}
export async function GET(req: NextRequest) {
  return withAuth(req, async (_, { user }) => {
    const before = req.nextUrl.searchParams.get('before');
    const records = await prisma.learningQuizAttempt.findMany({ where: { userId: user.id }, ...(before ? { cursor: { id: before }, skip: 1 } : {}), orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 101 });
    return NextResponse.json({ success: true, data: { records: records.slice(0, 100), nextBefore: records.length > 100 ? records[99].id : null } });
  });
}
