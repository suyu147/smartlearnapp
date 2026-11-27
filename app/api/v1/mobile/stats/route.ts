import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/deeptutor/services/auth-middleware';
import prisma from '@/lib/utils/database';
import { dayMs, localDay, timezoneOffsetSchema } from '@/lib/mobile/calendar';

export async function GET(req: NextRequest) {
  return withAuth(req, async (_, { user }) => {
    const offset = timezoneOffsetSchema.safeParse(req.nextUrl.searchParams.get('tzOffset') ?? undefined);
    if (!offset.success) return NextResponse.json({ error: '时区偏移无效' }, { status: 400 });
    const now = new Date();
    const today = localDay(now, offset.data).getTime();
    const dayKey = (ms: number) => new Date(ms - offset.data * 60_000).toISOString().slice(0, 10);
    const [activity, mastery] = await Promise.all([
      prisma.$queryRaw<Array<{ date: string; answered: number; correct: number }>>`
        SELECT (created_at - ${offset.data} * INTERVAL '1 minute')::date::text AS date,
               COUNT(*)::int AS answered, COUNT(*) FILTER (WHERE correct)::int AS correct
        FROM learning_quiz_attempts
        WHERE user_id = ${user.id} AND created_at <= ${now}
        GROUP BY 1
      `,
      prisma.learningSkillMastery.findMany({
        where: { userId: user.id, mastery: { lt: 0.6 } },
        orderBy: [{ mastery: 'asc' }, { lastReviewedAt: 'desc' }, { topic: 'asc' }], take: 5,
        select: { topic: true, mastery: true },
      }),
    ]);
    const byDay = new Map(activity.map(day => [day.date, day]));
    const recent = Array.from({ length: 14 }, (_, i) => {
      const date = dayKey(today - (13 - i) * dayMs);
      return byDay.get(date) ?? { date, answered: 0, correct: 0 };
    });
    let streak = 0;
    for (let day = byDay.has(dayKey(today)) ? today : today - dayMs; byDay.has(dayKey(day)); day -= dayMs) streak++;
    const summarize = (days: typeof activity) => {
      const answered = days.reduce((sum, day) => sum + day.answered, 0);
      const correct = days.reduce((sum, day) => sum + day.correct, 0);
      return { days: days.filter(day => day.answered).length, answered, accuracy: answered ? Math.round(100 * correct / answered) : null };
    };
    const current = summarize(recent.slice(7));
    const previous = summarize(recent.slice(0, 7));
    const accuracyChange = current.accuracy !== null && previous.accuracy !== null ? current.accuracy - previous.accuracy : null;
    return NextResponse.json({
      success: true, data: { ...current, daily: recent.slice(7), streak, accuracyChange, weakTopics: mastery },
    });
  });
}
