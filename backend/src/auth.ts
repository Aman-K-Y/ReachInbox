import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { config } from './config';

export type AuthRequest = Request & { userId?: string };
export function signToken(userId: string) {
  return jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: '7d' });
}
export function verifyToken(token: string) {
  try {
    const payload = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload;
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}
export function auth(req: AuthRequest, res: Response, next: NextFunction) {
  const value = req.header('authorization');
  const match = value?.match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ error: 'Authentication required' });
  try {
    const payload = jwt.verify(match[1].trim(), config.jwtSecret) as jwt.JwtPayload;
    if (typeof payload.sub !== 'string') throw new Error('Invalid token');
    req.userId = payload.sub;
    next();
  } catch { res.status(401).json({ error: 'Invalid or expired token' }); }
}
export const hashPassword = (password: string) => bcrypt.hash(password, 12);
export const verifyPassword = (password: string, hash: string) => bcrypt.compare(password, hash);
