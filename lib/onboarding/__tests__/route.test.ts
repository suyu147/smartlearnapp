import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { DEFAULT_DIMENSIONS } from '@/lib/types/profile';
import { createEmptyAnswers } from '../schema';

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), submit: vi.fn(), sync: vi.fn(), after: vi.fn() }));
vi.mock('next/server', async importOriginal => ({ ...await importOriginal<typeof import('next/server')>(), after: mocks.after }));
vi.mock('@/lib/deeptutor/services/auth', () => ({ authenticate: mocks.authenticate }));
vi.mock('../service', () => ({
  submitOnboarding: mocks.submit,
  OnboardingError: class extends Error { code = ''; status = 500; },
}));
vi.mock('../memory', () => ({ syncOnboardingMemory: mocks.sync }));
import { POST } from '@/app/api/v1/profile/onboarding/route';

const body = () => ({
  submissionId: 'c7cd59e0-7aca-47f0-b0b3-06a1ad035346', mode: 'submit', textPolicy: 'extract',
  answers: { ...createEmptyAnswers(), role: 'student', subjects: ['数学'], goalKind: 'exam' },
});
function request(value: unknown) {
  return new NextRequest('http://localhost/api/v1/profile/onboarding', { method: 'POST', body: JSON.stringify(value) });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.authenticate.mockResolvedValue({ id: 'authenticated-user' });
  mocks.submit.mockResolvedValue({ dimensions: DEFAULT_DIMENSIONS, userId: 'authenticated-user' });
});
describe('onboarding endpoint boundary', () => {
  it('uses authenticated identity and schedules memory only after profile persistence succeeds', async () => {
    const response = await POST(request(body()));
    expect(response.status).toBe(200);
    expect(mocks.submit).toHaveBeenCalledWith('authenticated-user', expect.objectContaining({ mode: 'submit' }));
    expect(mocks.after).toHaveBeenCalledTimes(1);
    expect(mocks.sync).not.toHaveBeenCalled();
    await mocks.after.mock.calls[0][0]();
    expect(mocks.sync).toHaveBeenCalledWith('authenticated-user');
  });
  it('rejects attempts to choose another user in the body', async () => {
    expect((await POST(request({ ...body(), userId: 'someone-else' }))).status).toBe(400);
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it('rejects unauthenticated access before any writes', async () => {
    mocks.authenticate.mockRejectedValue(Object.assign(new Error('no token'), { statusCode: 401 }));
    expect((await POST(request(body()))).status).toBe(401);
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });
  it('does not schedule memory on database failure or expose raw error details', async () => {
    mocks.submit.mockRejectedValue(new Error('database private details'));
    const response = await POST(request(body()));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('private details');
    expect(mocks.after).not.toHaveBeenCalled();
  });
  it('keeps a successful save successful if the memory side channel fails', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.sync.mockRejectedValue(new Error('raw provider detail'));
    const response = await POST(request(body()));
    await expect(mocks.after.mock.calls[0][0]()).resolves.toBeUndefined();
    expect(response.status).toBe(200);
    expect(warning).toHaveBeenCalledWith(expect.not.stringContaining('raw provider detail'));
    warning.mockRestore();
  });
});
