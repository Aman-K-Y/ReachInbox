import { describe, expect, it, vi } from 'vitest';
import { auth, signToken, verifyToken } from './auth';

describe('authentication', () => {
 it('creates a verifiable JWT', () => {
   const token = signToken('user-1');
   expect(token.split('.')).toHaveLength(3);
   expect(verifyToken(token)).toBe('user-1');
 });

 it('accepts bearer tokens in any capitalization', () => {
   const req = { header: () => `bearer ${signToken('user-2')}` } as any;
   const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
   const next = vi.fn();

   auth(req, res, next);

   expect(req.userId).toBe('user-2');
   expect(next).toHaveBeenCalledTimes(1);
   expect(res.status).not.toHaveBeenCalled();
 });

 it('respects configured port 0', async () => {
   const previousPort = process.env.API_PORT;
   process.env.API_PORT = '0';

   vi.resetModules();
   const { config } = await import('./config');

   expect(config.port).toBe(0);

   if (previousPort === undefined) delete process.env.API_PORT;
   else process.env.API_PORT = previousPort;
   vi.resetModules();
 });
});
