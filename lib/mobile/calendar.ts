import { z } from 'zod';

export const timezoneOffsetSchema = z.coerce.number().int().min(-840).max(840).default(0);
export const dayMs = 86_400_000;

export function localDay(date: Date, timezoneOffset: number) {
  const offset = timezoneOffset * 60_000;
  return new Date(Math.floor((date.getTime() - offset) / dayMs) * dayMs + offset);
}
