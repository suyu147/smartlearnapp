import { z } from 'zod';
import { parseJsonResponse } from '@/lib/generation/json-repair';

const questionSchema = z.object({
  id: z.string().optional(),
  type: z.enum(['choice', 'fill']),
  question: z.string().trim().min(1).max(5000),
  options: z.array(z.string().trim().min(1).max(1000)).min(2).max(10).optional(),
  answer: z.union([z.string(), z.array(z.string())]),
  explanation: z.string().default(''),
  difficulty: z.coerce.number().int().min(1).max(5).default(3),
  knowledgePoints: z.array(z.string().trim().min(1).max(250)).max(8).default([]),
});

export const MOBILE_PATH_RESOURCES = ['document', 'quiz'] as const;
export const normalizeAnswer = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

export function parseMobileQuestions(content: string) {
  const parsed = parseJsonResponse<unknown>(content);
  const items = Array.isArray(parsed) ? parsed : [parsed];
  return items.slice(0, 100).flatMap((item, index) => {
    const result = questionSchema.safeParse(item);
    if (!result.success) return [];
    const question = result.data;
    const answers = [question.answer].flat().map(answer => answer.trim()).filter(Boolean);
    if (!answers.length || answers.some(answer => answer.length > 2000)) return [];
    if (question.type === 'choice' &&
      !answers.every(answer => question.options?.some(option => normalizeAnswer(option) === normalizeAnswer(answer)))) return [];
    return [{ ...question, id: String(index + 1), answers }];
  });
}

export function publicQuestions(questions: ReturnType<typeof parseMobileQuestions>) {
  return questions.map(({ id, type, question, options }) => ({ id, type, question, options }));
}
