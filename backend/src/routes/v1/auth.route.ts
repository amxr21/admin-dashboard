import { Router } from 'express';
import { z } from 'zod';
import { AuditOutcome } from '@prisma/client';
import QRCode from 'qrcode';

import { AppError } from '../../errors/AppError.js';
import { audit } from '../../services/audit.service.js';
import { authenticate, requireUser } from '../../middleware/authenticate.js';
import { createApiKey, listApiKeys, revokeApiKey } from '../../services/api-key.service.js';
import {
  loginRateLimit,
  passwordResetRateLimit,
  selfPasswordChangeRateLimit,
} from '../../middleware/rateLimit.js';
import { login, signToken, verifyLoginCode } from '../../services/auth.service.js';
import { redeemResetToken } from '../../services/password-reset.service.js';
import { createSession, listSessions, revokeSession } from '../../services/session.service.js';
import { assertPasswordMeetsPolicy } from '../../services/settings.service.js';
import { changeOwnPassword, updateOwnProfile } from '../../services/staff.service.js';
import {
  beginSetup,
  confirmSetup,
  disableTwoFactor,
  getStatus,
} from '../../services/two-factor.service.js';

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
    const result = await login(email, password, {
      userAgent: req.get('user-agent'),
      ip: req.ip,
    });

    /**
     * 2FA account: the password checked out, but that is NOT a completed
     * sign-in — no session exists yet, nothing above should be logged as a
     * success. Neither `auth.login.succeeded` (nothing succeeded yet) nor
     * `auth.login.failed` (the password was right) is the correct audit
     * entry here, so deliberately neither fires; `auth.login.2fa-verified`
     * or a genuine failure from `POST /auth/login/verify-2fa` is the entry
     * that actually closes this event out.
     */
    if (result.twoFactorRequired) {
      res.status(200).json({ data: result });
      return;
    }

    req.log.info({ event: 'auth.login.succeeded', userId: result.user.id });

    /**
     * A successful sign-in is a trail entry (B1.7).
     *
     * `req.user` is not populated on this route — nothing authenticated the
     * request, the request IS the authentication — so the actor is passed
     * explicitly rather than read off the request.
     */
    audit(req, {
      action: 'auth.login.succeeded',
      entity: 'auth',
      entityId: result.user.id,
      actor: result.user,
    });

    res.status(200).json({ data: result });
  } catch (err) {
    // Log the failure with the reason code, not the password. This is the
    // signal a future audit log and alerting will build on.
    req.log.warn({
      event: 'auth.login.failed',
      email,
      reason: err instanceof AppError ? err.code : 'UNKNOWN',
    });

    /**
     * A FAILED sign-in matters more than a successful one — repeated failures
     * against one account are what a password-guessing attack looks like, and
     * are invisible in a success-only trail.
     *
     * The email is recorded because it is the only identifying fact available
     * (no user is attached to a failed login) and it is already considered
     * safe to log on this route. The password is never touched.
     */
    audit(req, {
      action: 'auth.login.failed',
      entity: 'auth',
      outcome: AuditOutcome.DENIED,
      changes: { email, reason: err instanceof AppError ? err.code : 'UNKNOWN' },
    });

    throw err;
  }
});

const verify2faSchema = z
  .object({
    pendingToken: z.string().trim().min(1, 'Token is required'),
    code: z.string().trim().min(1, 'Code is required').max(16),
  })
  .strict();

/**
 * POST /api/v1/auth/login/verify-2fa
 *
 * The second half of a 2FA login. Deliberately unauthenticated — the
 * `pendingToken`, not a Bearer session, is what proves the password step
 * already happened. Same rate-limit class as login itself: this is the one
 * place an attacker who stole a password (but not the phone/backup codes)
 * gets to guess against, so it needs the same defence login does.
 */
