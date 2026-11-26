import { z } from 'zod';

export const SUBJECT_OPTIONS = ['数学', '语文', '英语', '物理', '化学', '生物', '历史', '地理', '计算机与编程', '数据与人工智能', '职业技能', '艺术与设计'] as const;
export const STAGE_OPTIONS = ['小学', '初中', '高中', '中职 / 高职', '大学本科', '研究生及以上'] as const;
export const DIFFICULTY_OPTIONS = ['基础概念不牢', '知识点难以串联', '解题思路不清', '理论难以应用', '记忆与复习困难', '学习注意力难集中'] as const;
export const SLOT_OPTIONS = ['清晨', '上午', '下午', '晚上', '时间灵活'] as const;
export const DURATION_OPTIONS = [15, 30, 45, 60, 90] as const;
export const TEXT_KEYS = ['identityDetail', 'customSubjects', 'foundationDetails', 'goalDescription', 'difficultyDetails'] as const;
const text = z.string().trim().max(500).default('');
const choices = <T extends string>(values: readonly [T, ...T[]]) => z.array(z.enum(values)).max(12).transform(v => [...new Set(v)]).default([]);
export const OnboardingAnswersSchema = z.object({
  role: z.enum(['student', 'professional', 'teacher', 'self_learner', 'other']).optional(),
  stage: z.enum(STAGE_OPTIONS).optional(),
  identityDetail: text,
  subjects: choices(SUBJECT_OPTIONS),
  customSubjects: text,
  level: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
  foundationDetails: text,
  goalKind: z.enum(['exam', 'skill', 'interest']).optional(),
  goalDescription: text,
  targetDate: z.string().refine(value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(value + 'T00:00:00Z');
    return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
  }, '请选择有效日期').optional(),
  difficulties: choices(DIFFICULTY_OPTIONS),
  difficultyDetails: text,
  formats: choices(['video', 'document', 'code', 'quiz', 'mindmap'] as const),
  duration: z.union([z.literal(15), z.literal(30), z.literal(45), z.literal(60), z.literal(90)]).optional(),
  timeSlots: choices(SLOT_OPTIONS),
}).strict();
export type OnboardingAnswers = z.infer<typeof OnboardingAnswersSchema>;
export const OnboardingRequestSchema = z.object({
  submissionId: z.string().uuid(),
  mode: z.enum(['submit', 'skip']).default('submit'),
  textPolicy: z.enum(['extract', 'discard']).default('extract'),
  answers: OnboardingAnswersSchema,
  aiConfig: z.object({
    providerId: z.string().max(100).optional(), modelId: z.string().max(200).optional(),
    apiKey: z.string().max(2000).optional(), baseUrl: z.string().url().max(2000).optional(),
  }).strict().optional(),
}).strict().superRefine((request, ctx) => {
  if (request.mode === 'skip') return;
  const missing = requiredAnswerErrors(request.answers);
  for (const [path, message] of Object.entries(missing)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['answers', path], message });
});
export type OnboardingRequest = z.infer<typeof OnboardingRequestSchema>;
export function requiredAnswerErrors(a: OnboardingAnswers): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!a.role) errors.role = '请选择你的身份';
  if (!a.subjects.length && !a.customSubjects.trim()) errors.subjects = '请至少选择或补充一个学科与领域';
  if (!a.goalKind) errors.goalKind = '请选择一个学习目标';
  return errors;
}
export function createEmptyAnswers(): OnboardingAnswers {
  return OnboardingAnswersSchema.parse({});
}
