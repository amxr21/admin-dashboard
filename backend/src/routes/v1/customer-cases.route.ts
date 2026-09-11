import { CustomerCasePriority, CustomerCaseStatus } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';

import { AppError } from '../../errors/AppError.js';
import { authenticate, requireUser } from '../../middleware/authenticate.js';
import { requireArea } from '../../middleware/authorize.js';
import { withBranchContext } from '../../middleware/branch-context.js';
import { audit } from '../../services/audit.service.js';
import {
  addCustomerCaseNote,
  createCustomerCase,
  getCustomerCase,
  listCustomerCases,
  searchCustomerCaseLinks,
  updateCustomerCase,
} from '../../services/customer-cases.service.js';

export const customerCasesRouter = Router();
const guard = [authenticate, withBranchContext, requireArea('customers')] as const;

const listQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
  search: z.string().trim().min(1).max(120).optional(),
  status: z.nativeEnum(CustomerCaseStatus).optional(),
  priority: z.nativeEnum(CustomerCasePriority).optional(),
  assignedToId: z.string().trim().min(1).optional(),
});
const nullableId = z.union([z.string().trim().min(1), z.null()]);
const createBody = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).optional(),
  priority: z.nativeEnum(CustomerCasePriority).optional(),
  customerId: z.string().trim().min(1).optional(),
  orderId: z.string().trim().min(1).optional(),
  assignedToId: z.string().trim().min(1).optional(),
}).strict();
const updateBody = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.union([z.string().trim().max(5000), z.null()]).optional(),
  status: z.nativeEnum(CustomerCaseStatus).optional(),
  priority: z.nativeEnum(CustomerCasePriority).optional(),
  assignedToId: nullableId.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one field is required');
const noteBody = z.object({ body: z.string().trim().min(1).max(2000) }).strict();
const linkQuery = z.object({ q: z.string().trim().min(2).max(120) });

customerCasesRouter.get('/customer-cases', ...guard, async (req, res) => {
  const parsed = listQuery.safeParse(req.query);
  if (!parsed.success) throw AppError.badRequest('Invalid query', parsed.error.flatten());
  res.json({ data: await listCustomerCases({ ...parsed.data, branchId: req.branchId ?? undefined }) });
});

customerCasesRouter.get('/customer-cases/link-options', ...guard, async (req, res) => {
  const parsed = linkQuery.safeParse(req.query);
  if (!parsed.success) throw AppError.badRequest('Enter at least two characters', parsed.error.flatten());
  res.json({ data: await searchCustomerCaseLinks(parsed.data.q, req.branchId ?? undefined) });
});

customerCasesRouter.get('/customer-cases/:id', ...guard, async (req, res) => {
  res.json({ data: { case: await getCustomerCase(String(req.params.id), req.branchId ?? undefined) } });
});

customerCasesRouter.post('/customer-cases', ...guard, async (req, res) => {
  const parsed = createBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest('Invalid customer case', parsed.error.flatten());
  const user = requireUser(req);
  const item = await createCustomerCase({ ...parsed.data, branchId: req.branchId ?? undefined, actorId: user.id });
  audit(req, { action: 'customer_case.created', entity: 'customer_case', entityId: item.id, changes: { priority: item.priority, linkedCustomer: Boolean(item.customer), linkedOrder: Boolean(item.order) } });
  res.status(201).json({ data: { case: item } });
});

customerCasesRouter.patch('/customer-cases/:id', ...guard, async (req, res) => {
  const parsed = updateBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest('Invalid customer case update', parsed.error.flatten());
  const item = await updateCustomerCase(String(req.params.id), parsed.data, req.branchId ?? undefined);
  audit(req, { action: 'customer_case.updated', entity: 'customer_case', entityId: item.id, changes: { fields: Object.keys(parsed.data) } });
  res.json({ data: { case: item } });
});

customerCasesRouter.post('/customer-cases/:id/notes', ...guard, async (req, res) => {
  const parsed = noteBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest('Invalid note', parsed.error.flatten());
  const item = await addCustomerCaseNote(String(req.params.id), parsed.data.body, requireUser(req).id, req.branchId ?? undefined);
  res.status(201).json({ data: { case: item } });
});