authRouter.post('/auth/login/verify-2fa', loginRateLimit, async (req, res) => {
  const parsed = verify2faSchema.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest('Invalid request', parsed.error.flatten());

  req.log.info({ event: 'auth.login.2fa-attempted' });

  try {
    const result = await verifyLoginCode(parsed.data.pendingToken, parsed.data.code, {
      userAgent: req.get('user-agent'),
      ip: req.ip,
    });

    req.log.info({ event: 'auth.login.2fa-verified', userId: result.user.id });

    audit(req, {
      action: 'auth.login.2fa-verified',
      entity: 'auth',
      entityId: result.user.id,
      actor: result.user,
    });

    res.status(200).json({ data: result });
  } catch (err) {
    req.log.warn({
      event: 'auth.login.2fa-failed',
      reason: err instanceof AppError ? err.code : 'UNKNOWN',
    });

    // No actor to attach — a wrong code at this stage doesn't yet prove WHO
    // was trying, only that the pending token named someone.
    audit(req, {
      action: 'auth.login.2fa-failed',
      entity: 'auth',
      outcome: AuditOutcome.DENIED,
    });

    throw err;
  }
});

const resetPasswordSchema = z
  .object({
    token: z.string().trim().min(1, 'Token is required'),
    // The real floor is `security.minPasswordLength`, enforced dynamically
    // below via `assertPasswordMeetsPolicy` — same floor as an admin-set
    // password, kept in one place so the policy can't drift between the two
    // call sites.
    password: z.string().min(1, 'Password is required').max(200),
  })
  .strict();

// POST /api/v1/auth/reset-password
authRouter.post('/auth/reset-password', passwordResetRateLimit, async (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);

  if (!parsed.success) {
    throw AppError.badRequest('Invalid request', parsed.error.flatten());
  }

  await assertPasswordMeetsPolicy(parsed.data.password);

  // NEVER log the token or password — only that an attempt happened.
  req.log.info({ event: 'auth.password-reset.attempted' });

  await redeemResetToken(req, parsed.data.token, parsed.data.password);

  res.status(200).json({ data: { ok: true } });
});

// GET /api/v1/auth/me
authRouter.get('/auth/me', authenticate, (req, res) => {
  // `authenticate` already re-read the user from the database and confirmed the
  // account is still active, so this is a live record, not stale token claims.
  const user = requireUser(req);

  res.status(200).json({ data: user });
});

const updateProfileSchema = z
  .object({
    name: z.string().trim().max(120).optional(),
    phone: z.string().trim().max(32).optional(),
  })
  .strict();

/**
 * PATCH /api/v1/auth/me
 *
 * Self-service name/phone only. NOT the same route as `PATCH /staff/:id` —
 * that one is gated on the `staff` area, which SUPPORT/FULFILLMENT/DEMO do
 * not hold, so a non-admin had no way to fix a typo in their own name without
 * asking an OWNER. This route needs no area grant at all: `authenticate`
 * alone is sufficient, because it can only ever touch the caller's own row —
 * there is no id parameter for it to be tricked into pointing elsewhere.
 */
authRouter.patch('/auth/me', authenticate, async (req, res) => {
  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest('Invalid request', parsed.error.flatten());

  const actor = requireUser(req);
  const updated = await updateOwnProfile(actor, parsed.data);

  audit(req, {
    action: 'auth.profile.updated',
    entity: 'user',
    entityId: actor.id,
    changes: parsed.data,
  });

  res.status(200).json({ data: updated });
});

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    // Real floor is `security.minPasswordLength`, enforced dynamically below —
    // same shared policy as an admin-set password and a token redemption, so
    // it cannot drift between the three call sites.
    newPassword: z.string().min(1, 'New password is required').max(200),
  })
  .strict();

/**
 * PATCH /api/v1/auth/me/password
 *
 * The one password-change path in this app that requires proving the CURRENT
 * password — see `changeOwnPassword` for why. Rate-limited independently:
 * the `bcrypt.compare` against the current password is a guessable-password
 * oracle for whoever holds a valid session token.
 */
