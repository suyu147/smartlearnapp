import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/deeptutor/services/auth-middleware';
// Retired: old bulk uploads have no session ownership or revision information.
export async function GET(req: NextRequest) { return withAuth(req, async () => NextResponse.json({ error: 'Use /api/v1/learning-history' }, { status: 410 })); }
export const POST = GET;
