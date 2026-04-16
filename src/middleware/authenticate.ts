import { RequestHandler } from 'express';
import { verifyAccessToken, validateUserActive } from '../services/auth.service';
import { UnauthorizedError } from '../types/errors';

/**
 * authenticate middleware
 *
 * 1. Reads the Bearer token from the Authorization header.
 * 2. Verifies the JWT signature and expiry.
 * 3. Checks the user account is still active in the DB.
 * 4. Attaches { userId, email } to req.user.
 *
 * Every protected route must use this middleware first.
 */
export const authenticate: RequestHandler = async (req, _res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedError('Authorization header missing or malformed');
    }

    const token = header.slice(7);
    const { userId, email } = verifyAccessToken(token);

    // Checking isActive here means a deactivated global account is rejected
    // immediately, not just at membership level.
    await validateUserActive(userId);

    req.user = { userId, email };
    next();
  } catch (err) {
    next(err);
  }
};
