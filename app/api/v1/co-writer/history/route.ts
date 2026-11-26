import { NextRequest } from 'next/server';
import { apiSuccess } from '@/lib/server/api-response';
import { withAuth } from '@/lib/deeptutor/services/auth-middleware';
import prisma from '@/lib/utils/database';
export async function GET(req: NextRequest) {
  return withAuth(req, async (_, { user }) => {
    const documents = await prisma.cowriterDocument.findMany({ where: { userId: user.id }, select: { id: true, title: true, metadata: true } });
    const records = documents.flatMap(document => {
      const metadata = document.metadata as { operations?: Array<Record<string, unknown>> } | null;
      return (metadata?.operations ?? []).map(operation => ({ ...operation, documentId: document.id, documentTitle: document.title }));
    }).sort((a, b) => String((b as Record<string, unknown>).timestamp).localeCompare(String((a as Record<string, unknown>).timestamp)));
    return apiSuccess(records);
  });
}
