import { authenticate } from '@/lib/deeptutor/services/auth';
import { NextRequest, NextResponse } from 'next/server';

import { getLearnerProfileService } from '@/lib/deeptutor/services/learner-profile';
import { ProfileUpdateSchema } from '@/lib/server/schemas';

const learnerProfileService = getLearnerProfileService();

async function getUserId(request: NextRequest): Promise<string> {
  return (await authenticate(request)).id;
}

export async function GET(request: NextRequest) {
  try {
    const userId = await getUserId(request);
    const snapshot = await learnerProfileService.getLearnerSnapshot(userId);

    return NextResponse.json({
      profile: snapshot.profile,
      skillMap: snapshot.analytics.skillMap,
      weakTopics: snapshot.analytics.weakTopics,
      strongTopics: snapshot.analytics.strongTopics,
      schedule: snapshot.analytics.schedule,
      weakPoints: snapshot.weakPoints,
      errors: snapshot.errors,
      recentSessions: snapshot.recentSessions,
    });
  } catch (error) {
    console.error('Failed to fetch profile snapshot:', error);
    return NextResponse.json({ error: 'Failed to fetch profile snapshot' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getUserId(request);
    const parsed = ProfileUpdateSchema.parse(await request.json());
    const dimensions = parsed.dimensions ?? {};
    const profile = await learnerProfileService.replaceProfileDimensions(
      userId,
      dimensions,
      'legacy_profile_api',
    );
    return NextResponse.json({ profile });
  } catch (error) {
    console.error('Failed to save profile snapshot:', error);
    return NextResponse.json({ error: 'Failed to save profile snapshot' }, { status: 400 });
  }
}
