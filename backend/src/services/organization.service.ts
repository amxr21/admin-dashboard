import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';

export const entityTypeSchema = z.enum(['business', 'branch', 'staff']);
export type OrganizationEntity = z.infer<typeof entityTypeSchema>;
export const fieldBodySchema = z.object({
  entityType: entityTypeSchema,
  label: z.string().trim().min(1).max(120),
  type: z.enum(['text', 'number', 'date', 'boolean']),
  required: z.boolean().default(false),
}).strict();
export const fieldUpdateSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  required: z.boolean().optional(),
  isActive: z.boolean().optional(),
}).strict().refine(input => Object.keys(input).length > 0, 'At least one field change is required');
export const profileBodySchema = z.object({
  values: z.record(z.string().max(64), z.union([z.string().max(2000), z.number().finite(), z.boolean(), z.null()])),
  jobTitle: z.string().trim().max(120).nullable().optional(),
  department: z.string().trim().max(120).nullable().optional(),
  managerId: z.string().min(1).max(64).nullable().optional(),
}).strict();

async function assertEntity(tx: Prisma.TransactionClient, entityType: OrganizationEntity, id: string) {
  const record = entityType === 'business'
    ? await tx.business.findUnique({ where: { id }, select: { id: true } })
    : entityType === 'branch'
      ? await tx.branch.findUnique({ where: { id }, select: { id: true } })
      : await tx.user.findUnique({ where: { id }, select: { id: true } });
  if (!record) throw AppError.notFound('Business, branch or staff member not found');
}

export async function getOrganization() {
  const [fields, businesses, branches, staff, profiles] = await Promise.all([
    prisma.organizationField.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.business.findMany({ select: { id: true, name: true, isActive: true }, orderBy: { name: 'asc' } }),
    prisma.branch.findMany({ select: { id: true, name: true, isActive: true, business: { select: { name: true } } }, orderBy: { name: 'asc' } }),
    prisma.user.findMany({ select: { id: true, name: true, email: true, isActive: true }, orderBy: { name: 'asc' } }),
    prisma.organizationProfile.findMany({ where: { entityType: 'staff' }, select: { entityId: true, jobTitle: true, department: true, managerId: true } }),
  ]);
  return {
    fields,
    entities: {
      business: businesses,
      branch: branches.map(branch => ({ id: branch.id, name: `${branch.business.name} — ${branch.name}`, isActive: branch.isActive })),
      staff: staff.map(user => ({ id: user.id, name: user.name || user.email, isActive: user.isActive })),
    },
    staffProfiles: profiles,
  };
}

export async function getOrganizationProfile(entityType: OrganizationEntity, entityId: string) {
  await assertEntity(prisma, entityType, entityId);
  return await prisma.organizationProfile.findUnique({ where: { entityType_entityId: { entityType, entityId } } })
    ?? { entityType, entityId, values: {}, jobTitle: null, department: null, managerId: null };
}

export async function createOrganizationField(input: z.infer<typeof fieldBodySchema>) {
  return prisma.$transaction(async tx => {
    if (await tx.organizationField.count({ where: { entityType: input.entityType } }) >= 50) {
      throw AppError.badRequest('Each profile type can have at most 50 custom fields.');
    }
    if (await tx.organizationField.findFirst({ where: { entityType: input.entityType, label: input.label } })) {
      throw AppError.conflict('A field with this label already exists.');
    }
    return tx.organizationField.create({ data: input });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function updateOrganizationField(id: string, input: z.infer<typeof fieldUpdateSchema>) {
  return prisma.$transaction(async tx => {
    const field = await tx.organizationField.findUnique({ where: { id } });
    if (!field) throw AppError.notFound('Custom field not found');
    if (input.label && await tx.organizationField.findFirst({ where: { entityType: field.entityType, label: input.label, id: { not: id } } })) {
      throw AppError.conflict('A field with this label already exists.');
    }
    return tx.organizationField.update({ where: { id }, data: input });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export function validateProfileValues(
  fields: readonly { id: string; label: string; type: string; required: boolean; isActive: boolean }[],
  values: Record<string, string | number | boolean | null>,
) {
  if (Object.keys(values).length > 50) throw AppError.badRequest('Too many custom field values.');
  const active = fields.filter(field => field.isActive);
  const allowed = new Set(active.map(field => field.id));
  if (Object.keys(values).some(key => !allowed.has(key))) throw AppError.badRequest('Unknown or archived custom field.');
  const result: Record<string, string | number | boolean | null> = {};
  for (const field of active) {
    const value = values[field.id];
    if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
      if (field.required) throw AppError.badRequest(`${field.label} is required.`);
      continue;
    }
    const valid = field.type === 'text' ? typeof value === 'string'
      : field.type === 'number' ? typeof value === 'number' && Number.isFinite(value)
        : field.type === 'boolean' ? typeof value === 'boolean'
          : typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
            && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
    if (!valid) throw AppError.badRequest(`Enter a valid value for ${field.label}.`);
    result[field.id] = typeof value === 'string' ? value.trim() : value;
  }
  return result;
}

export async function saveOrganizationProfile(entityType: OrganizationEntity, entityId: string, input: z.infer<typeof profileBodySchema>) {
  return prisma.$transaction(async tx => {
    await assertEntity(tx, entityType, entityId);
    if (entityType !== 'staff' && (input.jobTitle != null || input.department != null || input.managerId != null)) {
      throw AppError.badRequest('Job titles, departments and reporting managers belong to staff profiles.');
    }
    const fields = await tx.organizationField.findMany({ where: { entityType } });
    const values = validateProfileValues(fields, input.values);
    const existing = await tx.organizationProfile.findUnique({ where: { entityType_entityId: { entityType, entityId } } });
    const managerId = input.managerId === undefined ? existing?.managerId ?? null : input.managerId;
    if (managerId) {
      const manager = await tx.user.findUnique({ where: { id: managerId }, select: { isActive: true } });
      if (!manager?.isActive) throw AppError.badRequest('Choose an active staff member as reporting manager.');
      const seen = new Set([entityId]);
      let current: string | null = managerId;
      while (current) {
        if (seen.has(current)) throw AppError.badRequest('Reporting lines cannot form a cycle.');
        seen.add(current);
        const profile: { managerId: string | null } | null = await tx.organizationProfile.findUnique({
          where: { entityType_entityId: { entityType: 'staff', entityId: current } }, select: { managerId: true },
        });
        current = profile?.managerId ?? null;
      }
    }
    // Archiving a field hides it without erasing its historical values.
    const prior = existing?.values;
    if (prior && typeof prior === 'object' && !Array.isArray(prior)) {
      for (const field of fields.filter(field => !field.isActive)) {
        const value = prior[field.id];
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) values[field.id] = value;
      }
    }
    const jobTitle = input.jobTitle === undefined ? existing?.jobTitle ?? null : input.jobTitle?.trim() || null;
    const department = input.department === undefined ? existing?.department ?? null : input.department?.trim() || null;
    const data = { values, jobTitle, department, managerId };
    return tx.organizationProfile.upsert({
      where: { entityType_entityId: { entityType, entityId } },
      create: { entityType, entityId, ...data }, update: data,
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
