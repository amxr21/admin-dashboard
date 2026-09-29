import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireUser } from '../../middleware/authenticate.js';
import { requireArea } from '../../middleware/authorize.js';
import { AppError } from '../../errors/AppError.js';
import { listDeliveryZones, saveDeliveryZone } from '../../services/delivery-zones.service.js';
import { audit } from '../../services/audit.service.js';

export const deliveryZonesRouter = Router();
const amount = z.string().regex(/^\d{1,7}\.\d{2}$/, 'Enter an amount with two decimal places');
const zoneBody = z
  .object({
    code: z
      .string()
      .trim()
      .min(1)
      .max(48)
      .regex(/^[a-z0-9-]+$/),
    name: z.string().trim().min(1).max(120),
    fee: amount,
    freeDeliveryThreshold: amount.nullable(),
    isActive: z.boolean(),
    sortOrder: z.number().int().min(0).max(9999),
  })
  .strict();

deliveryZonesRouter.get(
  '/settings/delivery-zones',
  authenticate,
  requireArea('settings'),
  async (_req, res) => {
    res.json({ data: await listDeliveryZones() });
  },
);
deliveryZonesRouter.post(
  '/settings/delivery-zones',
  authenticate,
  requireArea('settings'),
  async (req, res) => {
    const input = zoneBody.safeParse(req.body);
    if (!input.success)
      throw AppError.badRequest(input.error.issues[0]?.message ?? 'Check the delivery area');
    const zone = await saveDeliveryZone(input.data);
    audit(req, {
      actor: requireUser(req),
      action: 'delivery_zone.created',
      entity: 'deliveryZone',
      entityId: zone.id,
    });
    res.status(201).json({ data: zone });
  },
);
deliveryZonesRouter.patch(
  '/settings/delivery-zones/:id',
  authenticate,
  requireArea('settings'),
  async (req, res) => {
    const input = zoneBody.safeParse(req.body);
    if (!input.success)
      throw AppError.badRequest(input.error.issues[0]?.message ?? 'Check the delivery area');
    const id = z.string().trim().min(1).max(64).parse(req.params.id);
    const zone = await saveDeliveryZone(input.data, id);
    audit(req, {
      actor: requireUser(req),
      action: 'delivery_zone.updated',
      entity: 'deliveryZone',
      entityId: zone.id,
    });
    res.json({ data: zone });
  },
);
