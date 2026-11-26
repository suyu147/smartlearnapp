'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, BookOpen, Check, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/lib/store/auth-store';
import { useLearningProfileStore } from '@/lib/store/learning-profile';
import { useSettingsStore } from '@/lib/store/settings';
import { useSettingsStoreV2 } from '@/lib/store/settings-store';
import { getApiToken } from '@/lib/auth-token';
import { cn } from '@/lib/utils';
import { createEmptyAnswers, DIFFICULTY_OPTIONS, DURATION_OPTIONS, SLOT_OPTIONS, STAGE_OPTIONS, SUBJECT_OPTIONS, requiredAnswerErrors, type OnboardingAnswers } from '@/lib/onboarding/schema';
import { buildOnboardingDimensions, getTextIssues } from '@/lib/onboarding/mapping';
import { FORMAT_LABELS, GOAL_LABELS, LEVEL_LABELS, ROLE_LABELS, getInfoDetails, getInfoState } from '@/lib/utils/profile-utils';
import { COLLECTION_STATE_LABELS, PROFILE_INFO_KEYS, PROFILE_INFO_LABELS, type LearningProfile } from '@/lib/types/profile';

const STEPS = [
  { title: '学习背景', subtitle: '身份与关注的学科', heading: '先从你的学习背景开始', description: '让学习内容更贴合你所处的阶段。身份和学科为必填项。' },
  { title: '基础与目标', subtitle: '从哪里出发，去向哪里', heading: '你想学到什么程度？', description: '学习目标为必填项。基础、具体描述和目标日期都可以留空。' },
  { title: '学习方式', subtitle: '困难、偏好与可用时间', heading: '找到适合你的学习方式', description: '这一页都可以跳过。有把握的信息再填，不必为了完整而选择。' },
  { title: '确认画像', subtitle: '检查并提交', heading: '看看这份画像是否符合你', description: '选择项会直接保存；补充文字将在提交后统一校验，只保存明确有效的信息。' },
];
const inputClass = 'w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20';
const entries = (labels: Record<string, string>) => Object.entries(labels).map(([value, label]) => ({ value, label }));

function Choices({ name, options, values, multiple = false, onChange }: {
  name: string; options: { value: string; label: string }[]; values: string[]; multiple?: boolean; onChange: (values: string[]) => void;
}) {
  return <div className="space-y-2"><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
    {options.map(option => <label key={option.value} className="relative cursor-pointer">
      <input type={multiple ? 'checkbox' : 'radio'} name={name} value={option.value} checked={values.includes(option.value)}
        onChange={() => onChange(multiple ? values.includes(option.value) ? values.filter(v => v !== option.value) : [...values, option.value] : [option.value])}
        className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0" />
      <span className={cn('flex min-h-11 items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-sm transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2',
        values.includes(option.value) ? 'border-primary bg-primary/5 font-medium text-primary' : 'border-border bg-background hover:border-primary/40 hover:bg-muted/50')}>
        {option.label}<span aria-hidden="true" className="w-3.5 shrink-0">{values.includes(option.value) && <Check className="h-3.5 w-3.5" />}</span>
      </span>
    </label>)}
  </div>{!multiple && ['stage', 'level', 'duration'].includes(name) && values.length > 0
    && <button type="button" onClick={() => onChange([])} className="rounded px-1 text-xs text-muted-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring">清除选择</button>}</div>;
}
function Group({ title, required, hint, error, children }: { title: string; required?: boolean; hint?: string; error?: string; children: ReactNode }) {
  return <fieldset className="min-w-0 space-y-3">
    <legend className="mb-1 text-sm font-semibold">{title}<span className="ml-2 text-xs font-normal text-muted-foreground">{required ? '必填' : '选填'}</span></legend>
    {hint && <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>}
    {children}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </fieldset>;
}
function TextField({ label, value, placeholder, onChange }: { label: string; value: string; placeholder: string; onChange: (value: string) => void }) {
  return <label className="block space-y-2">
    <span className="text-xs text-muted-foreground">{label}（选填）</span>
    <textarea rows={2} maxLength={500} value={value} placeholder={placeholder} onChange={event => onChange(event.target.value)} className={cn(inputClass, 'resize-y')} />
  </label>;
}

