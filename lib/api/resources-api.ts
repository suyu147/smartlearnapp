import { apiGet, apiPost, apiDelete } from '@/lib/api-client';
import type { Resource } from '@/lib/types/resource';
export async function fetchResources(_userId: string, sessionId?: string): Promise<Resource[]> {
  const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';
  const data = await apiGet<{ resources: Resource[] }>(`/api/v1/resources/sync${query}`);
  return data.resources;
}
export async function saveResources(_userId: string, resources: Resource[]): Promise<Resource[]> {
  const data = await apiPost<{ resources: Resource[] }>('/api/v1/resources/sync', { resources });
  return data.resources;
}
export async function deleteResources(ids?: string[]): Promise<boolean> {
  await apiDelete(`/api/v1/resources/sync${ids ? `?ids=${encodeURIComponent(ids.join(','))}` : ''}`);
  return true;
}
