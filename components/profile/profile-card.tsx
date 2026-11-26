'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useLearningProfileStore } from '@/lib/store/learning-profile';
import { COLLECTION_STATE_LABELS, DEFAULT_DIMENSIONS, PROFILE_INFO_KEYS, PROFILE_INFO_LABELS, type ProfileDimensions, type ProfileInfoKey, type ProfileTextKey } from '@/lib/types/profile';
import { calculateProfileCompleteness, getInfoDetails, getInfoState } from '@/lib/utils/profile-utils';
import { TEXT_FIELD_LABELS } from '@/lib/onboarding/mapping';
import { CheckCircle2, CircleDashed } from 'lucide-react';
import { cn } from '@/lib/utils';

const TEXT_FIELDS: Partial<Record<ProfileInfoKey, ProfileTextKey[]>> = {
  identity: ['identityDetail'], subjects: ['customSubjects'], foundation: ['foundationDetails'],
  goals: ['goalDescription'], difficulties: ['difficultyDetails'],
};
export function ProfileCard({ dimensions: supplied }: { dimensions?: ProfileDimensions }) {
  const profile = useLearningProfileStore(s => s.profile);
  const d = supplied ?? profile?.dimensions ?? DEFAULT_DIMENSIONS;
  const completeness = calculateProfileCompleteness(d);
  return <Card className="shadow-none">
    <CardHeader className="pb-4">
      <CardTitle className="text-base">学习画像</CardTitle>
      <div className="flex items-center gap-3 text-xs">
        <span className="shrink-0 text-muted-foreground">基础信息完整度</span><Progress value={completeness} className="h-1.5" /><span className="tabular-nums">{completeness}%</span>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">完整度仅计算身份、学科和目标。以下状态表示信息是否已获取。</p>
    </CardHeader>
    <CardContent>
      <dl className="divide-y divide-border">
        {PROFILE_INFO_KEYS.map(key => {
          const state = getInfoState(d, key);
          const details = getInfoDetails(d, key);
          const unconfirmedFields = (TEXT_FIELDS[key] ?? []).filter(field => d.onboarding?.fieldStates[field] && d.onboarding.fieldStates[field] !== 'confirmed');
          return <div key={key} className="py-4 first:pt-0 last:pb-0">
            <dt className="flex flex-wrap items-center justify-between gap-2 text-sm font-medium">
              {PROFILE_INFO_LABELS[key]}
              <span className={cn('inline-flex items-center gap-1.5 text-xs font-normal', state === 'confirmed' ? 'text-primary' : 'text-muted-foreground')}>
                {state === 'confirmed' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <CircleDashed className="h-3.5 w-3.5" />}{COLLECTION_STATE_LABELS[state]}
              </span>
            </dt>
            <dd className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{details.length ? details.join('；') : state === 'skipped' ? '这项信息暂时留空。' : '暂未获取明确的信息。'}</dd>
            {unconfirmedFields.length > 0 && <dd className="mt-2 text-xs leading-5 text-muted-foreground">
              {unconfirmedFields.map(field => TEXT_FIELD_LABELS[field] + '：' + COLLECTION_STATE_LABELS[d.onboarding!.fieldStates[field]!]).join('；')}。未确认的原文字未保存。
            </dd>}
          </div>;
        })}
      </dl>
    </CardContent>
  </Card>;
}
