import { Router } from 'express';

import { AppError } from '../../errors/AppError.js';
import { authenticate, requireUser } from '../../middleware/authenticate.js';
import { requireArea } from '../../middleware/authorize.js';
import { prisma } from '../../db/prisma.js';

/**
 * Bespoke actions on top of the otherwise fully generic `notifications`
 * resource (see `admin.config.ts` — list/delete come free from
 * `/r/notifications`). A notification has exactly two things a person does
 * to it: read it, and dismiss it. There is no "edit" — `update` is `false`
 * in the resource config on purpose, closing the generic engine's edit form
 * that used to let someone toggle `isRead` through a form field, which
 * doesn't describe what's actually happening (reading something, not
 * editing a record).
 *
 * "Mark as read" (one, or all) is a FIELD update outside what the generic
 * engine's bulk action (delete only, see resource.service.ts) can express —
 * same reasoning as `returns`/`staff` staying bespoke where the generic
 * shape doesn't fit, scoped to exactly these two routes rather than growing
 * the engine's vocabulary for one resource.
 *
 * Lives at `/notifications/...`, not under `/r/notifications/...` — a
 * distinct path from every generic resource route (those are all
 * `/r/:resource...`), so there is no ordering hazard with `resourceRouter`;
 * mounted alongside the other named routes purely by convention.
 */

export const notificationsRouter = Router();

notificationsRouter.patch(
  '/notifications/mark-all-read',
  authenticate,
  requireArea('settings'),
  async (req, res) => {
    const actor = requireUser(req);

    const { count } = await prisma.notification.updateMany({
      where: { isRead: false },
      data: { isRead: true },
    });

    req.log.info({ event: 'notifications.mark_all_read', count, userId: actor.id });

    res.json({ data: { updated: count } });
  },
);

/**
 * Marking ONE as read — called when someone opens a notification's detail,
 * not from a separate button. "Reading" a notification and "expanding it to
 * see the rest" are the same action from the user's side of the screen; two
 * controls for one action would just be confusing.
 *
 * Idempotent: reading an already-read notification is a no-op 200, not an
 * error — the caller doesn't need to know or care which state it was in.
 */
notificationsRouter.patch(
  '/notifications/:id/read',
  authenticate,
  requireArea('settings'),
  async (req, res) => {
    const actor = requireUser(req);
    const id = String(req.params.id);

    const existing = await prisma.notification.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw AppError.notFound('Notification not found');

    const notification = await prisma.notification.update({
      where: { id },
      data: { isRead: true },
    });

    req.log.info({ event: 'notifications.mark_read', notificationId: id, userId: actor.id });

    res.json({ data: { notification } });
  },
);
