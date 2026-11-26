/**
 * UserSettingsService — Server-side settings persistence
 */

import { createLogger } from '@/lib/logger';
import prisma from '@/lib/db/client';
import { Prisma } from '@prisma/client';

const log = createLogger('UserSettingsService');

export interface UserSettingsData {
  provider?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  thinkingMode?: boolean;
  theme?: string;
  language?: string;
  smartlearnProviderId?: string;
  smartlearnModelId?: string;
  smartlearnBaseUrl?: string;
  generatePptImages?: boolean;
  pptMaxPages?: number | null;
  enablePptInteractive?: boolean;
  enablePptQuiz?: boolean;
  revision?: number;
  sparkModelId?: string;
  maxTurns?: number;
  maxResourceConcurrency?: number;
  ttsProviderId?: string;
  ttsVoice?: string;
  ttsSpeed?: number;
  ttsProvidersConfig?: Record<string, unknown>;
  asrProviderId?: string;
  asrLanguage?: string;
  asrProvidersConfig?: Record<string, unknown>;
  selectedAgentIds?: string[];
  disabledAgentIds?: string[];
  autoContextWindow?: boolean;
  contextWindowThreshold?: number;
  rateLimitEnabled?: boolean;
}

export class UserSettingsService {
  async getSettings(userId: string): Promise<UserSettingsData | null> {
    try {
      const record = await prisma.userSettings.findUnique({ where: { userId } });
      if (!record) return null;

      return {
        provider: record.provider ?? undefined,
        model: record.model ?? undefined,
        temperature: record.temperature,
        maxTokens: record.maxTokens,
        thinkingMode: record.thinkingMode,
        theme: record.theme,
        language: record.language,
        smartlearnProviderId: record.smartlearnProviderId ?? undefined,
        smartlearnModelId: record.smartlearnModelId ?? undefined,
        smartlearnBaseUrl: record.smartlearnBaseUrl ?? undefined,
        generatePptImages: record.generatePptImages,
        pptMaxPages: record.pptMaxPages,
        enablePptInteractive: record.enablePptInteractive,
        enablePptQuiz: record.enablePptQuiz,
        revision: record.revision,
        sparkModelId: (record.extra as { sparkModelId?: string } | null)?.sparkModelId,
        maxTurns: record.maxTurns,
        maxResourceConcurrency: record.maxResourceConcurrency,
        ttsProviderId: record.ttsProviderId ?? undefined,
        ttsVoice: record.ttsVoice ?? undefined,
        ttsSpeed: record.ttsSpeed,
        ttsProvidersConfig: record.ttsProvidersConfig as Record<string, unknown> | undefined,
        asrProviderId: record.asrProviderId ?? undefined,
        asrLanguage: record.asrLanguage ?? undefined,
        asrProvidersConfig: record.asrProvidersConfig as Record<string, unknown> | undefined,
        selectedAgentIds: record.selectedAgentIds ?? undefined,
        disabledAgentIds: record.disabledAgentIds ?? undefined,
        autoContextWindow: record.autoContextWindow,
        contextWindowThreshold: record.contextWindowThreshold,
        rateLimitEnabled: record.rateLimitEnabled,
      };
    } catch (err) {
      log.error('getSettings failed:', err);
      throw err;
    }
  }

  async updateSettings(userId: string, data: UserSettingsData, expectedRevision: number): Promise<boolean> {
    await prisma.user.upsert({ where: { id: userId }, update: {}, create: { id: userId, name: userId } });
    const { revision: _revision, sparkModelId, ...preferences } = data;
    const fields: Record<string, unknown> = { ...preferences, ...(sparkModelId !== undefined ? { extra: { sparkModelId } } : {}) };
    for (const key of ['ttsProvidersConfig', 'asrProvidersConfig'] as const) {
      if (fields[key] !== undefined) fields[key] = JSON.parse(JSON.stringify(fields[key])) as Prisma.InputJsonValue;
    }
    if (!expectedRevision) {
      const existing = await prisma.userSettings.updateMany({ where: { userId, revision: 0 }, data: { ...fields, revision: 1 } });
      if (existing.count === 1) return true;
      try { await prisma.userSettings.create({ data: { ...fields, userId, revision: 1 } }); return true; }
      catch (error) { if ((error as { code?: string }).code === 'P2002') return false; throw error; }
    }
    const result = await prisma.userSettings.updateMany({ where: { userId, revision: expectedRevision }, data: { ...fields, revision: { increment: 1 } } });
    return result.count === 1;
  }
}
