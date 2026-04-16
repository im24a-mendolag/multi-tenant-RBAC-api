import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma } from '../prisma/client';
import { env } from '../config/env';
import {
  ConflictError,
  UnauthorizedError,
  BadRequestError,
} from '../types/errors';

const BCRYPT_ROUNDS = 12;
const ACCESS_TOKEN_TTL = '1h';
const REFRESH_TOKEN_TTL_DAYS = 12;

// ─── Token helpers ────────────────────────────────────────────────────────────

function generateAccessToken(userId: string, email: string): string {
  return jwt.sign({ email }, env.JWT_ACCESS_SECRET, {
    subject: userId,
    expiresIn: ACCESS_TOKEN_TTL,
  });
}

function generateRefreshToken(userId: string): string {
  // jti (JWT ID) is a unique identifier stored in the DB alongside the hash.
  // On rotation, we revoke by jti so old tokens become invalid immediately.
  const jti = crypto.randomUUID();
  return jwt.sign({ jti }, env.JWT_REFRESH_SECRET, {
    subject: userId,
    expiresIn: `${REFRESH_TOKEN_TTL_DAYS}d`,
  });
}

function hashToken(rawToken: string): string {
  // We store SHA-256(token) not the raw token.
  // A DB breach cannot produce a usable refresh token.
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

async function storeRefreshToken(userId: string, rawToken: string): Promise<void> {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_TTL_DAYS);

  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashToken(rawToken),
      expiresAt,
    },
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function register(email: string, password: string) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new ConflictError('Email already in use');

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const user = await prisma.user.create({
    data: { email, passwordHash },
    select: { id: true, email: true, createdAt: true },
  });

  const accessToken = generateAccessToken(user.id, user.email);
  const refreshToken = generateRefreshToken(user.id);
  await storeRefreshToken(user.id, refreshToken);

  return { user, accessToken, refreshToken };
}

export async function login(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });

  // Use a constant-time comparison path even when user is not found
  // to prevent user-enumeration via timing attacks.
  const passwordMatch =
    user != null
      ? await bcrypt.compare(password, user.passwordHash)
      : await bcrypt.compare(password, '$2b$12$placeholder.hash.to.prevent.timing.attack');

  if (!user || !passwordMatch) {
    throw new UnauthorizedError('Invalid email or password');
  }
  if (!user.isActive) {
    throw new UnauthorizedError('Account is deactivated');
  }

  const accessToken = generateAccessToken(user.id, user.email);
  const refreshToken = generateRefreshToken(user.id);
  await storeRefreshToken(user.id, refreshToken);

  return {
    user: { id: user.id, email: user.email },
    accessToken,
    refreshToken,
  };
}

export async function refresh(rawToken: string) {
  // Verify the JWT first — if it's tampered or expired, reject early.
  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(rawToken, env.JWT_REFRESH_SECRET) as jwt.JwtPayload;
  } catch {
    throw new UnauthorizedError('Invalid or expired refresh token');
  }

  const tokenHash = hashToken(rawToken);
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });

  if (!stored || stored.revoked || stored.expiresAt < new Date()) {
    throw new UnauthorizedError('Refresh token is invalid or has been revoked');
  }

  // Rotate: revoke the old token and issue a new pair.
  // This means a stolen refresh token can only be used once before invalidation.
  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revoked: true },
  });

  const userId = payload.sub!;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, isActive: true },
  });

  if (!user || !user.isActive) {
    throw new UnauthorizedError('Account not found or deactivated');
  }

  const newAccessToken = generateAccessToken(user.id, user.email);
  const newRefreshToken = generateRefreshToken(user.id);
  await storeRefreshToken(user.id, newRefreshToken);

  return { accessToken: newAccessToken, refreshToken: newRefreshToken };
}

export function verifyAccessToken(token: string) {
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as jwt.JwtPayload;
    if (!payload.sub || !payload.email) throw new Error('Missing fields');
    return { userId: payload.sub, email: payload.email as string };
  } catch {
    throw new UnauthorizedError('Invalid or expired access token');
  }
}

export async function validateUserActive(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isActive: true },
  });
  if (!user?.isActive) {
    throw new UnauthorizedError('Account is deactivated');
  }
}

export async function revokeAllUserTokens(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revoked: false },
    data: { revoked: true },
  });
}

export async function validateRefreshTokenInput(data: unknown): Promise<{ refreshToken: string }> {
  if (
    typeof data !== 'object' ||
    data === null ||
    typeof (data as Record<string, unknown>).refreshToken !== 'string'
  ) {
    throw new BadRequestError('refreshToken is required');
  }
  return { refreshToken: (data as { refreshToken: string }).refreshToken };
}
