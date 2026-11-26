import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { buildOnboardingDimensions, emptyAssessment, getTextIssues } from '../lib/onboarding/mapping';
import { createEmptyAnswers, type OnboardingRequest } from '../lib/onboarding/schema';

const user = { id: 'onboarding-browser-test', username: '测试学习者', role: 'user' };
function makeProfile(body?: OnboardingRequest) {
  const input = body ?? {
    mode: 'submit', textPolicy: 'extract', submissionId: 'c7cd59e0-7aca-47f0-b0b3-06a1ad035346',
    answers: { ...createEmptyAnswers(), role: 'student', subjects: ['数学'], goalKind: 'exam' },
  } as OnboardingRequest;
  return { id: 'profile-browser-test', userId: user.id, version: 1,
    dimensions: buildOnboardingDimensions(undefined, input, emptyAssessment(), 'test-digest'),
    updatedAt: '2026-11-26T00:00:00.000Z', completedAt: '2026-11-26T00:00:00.000Z' };
}
async function setup(page: Page, completed = false) {
  await page.route('**/api/v1/**', async route => {
    if (route.request().url().includes('/auth/status')) {
      await route.fulfill({ json: { success: true, data: { mode: 'multi', user, token: 'isolated-browser-test', hasProfile: completed } } });
    } else if (route.request().url().includes('/smartlearn/profile')) {
      await route.fulfill({ json: { profile: makeProfile() } });
    } else await route.fulfill({ json: { success: true, data: [], sessions: [] } });
  });
}
async function firstStep(page: Page) {
  await page.getByRole('radio', { name: '学生', exact: true }).check();
  await page.getByRole('checkbox', { name: '数学', exact: true }).check();
  await page.getByRole('button', { name: '下一步', exact: true }).click();
}
async function goalStep(page: Page) {
  await page.getByRole('radio', { name: '应试备考', exact: true }).check();
  await page.getByRole('button', { name: '下一步', exact: true }).click();
}
test.describe('guided onboarding P0/P1', () => {
  test.setTimeout(90_000);
  test('validates required choices and retains answers when navigating back', async ({ page }) => {
    await setup(page);
    await page.goto('/onboarding');
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: '请选择你的身份' })).toBeVisible();
    await firstStep(page);
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: '请选择一个学习目标' })).toBeVisible();
    await page.getByRole('button', { name: '上一步', exact: true }).click();
    await expect(page.getByRole('radio', { name: '学生', exact: true })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: '数学', exact: true })).toBeChecked();
  });
  test('submits seven-item selections and enters home', async ({ page }) => {
    await setup(page);
    let submitted: OnboardingRequest | undefined;
    await page.route('**/api/v1/profile/onboarding', async route => {
      submitted = route.request().postDataJSON();
      await route.fulfill({ json: { profile: makeProfile(submitted), issues: [] } });
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/onboarding');
    await firstStep(page);
    await page.getByRole('radio', { name: '进阶', exact: true }).check();
    await page.getByRole('radio', { name: '应试备考', exact: true }).check();
    await page.locator('input[type="date"]').fill('2027-06-07');
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    await page.getByRole('checkbox', { name: '视频', exact: true }).check();
    await page.getByRole('checkbox', { name: '练习', exact: true }).check();
    await page.getByRole('radio', { name: '45 分钟', exact: true }).check();
    await page.getByRole('checkbox', { name: '晚上', exact: true }).check();
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    await expect(page.getByRole('heading', { name: '看看这份画像是否符合你' })).toBeVisible();
    await mkdir('.screenshots/onboarding', { recursive: true });
    await page.screenshot({ path: '.screenshots/onboarding/desktop-summary.png' });
    await page.getByRole('button', { name: '确认并开始学习' }).click();
    await expect(page).toHaveURL(/\/home$/);
    expect(submitted?.answers.formats).toEqual(['video', 'quiz']);
    expect(submitted?.answers.targetDate).toBe('2027-06-07');
    expect(submitted?.submissionId).toMatch(/^[a-f0-9-]{36}$/);
  });
  test('skips the questionnaire without submitting partially entered unverified text', async ({ page }) => {
    await setup(page);
    let submitted: OnboardingRequest | undefined;
    await page.route('**/api/v1/profile/onboarding', async route => {
      submitted = route.request().postDataJSON();
      await route.fulfill({ json: { profile: makeProfile(submitted), issues: [] } });
    });
    await page.goto('/onboarding');
    await page.getByRole('textbox', { name: '补充学科或领域（选填）' }).fill('not-submitted');
    await page.getByRole('button', { name: '稍后完善' }).click();
    await expect(page).toHaveURL(/\/home$/);
    expect(submitted?.mode).toBe('skip');
    expect(submitted?.answers.customSubjects).toBe('');
  });
  test('retains text after extraction failure and offers explicit discard', async ({ page }) => {
    await setup(page);
    const requests: OnboardingRequest[] = [];
    await page.route('**/api/v1/profile/onboarding', async route => {
      const body = route.request().postDataJSON() as OnboardingRequest;
      requests.push(body);
      if (body.textPolicy === 'extract') await route.fulfill({ status: 503, json: { code: 'extraction_unavailable', error: '暂时无法校验补充文字，请重试。' } });
      else {
        const profile = makeProfile(body);
        await route.fulfill({ json: { profile, issues: getTextIssues(profile.dimensions) } });
      }
    });
    await page.goto('/onboarding');
    await firstStep(page);
    await page.getByRole('textbox', { name: '已学内容（选填）' }).fill('待校验的补充文字');
    await goalStep(page);
    await page.getByRole('button', { name: '跳过本页' }).click();
    await page.getByRole('button', { name: '确认并开始学习' }).click();
    await expect(page.getByRole('alert').filter({ hasText: '暂时无法校验' })).toBeVisible();
    await page.getByRole('button', { name: '确认并开始学习' }).click();
    await expect.poll(() => requests.length).toBe(2);
    expect(requests[0].submissionId).toBe(requests[1].submissionId);
    await page.getByRole('button', { name: '放弃补充文字，仅保存选择项' }).click();
    await expect(page.getByRole('heading', { name: '画像已保存，部分文字待补充' })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: '原文字未保存' })).toBeVisible();
    expect(requests[2].textPolicy).toBe('discard');
    expect(requests[2].submissionId).not.toBe(requests[0].submissionId);
    await page.getByRole('button', { name: '进入首页' }).click();
    await expect(page).toHaveURL(/\/home$/);
  });
  test('keeps mobile controls usable without horizontal scrolling', async ({ page }) => {
    await setup(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/onboarding');
    await expect(page.getByRole('heading', { name: '先从你的学习背景开始' })).toBeVisible();
    await mkdir('.screenshots/onboarding', { recursive: true });
    await page.screenshot({ path: '.screenshots/onboarding/mobile-background.png' });
    await firstStep(page);
    await goalStep(page);
    await page.getByRole('checkbox', { name: '视频', exact: true }).check();
    await expect(page.getByRole('button', { name: '下一步', exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    await page.screenshot({ path: '.screenshots/onboarding/mobile-summary.png' });
  });
  test('lets completed users enter home and renders real seven-item profile without demo data', async ({ page }) => {
    await setup(page, true);
    await page.goto('/onboarding');
    await expect(page).toHaveURL(/\/home$/);
    await page.goto('/profile');
    await expect(page.getByRole('heading', { name: '你的学习画像' })).toBeVisible();
    await expect(page.getByText('基础信息完整度', { exact: true })).toBeVisible();
    for (const label of ['身份与学段', '学科与领域', '现有基础', '学习目标', '薄弱与困难', '内容形式偏好', '可用时间']) {
      await expect(page.locator('dt').filter({ hasText: label })).toBeVisible();
    }
    await expect(page.getByText('23.5h', { exact: true })).toHaveCount(0);
    await expect(page.getByText('认知风格', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: '.screenshots/onboarding/profile.png', fullPage: true });
  });
});
