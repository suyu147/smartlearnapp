import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
vi.mock('@/lib/deeptutor/services/memory/consolidator', () => ({ runUpdateL2: vi.fn(), runUpdateL3: vi.fn() }));
import { MemoryServiceImpl } from '@/lib/deeptutor/services/memory';

let tempRoot: string | undefined;
afterEach(async () => { if (tempRoot) await rm(tempRoot, { recursive: true, force: true }); });
describe('questionnaire memory snapshots', () => {
  it('does not create empty memory when the entire questionnaire was skipped', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'smartlearn-onboarding-'));
    const memory = new MemoryServiceImpl(tempRoot);
    await memory.syncOnboardingFacts('test', 'empty', []);
    expect(await memory.readTrace('test', 'onboarding')).toEqual([]);
    expect(await memory.readL2('test', 'onboarding')).toBe('');
    expect(await memory.readL3('test', 'profile')).toBe('');
  });
  it('updates current facts, preserves unrelated memory, and retains trace history without duplicate retries', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'smartlearn-onboarding-'));
    const memory = new MemoryServiceImpl(tempRoot);
    const user = 'isolated-test-user';
    await memory.writeL3(user, 'profile', '# Profile\n\n## Background\n\n- 已有用户背景 <!--m_existing-->\n');
    await memory.syncOnboardingFacts(user, 'first', ['学习目标：应试备考']);
    await memory.syncOnboardingFacts(user, 'first', ['学习目标：应试备考']);
    expect(await memory.readTrace(user, 'onboarding')).toHaveLength(1);
    await memory.syncOnboardingFacts(user, 'second', ['学习目标：技能提升']);
    const current = await memory.readL3Clean(user, 'profile');
    expect(current).toContain('已有用户背景');
    expect(current).toContain('技能提升');
    expect(current).not.toContain('应试备考');
    expect((await memory.readL2(user, 'onboarding')).match(/m_onboarding_/g)).toHaveLength(1);
    expect(await memory.readTrace(user, 'onboarding')).toHaveLength(2);
    expect((await memory.overview(user)).l2Surfaces).toContain('onboarding');
  });
  it('repairs interrupted L3 sync without duplicating the committed trace', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'smartlearn-onboarding-'));
    const memory = new MemoryServiceImpl(tempRoot);
    await memory.syncOnboardingFacts('test', 'same', ['学科与领域：数学']);
    await memory.writeL3('test', 'profile', '# Profile');
    await memory.syncOnboardingFacts('test', 'same', ['学科与领域：数学']);
    expect(await memory.readL3Clean('test', 'profile')).toContain('数学');
    expect(await memory.readTrace('test', 'onboarding')).toHaveLength(1);
  });
});
