/**
 * POST /api/v1/attachments — Upload file attachment for chat
 */

import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/deeptutor/services/auth-middleware';
import { readdir, readFile } from 'fs/promises';
import { createLogger } from '@/lib/logger';
import { getDataDir } from '@/lib/paths';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

const log = createLogger('AttachmentsRoute');

function getUserId(req: NextRequest): string {
  return req.headers.get('x-user-id') ?? 'anonymous';
}

function apiError(err: unknown, fallbackStatus: number = 500) {
  const message = err instanceof Error ? err.message : 'Unknown error';
  log.error('error', err);
  return new Response(JSON.stringify({ error: message }), {
    status: fallbackStatus,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST(req: NextRequest) {
  try {
    const userId = getUserId(req);
    const contentType = req.headers.get('content-type') ?? '';

    if (!contentType.includes('multipart/form-data')) {
      return new Response(JSON.stringify({ error: 'multipart/form-data with file is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return new Response(JSON.stringify({ error: 'file field is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Save to local disk
    const uploadDir = getDataDir('attachments', userId);
    await mkdir(uploadDir, { recursive: true });

    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = join(uploadDir, `${timestamp}_${safeName}`);
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, buffer);

    const attachment = {
      id: `att_${timestamp}`,
      fileName: file.name,
      filePath,
      url: `/api/v1/attachments?id=att_${timestamp}`,
      fileSize: buffer.length,
      mimeType: file.type || 'application/octet-stream',
      uploadedAt: new Date().toISOString(),
    };

    return new Response(JSON.stringify({ success: true, data: attachment }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    log.error('POST /api/v1/attachments failed:', err);
    return apiError(err);
  }
}

export async function GET(req: NextRequest) {
  return withAuth(req, async (_, { user }) => {
    const id = req.nextUrl.searchParams.get('id');
    if (!id || !/^att_[0-9]+$/.test(id)) return new Response('Invalid attachment id', { status: 400 });
    const dir = getDataDir('attachments', user.id);
    const files = await readdir(dir).catch(() => [] as string[]);
    const fileName = files.find(name => name.startsWith(`${id.slice(4)}_`));
    if (!fileName) return new Response('Attachment not found', { status: 404 });
    const data = await readFile(join(dir, fileName));
    const extension = fileName.split('.').pop()?.toLowerCase() ?? 'bin';
    const types: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', pdf: 'application/pdf', txt: 'text/plain' };
    return new Response(data, { headers: { 'Content-Type': types[extension] ?? 'application/octet-stream', 'Content-Disposition': `attachment; filename="${fileName.slice(fileName.indexOf('_') + 1)}"`, 'Cache-Control': 'private, max-age=3600' } });
  });
}
