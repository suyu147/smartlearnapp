import { describe, it, expect, vi } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';
describe('request identity forwarding', () => {
  it('overwrites a forged caller header with the verified identity in the downstream request', async () => {
    vi.stubEnv('AUTH_MODE', 'multi'); vi.stubEnv('JWT_SECRET', 'history-middleware-test-secret');
    try {
      const token = await new SignJWT({ userId: 'verified-user', role: 'user' }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('5m').sign(new TextEncoder().encode('history-middleware-test-secret'));
      const response = await middleware(new NextRequest('http://localhost/api/v1/sessions', { headers: { Authorization: `Bearer ${token}`, 'x-user-id': 'forged-user' } }));
      expect(response.headers.get('x-middleware-request-x-user-id')).toBe('verified-user');
      expect(response.headers.get('x-middleware-override-headers')).toContain('x-user-id');
    } finally { vi.unstubAllEnvs(); }
  });
  it('rejects unauthenticated multi-account requests', async () => {
    vi.stubEnv('AUTH_MODE', 'multi');
    try { expect((await middleware(new NextRequest('http://localhost/api/v1/sessions', { headers: { 'x-user-id': 'forged-user' } }))).status).toBe(401); }
    finally { vi.unstubAllEnvs(); }
  });
});