export default function OnboardingPage() {
  const router = useRouter();
  const [answers, setAnswers] = useState(createEmptyAnswers);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [extractionFailed, setExtractionFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<LearningProfile | null>(null);
  const [issues, setIssues] = useState<ReturnType<typeof getTextIssues>>([]);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const scrollRef = useRef<HTMLElement>(null);
  const inFlight = useRef(false);
  const submission = useRef<{ key: string; id: string } | null>(null);

  useEffect(() => { headingRef.current?.focus(); scrollRef.current?.scrollTo({ top: 0 }); }, [step, saved]);
  function update<K extends keyof OnboardingAnswers>(key: K, value: OnboardingAnswers[K]) {
    setAnswers(current => ({ ...current, [key]: value }));
    setErrors({}); setError(''); setExtractionFailed(false);
  }
  function goHome() {
    useAuthStore.getState().setHasProfile(true);
    router.replace('/home');
  }
  function next() {
    const invalid = requiredAnswerErrors(answers);
    const relevant = step === 0 ? ['role', 'subjects'] : step === 1 ? ['goalKind'] : [];
    const currentErrors = Object.fromEntries(Object.entries(invalid).filter(([key]) => relevant.includes(key)));
    if (Object.keys(currentErrors).length) { setErrors(currentErrors); return; }
    setErrors({}); setStep(current => Math.min(3, current + 1));
  }
  async function submit(mode: 'submit' | 'skip' = 'submit', textPolicy: 'extract' | 'discard' = 'extract') {
    if (inFlight.current) return;
    if (mode === 'submit') {
      const invalid = requiredAnswerErrors(answers);
      if (Object.keys(invalid).length) { setErrors(invalid); setStep(invalid.role || invalid.subjects ? 0 : 1); return; }
    }
    inFlight.current = true; setBusy(true); setError(''); setExtractionFailed(false);
    try {
      const v1 = useSettingsStore.getState();
      const v2 = useSettingsStoreV2.getState();
      const aiConfig = {
        providerId: v2.smartlearnProviderId || v1.providerId || undefined,
        modelId: v2.smartlearnModelId || v1.modelId || undefined,
        apiKey: v2.smartlearnApiKey || v1.apiKey || undefined,
        baseUrl: v2.smartlearnBaseUrl || v1.baseUrl || undefined,
      };
      const body = { mode, textPolicy, answers: mode === 'skip' ? createEmptyAnswers() : answers };
      const key = JSON.stringify(body);
      if (submission.current?.key !== key) submission.current = { key, id: crypto.randomUUID() };
      const token = getApiToken();
      const response = await fetch('/api/v1/profile/onboarding', {
        method: 'POST', signal: AbortSignal.timeout(45000), headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        body: JSON.stringify({ ...body, submissionId: submission.current.id, aiConfig }),
      });
      const data = await response.json();
      if (!response.ok) {
        setExtractionFailed(data.code === 'extraction_unavailable');
        if (data.code === 'submission_conflict') submission.current = null;
        throw new Error(data.error || '保存失败，请稍后重试。');
      }
      const p = data.profile;
      const profile: LearningProfile = { id: p.id, userId: p.userId, version: p.version, dimensions: p.dimensions, updatedAt: p.updatedAt, conversationHistory: [] };
      useLearningProfileStore.getState().setProfile(profile);
      if (mode === 'skip' || !data.issues?.length) goHome();
      else { setSaved(profile); setIssues(data.issues); setStep(3); }
    } catch (err) { setError(err instanceof Error ? err.message : '无法连接服务器，请重试。'); }
    finally { inFlight.current = false; setBusy(false); }
  }

  const preview = saved?.dimensions ?? buildOnboardingDimensions(undefined, {
    submissionId: 'preview', mode: 'submit', textPolicy: 'extract', answers,
  }, { identityDetail: 'confirmed', customSubjects: 'confirmed', foundationDetails: 'confirmed', goalDescription: 'confirmed', difficultyDetails: 'confirmed' }, '');
  const current = STEPS[step];

  return <div className="flex h-dvh flex-col bg-background text-foreground">
    <header className="shrink-0 border-b border-border">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-8">
        <div className="flex items-center gap-3"><BookOpen className="h-6 w-6 text-primary" /><span className="text-sm font-semibold">智学方舟<span className="ml-3 border-l border-border pl-3 font-normal text-muted-foreground">学习画像</span></span></div>
        {!saved && <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void submit('skip', 'discard')}>稍后完善</Button>}
      </div>
    </header>

    <main ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto grid max-w-5xl gap-8 px-4 py-6 sm:px-8 sm:py-10 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-14">
        <aside>
          <p className="mb-4 hidden text-xs font-medium tracking-wider text-muted-foreground lg:block">为你的学习做好准备</p>
          <nav aria-label="画像构建步骤"><ol className="flex justify-between gap-2 lg:flex-col lg:gap-6">
            {STEPS.map((item, index) => <li key={item.title} aria-current={step === index ? 'step' : undefined} className="flex items-start gap-3">
              <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs tabular-nums', index === step ? 'border-primary bg-primary text-primary-foreground' : index < step ? 'border-primary/30 bg-primary/5 text-primary' : 'border-border text-muted-foreground')}>
                {index < step ? <Check className="h-3.5 w-3.5" /> : '0' + (index + 1)}
              </span>
              <div className="hidden pt-0.5 lg:block"><p className={cn('text-sm font-medium', index !== step && 'text-muted-foreground')}>{item.title}</p><p className="mt-1 text-xs text-muted-foreground">{item.subtitle}</p></div>
            </li>)}
          </ol></nav>
          <p className="mt-8 hidden text-xs leading-6 text-muted-foreground lg:block">只填写与你学习有关的信息。<br />不确定的内容，可以留空。</p>
        </aside>

        <section className="min-w-0">
          <div className="mb-7">
            <p className="mb-2 text-xs font-medium text-primary">{saved ? '已保存' : '第 ' + (step + 1) + ' 步，共 4 步'}</p>
            <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold tracking-tight outline-none sm:text-3xl">{saved ? '画像已保存，部分文字待补充' : current.heading}</h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">{saved ? '明确的选择和有效文字已保存。以下内容尚未确认，你可以先开始学习。' : current.description}</p>
          </div>
          <form id="onboarding-form" onSubmit={event => { event.preventDefault(); if (step < 3) next(); else void submit(); }}>
            <fieldset disabled={busy || !!saved} className="min-w-0 space-y-7">
              {step === 0 && <>
                <Group title="你目前的身份" required error={errors.role}>
                  <Choices name="role" options={entries(ROLE_LABELS)} values={answers.role ? [answers.role] : []} onChange={v => update('role', v[0] as OnboardingAnswers['role'])} />
                  {answers.role === 'student' && <div className="space-y-2"><p className="text-xs text-muted-foreground">当前学段（选填）</p><Choices name="stage" options={STAGE_OPTIONS.map(v => ({ value: v, label: v }))} values={answers.stage ? [answers.stage] : []} onChange={v => update('stage', v[0] as OnboardingAnswers['stage'])} /></div>}
                  {answers.role && answers.role !== 'student' && <TextField label="职业或学习背景" value={answers.identityDetail} placeholder="例如：产品经理，正在学习数据分析" onChange={v => update('identityDetail', v)} />}
                </Group>
                <Group title="当前想学习的学科与领域" required hint="可以多选，也可以在下方补充。" error={errors.subjects}>
                  <Choices name="subjects" multiple options={SUBJECT_OPTIONS.map(v => ({ value: v, label: v }))} values={answers.subjects} onChange={v => update('subjects', v as OnboardingAnswers['subjects'])} />
                  <TextField label="补充学科或领域" value={answers.customSubjects} placeholder="例如：线性代数、摄影、商务英语" onChange={v => update('customSubjects', v)} />
                </Group>
              </>}
              {step === 1 && <>
                <Group title="你对现有基础的自评">
                  <Choices name="level" options={entries(LEVEL_LABELS)} values={answers.level ? [answers.level] : []} onChange={v => update('level', v[0] as OnboardingAnswers['level'])} />
                  <TextField label="已学内容" value={answers.foundationDetails} placeholder="例如：学过函数和导数，还没接触积分" onChange={v => update('foundationDetails', v)} />
                </Group>
                <Group title="这次学习的主要目标" required error={errors.goalKind}>
                  <Choices name="goal" options={entries(GOAL_LABELS)} values={answers.goalKind ? [answers.goalKind] : []} onChange={v => update('goalKind', v[0] as OnboardingAnswers['goalKind'])} />
                  <TextField label="具体目标" value={answers.goalDescription} placeholder="例如：掌握 Python 数据分析，能独立完成一份分析报告" onChange={v => update('goalDescription', v)} />
                  <label className="block max-w-xs space-y-2"><span className="text-xs text-muted-foreground">目标日期 / 考试日期（选填）</span><input type="date" value={answers.targetDate ?? ''} onChange={e => update('targetDate', e.target.value || undefined)} className={inputClass} /></label>
                </Group>
              </>}
              {step === 2 && <>
                <Group title="你目前遇到的困难" hint="可多选；暂时没有明显困难，也可以不选。">
                  <Choices name="difficulties" multiple options={DIFFICULTY_OPTIONS.map(v => ({ value: v, label: v }))} values={answers.difficulties} onChange={v => update('difficulties', v as OnboardingAnswers['difficulties'])} />
                  <TextField label="具体卡点" value={answers.difficultyDetails} placeholder="例如：能理解公式，但不知道在题目中何时使用" onChange={v => update('difficultyDetails', v)} />
                </Group>
                <Group title="你愿意使用哪些内容形式？">
                  <Choices name="formats" multiple options={entries(FORMAT_LABELS)} values={answers.formats} onChange={v => update('formats', v as OnboardingAnswers['formats'])} />
                </Group>
                <Group title="通常一次可以学习多久？">
                  <Choices name="duration" options={DURATION_OPTIONS.map(v => ({ value: String(v), label: v + ' 分钟' }))} values={answers.duration ? [String(answers.duration)] : []} onChange={v => update('duration', v[0] ? Number(v[0]) as OnboardingAnswers['duration'] : undefined)} />
                </Group>
                <Group title="方便学习的时段">
                  <Choices name="slots" multiple options={SLOT_OPTIONS.map(v => ({ value: v, label: v }))} values={answers.timeSlots} onChange={v => update('timeSlots', v as OnboardingAnswers['timeSlots'])} />
                </Group>
              </>}
            </fieldset>
            {step === 3 && <dl className="divide-y divide-border rounded-xl border border-border px-4 sm:px-5">
              {PROFILE_INFO_KEYS.map(key => <div key={key} className="grid gap-2 py-4 sm:grid-cols-[120px_minmax(0,1fr)]">
                <dt className="text-sm font-medium">{PROFILE_INFO_LABELS[key]}</dt>
                <dd className="min-w-0 text-sm leading-6"><p className="whitespace-pre-wrap break-words">{getInfoDetails(preview, key).join('；') || '暂未填写'}</p>
                  {saved && <p className="mt-1 text-xs text-muted-foreground">{COLLECTION_STATE_LABELS[getInfoState(preview, key)]}</p>}
                </dd>
              </div>)}
            </dl>}
          </form>
          {saved && issues.length > 0 && <div role="status" className="mt-5 rounded-lg bg-muted p-4 text-sm">
            <CheckCircle2 className="mb-2 h-5 w-5 text-primary" />
            <ul className="space-y-1">{issues.map(issue => <li key={issue.field}>{issue.label}：{COLLECTION_STATE_LABELS[issue.state]}，原文字未保存。</li>)}</ul>
          </div>}
          {error && <div role="alert" className="mt-5 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm leading-6 text-destructive">
            {error}
            {extractionFailed && <Button type="button" variant="outline" className="mt-3 w-full text-foreground sm:w-auto" disabled={busy} onClick={() => void submit('submit', 'discard')}>放弃补充文字，仅保存选择项</Button>}
          </div>}
        </section>
      </div>
    </main>

    <footer className="shrink-0 border-t border-border bg-background">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-8 lg:pl-[304px]">
        {!saved && step > 0 ? <Button type="button" variant="ghost" disabled={busy} onClick={() => { setStep(s => s - 1); setError(''); setExtractionFailed(false); }}><ArrowLeft className="mr-1 h-4 w-4" />上一步</Button> : <span className="text-xs text-muted-foreground">{saved ? '可以先开始，再慢慢了解自己' : '约 2 分钟'}</span>}
        <div className="flex items-center gap-2">
          {!saved && step === 2 && <Button type="button" variant="ghost" disabled={busy} onClick={() => {
            setAnswers(a => ({ ...a, difficulties: [], difficultyDetails: '', formats: [], duration: undefined, timeSlots: [] })); setStep(3);
          }}>跳过本页</Button>}
          {saved ? <Button type="button" onClick={goHome}>进入首页<ArrowRight className="ml-1 h-4 w-4" /></Button>
            : <Button type="submit" form="onboarding-form" disabled={busy} className="min-w-28">{busy ? '校验并保存中…' : step === 3 ? '确认并开始学习' : '下一步'}{!busy && <ArrowRight className="ml-1 h-4 w-4" />}</Button>}
        </div>
      </div>
    </footer>
  </div>;
}
