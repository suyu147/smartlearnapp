import { createHash } from 'node:crypto';
import { prisma } from '@/lib/db/client';
import { MemoryServiceImpl } from '@/lib/deeptutor/services/memory';
import { PROFILE_INFO_KEYS, PROFILE_INFO_LABELS, type ProfileDimensions } from '@/lib/types/profile';
import { getInfoDetails, getInfoState } from '@/lib/utils/profile-utils';

const memory = new MemoryServiceImpl();
export function profileMemoryFacts(dimensions: ProfileDimensions): string[] {
  return PROFILE_INFO_KEYS.filter(key => getInfoState(dimensions, key) === 'confirmed').flatMap(key => {
    const detail = getInfoDetails(dimensions, key).join('；').replace(/[\r\n\u0000-\u001f]+/g, ' ').trim();
    if (!detail) return [];
    const prefix = PROFILE_INFO_LABELS[key] + '：';
    const chunks: string[] = [];
    const width = 240 - prefix.length;
    for (let index = 0; index < detail.length; index += width) chunks.push(prefix + detail.slice(index, index + width));
    return chunks;
  });
}
export async function syncOnboardingMemory(userId: string): Promise<void> {
  await prisma.$transaction(async tx => {
    // Re-read the latest committed dimensions; an older after() job must not replace newer facts.
    await tx.$queryRaw`SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext(${'onboarding:' + userId}))`;
    const profile = await tx.learningProfile.findUnique({ where: { userId } });
    if (!profile) return;
    const facts = profileMemoryFacts(profile.dimensions as unknown as ProfileDimensions);
    const fingerprint = createHash('sha256').update(JSON.stringify(facts)).digest('hex');
    await memory.syncOnboardingFacts(userId, fingerprint, facts);
  }, { timeout: 15000 });
}
