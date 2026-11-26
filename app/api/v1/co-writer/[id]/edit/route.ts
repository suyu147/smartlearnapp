import { NextRequest } from 'next/server';
import { HistoryConflict } from '@/lib/history/server';
import { apiSuccess, apiError } from '@/lib/server/api-response';
import { getEditAgent, getOperationHistory } from '@/lib/deeptutor/bootstrap';
import { CowriterDbService } from '@/lib/deeptutor/services/cowriter-db-service';
import { validatedBody, errorToMessage, isValidationError, isSyntaxError } from '@/lib/server/validate';
import { CoWriterEditSchema } from '@/lib/server/schemas';
import { withAuth } from '@/lib/deeptutor/services/auth-middleware';
import { createLogger } from '@/lib/logger';

const log = createLogger('api:co-writer');

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/co-writer/:id/edit — AI-powered text editing
 * Body: { text, instruction, action, source?, kbName?, language? }
 *
 * Applies an AI edit action (rewrite/shorten/expand/summarize) to the text.
 * Records the operation in history and optionally updates the document.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { id: docId } = await params;
  return withAuth(request, async (req, { user }) => {
    try {
      const { text, instruction, action, source, kbName, language, expectedVersion } =
        await validatedBody(CoWriterEditSchema, req);

      // Verify document ownership
      const db = new CowriterDbService();
      const existingDoc = await db.getDocument(docId);
      if (!existingDoc || existingDoc.userId !== user.id) {
        return apiError('Document not found', 404, 'NOT_FOUND');
      }

      if (expectedVersion !== existingDoc.version) return apiError("文档已在其他设备更新，请刷新", 409);
      const agent = getEditAgent();
      const result = await agent.edit({
        text,
        instruction: instruction || '',
        action,
        source,
        kbName,
        language,
      });

      let savedDoc = existingDoc;
      if (result.editedText && !result.editedText.startsWith('[')) {
        const metadata = existingDoc.metadata ?? {};
        const operations = Array.isArray(metadata.operations) ? metadata.operations : [];
        savedDoc = await db.updateDocument(docId, { content: result.editedText, metadata: { ...metadata, operations: [...operations, { id: result.operationId, action, instruction, originalLength: text.length, editedLength: result.editedText.length, timestamp: new Date().toISOString() }] } }, existingDoc.version) ?? existingDoc;
      }

      return apiSuccess({
        editedText: result.editedText,
        operationId: result.operationId,
        version: savedDoc.version,
      });
    } catch (err) {
      if (err instanceof HistoryConflict) return apiError(err.message, 409);
      if (isValidationError(err) || isSyntaxError(err)) {
        return apiError(errorToMessage(err), 400);
      }
      log.error('[co-writer] POST :id/edit error:', err);
      return apiError('Edit operation failed', 500);
    }
  });
}
