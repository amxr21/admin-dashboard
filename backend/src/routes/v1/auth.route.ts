import { Router } from 'express';
import { z } from 'zod';

import { AppError } from '../../errors/AppError.js';
import { authenticate, requireUser } from '../../middleware/authenticate.js';
import { loginRateLimit } from '../../middleware/rateLimit.js';
import { login } from '../../services/auth.service.js';

/**
 * Authentication routes.
 *
 * Handlers stay thin: validate → call the service → shape the response → log.
 * All the decision-making lives in auth.service.ts where it can be tested
 * without HTTP.
 */

export const authRouter = Router();

const loginSchema = z
  .object({
    email: z.string().email('Enter a valid email address'),
    // No max length or complexity rule on LOGIN — those belong on registration
    // and password change. Rejecting a long password here only tells an
    // attacker about the policy, and breaks anyone using a password manager.
    password: z.string().min(1, 'Password is required'),
  })
  // .strict() so unexpected fields are rejected rather than silently ignored.
  .strict();

// POST /api/v1/auth/login
authRouter.post('/auth/login', loginRateLimit, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);

  if (!parsed.success) {
    // Field-level errors are safe here: the client sent them, so this leaks
    // nothing it doesn't already know.
    throw AppError.badRequest('Invalid credentials format', parsed.error.flatten());
  }

  const { email, password } = parsed.data;

  // NEVER log req.body — it holds the password. Email only, and only because
  // it's needed to trace a lockout back to an account.
  req.log.info({ event: 'auth.login.started', email });

  try {
    const result = await login(email, password);

    req.log.info({ event: 'auth.login.succeeded', userId: result.user.id });

    res.status(200).json({ data: result });
  } catch (err) {
    // Log the failure with the reason code, not the password. This is the
    // signal a future audit log and alerting will build on.
    req.log.warn({
      event: 'auth.login.failed',
      email,
      reason: err instanceof AppError ? err.code : 'UNKNOWN',
    });
    throw err;
  }
});

// GET /api/v1/auth/me
authRouter.get('/auth/me', authenticate, (req, res) => {
  // `authenticate` already re-read the user from the database and confirmed the
  // account is still active, so this is a live record, not stale token claims.
  const user = requireUser(req);

  res.status(200).json({ data: user });
});
