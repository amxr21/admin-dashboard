import jwt from 'jsonwebtoken';

import { env } from '../config/env.js';
import { AppError } from '../errors/AppError.js';

/**
 * Courier session tokens — a SEPARATE auth surface from staff (see
 * `auth.service.ts`), signed with the same secret but a distinct payload
 * shape (`kind: 'courier'`, no `role`) so a token minted for one surface can
 * never be replayed against the other. A courier is not a `User` row and
 * carries no `StaffRole` — accepting a courier token in `authenticate`
 * (staff) or a staff token in `authenticateCourier` would each be a
 * privilege-boundary bug, not a feature.
 */

export interface CourierTokenPayload {
  sub: string;
  kind: 'courier';
}

/**
 * A shift-length session, not a staff-length one. A courier signs in on a
 * shared/handheld device far more often than a staff member signs into a
 * desktop — short expiry limits how long a lost or handed-back device stays
 * a live credential.
 */
const COURIER_TOKEN_EXPIRES_IN = '12h';

export function signCourierToken(courierId: string): string {
  return jwt.sign(
    { sub: courierId, kind: 'courier' } satisfies CourierTokenPayload,
    env.JWT_SECRET,
    { expiresIn: COURIER_TOKEN_EXPIRES_IN },
  );
}

/**
 * Same "every failure looks identical" rule as `verifyToken` in
 * auth.service.ts — expired, forged, or a staff token presented here all
 * throw the same message.
 */
export function verifyCourierToken(token: string): CourierTokenPayload {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);

    if (
      typeof decoded === 'string' ||
      decoded.kind !== 'courier' ||
      typeof decoded.sub !== 'string'
    ) {
      throw AppError.unauthorized('Invalid or expired session');
    }

    return { sub: decoded.sub, kind: 'courier' };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw AppError.unauthorized('Invalid or expired session');
  }
}