authRouter.patch(
  '/auth/me/password',
  authenticate,
  selfPasswordChangeRateLimit,
  async (req, res) => {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) throw AppError.badRequest('Invalid request', parsed.error.flatten());

    await assertPasswordMeetsPolicy(parsed.data.newPassword);

    const actor = requireUser(req);

    // NEVER log either password — only that a change happened.
    req.log.info({ event: 'auth.password-change.attempted', userId: actor.id });

    const updated = await changeOwnPassword(
      actor,
      parsed.data.currentPassword,
      parsed.data.newPassword,
    );

    audit(req, {
      action: 'auth.password.changed',
      entity: 'user',
      entityId: actor.id,
    });

    // A fresh SESSION as well as a fresh token: `changeOwnPassword` just
    // revoked every existing session row (including the one this request
    // used), so a token with no session id would be unable to be
    // individually revoked later — degraded exactly like a pre-Sessions
    // token, for no reason.
    const session = await createSession(actor.id, {
      userAgent: req.get('user-agent'),
      ip: req.ip,
    });

    // A fresh token, signed with the bumped tokenVersion, so the caller's own
    // successful change does not immediately invalidate the session they used
    // to make the request — every OTHER password path in this app targets
    // someone else and has no equivalent need.
    const token = signToken(
      { id: actor.id, role: actor.role, tokenVersion: updated.tokenVersion },
      undefined,
      session.id,
    );

    res.status(200).json({ data: { token } });
  },
);

/**
 * GET /api/v1/auth/me/sessions
 *
 * Every LIVE device this account is signed in on. Self-only, same reasoning
 * as `PATCH /auth/me` — no area grant needed, it can only ever read the
 * caller's own rows.
 */
authRouter.get('/auth/me/sessions', authenticate, async (req, res) => {
  const actor = requireUser(req);
  res.status(200).json({ data: await listSessions(actor.id) });
});

/**
 * DELETE /api/v1/auth/me/sessions/:id
 *
 * Sign out ONE device without touching any other — the actual point of
 * tracking sessions individually rather than only the single `tokenVersion`
 * counter, which can only sign out everywhere at once.
 */
authRouter.delete('/auth/me/sessions/:id', authenticate, async (req, res) => {
  const actor = requireUser(req);
  const id = String(req.params.id);

  await revokeSession(actor.id, id);

  audit(req, { action: 'auth.session.revoked', entity: 'session', entityId: id });

  res.status(204).send();
});

/**
 * POST /api/v1/auth/logout
 *
 * B1.7 — signing out used to be entirely client-side (drop the token, never
 * tell the server), so there was no `auth.logout` audit event for "I signed
 * myself out," even though `DELETE /auth/me/sessions/:id` already audited
 * revoking an OTHER device. Revokes the CALLING session specifically —
 * `req.sessionId` is the `sid` claim off the JWT that authenticated this
 * exact request (set by `authenticate`), not a session id from the body,
 * so this can only ever end the session making the call.
 *
 * A token minted before Sessions existed, or one issued via an API key, has
 * no `sessionId` — nothing to revoke, but the audit event still fires: the
 * meaningful fact is "this account was signed out," not "a Session row was
 * touched."
 */
authRouter.post('/auth/logout', authenticate, async (req, res) => {
  const actor = requireUser(req);

  if (req.sessionId) {
    await revokeSession(actor.id, req.sessionId);
  }

  audit(req, { action: 'auth.logout', entity: 'session', entityId: req.sessionId ?? actor.id });

  res.status(204).send();
});

/**
 * GET /api/v1/auth/me/2fa
 *
 * Current 2FA state — enabled or not, and (if enabled) how many of the
 * original ten backup codes are unused. Self-only, no area grant.
 */
authRouter.get('/auth/me/2fa', authenticate, async (req, res) => {
  const actor = requireUser(req);
  res.status(200).json({ data: await getStatus(actor.id) });
});

