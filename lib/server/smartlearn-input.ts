import { z } from 'zod';

export const smartLearnAiConfig = z.object({
  providerId: z.string().max(64).optional(),
  modelId: z.string().max(200).optional(),
  apiKey: z.string().max(2048).optional(),
  baseUrl: z.string().max(2048).optional(),
});
