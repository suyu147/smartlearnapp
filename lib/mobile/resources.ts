import type { Resource } from '@/lib/types/resource';

export function mobileResource(resource: Resource): Resource | null {
  const metadata = resource.metadata;
  if (resource.status !== 'ready' || metadata?.origin !== 'learning-path') return null;
  if (resource.type === 'ppt' && metadata.standardPptData?.format !== 'standard_pptx_v1') return null;
  if (resource.type === 'quiz' || resource.type === 'ppt') {
    return { ...resource, content: '', metadata: { origin: metadata.origin, nodeId: metadata.nodeId } };
  }
  return resource;
}