/**
 * POST /api/v1/auth/me/2fa/setup
 *
 * Step 1 of enrolment: generate a secret, return it as a QR code (an
 * `otpauth://` URI rendered to a data-URL PNG) plus the raw secret as a
 * fallback for anyone whose authenticator app can't scan. Does NOT enable
 * 2FA yet — see `confirmSetup`'s doc comment for why.
 */
authRouter.post('/auth/me/2fa/setup', authenticate, async (req, res) => {
  const actor = requireUser(req);

  const { secret, otpauthUri } = await beginSetup(actor.id, actor.email);
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUri);

  res.status(200).json({ data: { secret, qrCodeDataUrl } });
});

const confirmSetupSchema = z.object({ code: z.string().trim().min(1).max(16) }).strict();

/**
 * POST /api/v1/auth/me/2fa/confirm
 *
 * Step 2: prove the authenticator app actually works before 2FA starts
 * being enforced on this account. Returns the ten backup codes exactly
 * once — same one-time-reveal contract as a courier access code.
 */
authRouter.post('/auth/me/2fa/confirm', authenticate, async (req, res) => {
  const parsed = confirmSetupSchema.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest('Invalid request', parsed.error.flatten());

  const actor = requireUser(req);
  const result = await confirmSetup(actor.id, parsed.data.code);

  audit(req, { action: 'auth.two-factor.enabled', entity: 'user', entityId: actor.id });

  res.status(200).json({ data: result });
});

const disableTwoFactorSchema = z.object({ code: z.string().trim().min(1).max(16) }).strict();

/**
 * POST /api/v1/auth/me/2fa/disable
 *
 * Requires a CURRENT code — same reasoning as self-service password change
 * requiring the current password: this is a security downgrade, and a
 * session token alone is not proof enough for it.
 */
authRouter.post('/auth/me/2fa/disable', authenticate, async (req, res) => {
  const parsed = disableTwoFactorSchema.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest('Invalid request', parsed.error.flatten());

  const actor = requireUser(req);
  await disableTwoFactor(actor.id, parsed.data.code);

  audit(req, { action: 'auth.two-factor.disabled', entity: 'user', entityId: actor.id });

  res.status(200).json({ data: { ok: true } });
});

/**
 * GET /api/v1/auth/me/api-keys
 *
 * Every LIVE key this account has issued. Self-only, no area grant — same
 * reasoning as `/auth/me/sessions`.
 */
authRouter.get('/auth/me/api-keys', authenticate, async (req, res) => {
  const actor = requireUser(req);
  res.status(200).json({ data: await listApiKeys(actor.id) });
});

const createApiKeySchema = z.object({ name: z.string().trim().min(1).max(120) }).strict();

/**
 * POST /api/v1/auth/me/api-keys
 *
 * The key is its OWNER's exact role-based permissions — see `ApiKey`'s
 * schema doc comment for why there is no separate scope to accept here.
 */
authRouter.post('/auth/me/api-keys', authenticate, async (req, res) => {
  const parsed = createApiKeySchema.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest('Invalid request', parsed.error.flatten());

  const actor = requireUser(req);
  const created = await createApiKey(actor.id, parsed.data.name);

  // The key itself is NEVER logged — same rule as a courier access code or
  // reset token.
  audit(req, {
    action: 'auth.api-key.created',
    entity: 'apiKey',
    entityId: created.id,
    changes: { name: created.name },
  });

  res.status(201).json({ data: created });
});

/** DELETE /api/v1/auth/me/api-keys/:id — revoke one key. */
authRouter.delete('/auth/me/api-keys/:id', authenticate, async (req, res) => {
  const actor = requireUser(req);
  const id = String(req.params.id);

  await revokeApiKey(actor.id, id);

  audit(req, { action: 'auth.api-key.revoked', entity: 'apiKey', entityId: id });

  res.status(204).send();
});
