import { randomBytes } from 'node:crypto';
import {
  CustomerCasePriority,
  CustomerCaseStatus,
  Prisma,
} from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';
import { normalizePhone } from '../lib/phone.js';

const MAX_PAGE_SIZE = 100;

export interface CustomerCaseListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: CustomerCaseStatus;
  priority?: CustomerCasePriority;
  assignedToId?: string;
  branchId?: string;
}

function caseNumber(): string {
  return `CASE-${randomBytes(5).toString('hex').toUpperCase()}`;
}

function whereFor(params: CustomerCaseListParams): Prisma.CustomerCaseWhereInput {
  return {
    ...(params.branchId ? { branchId: params.branchId } : {}),
    ...(params.status ? { status: params.status } : {}),
    ...(params.priority ? { priority: params.priority } : {}),
    ...(params.assignedToId ? { assignedToId: params.assignedToId } : {}),
    ...(params.search ? {
      OR: [
        { caseNumber: { contains: params.search } },
        { title: { contains: params.search } },
        { customer: { name: { contains: params.search } } },
        { customer: { email: { contains: params.search } } },
        { order: { orderNumber: { contains: params.search } } },
      ],
    } : {}),
  };
}

const summarySelect = {
  id: true,
  caseNumber: true,
  title: true,
  status: true,
  priority: true,
  branchId: true,
  updatedAt: true,
  customer: { select: { id: true, name: true, email: true, phone: true } },
  order: { select: { id: true, orderNumber: true, status: true } },
  assignedTo: { select: { id: true, name: true, email: true } },
  _count: { select: { notes: true } },
} satisfies Prisma.CustomerCaseSelect;

export async function listCustomerCases(params: CustomerCaseListParams) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, params.pageSize ?? 20));
  const where = whereFor(params);
  const [cases, total] = await prisma.$transaction([
    prisma.customerCase.findMany({
      where,
      select: summarySelect,
      orderBy: [{ priority: 'desc' }, { updatedAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.customerCase.count({ where }),
  ]);

  return {
    cases: cases.map(({ _count, ...item }) => ({
      ...item,
      updatedAt: item.updatedAt.toISOString(),
      noteCount: _count.notes,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getCustomerCase(id: string, branchId?: string) {
  const item = await prisma.customerCase.findFirst({
    where: { id, ...(branchId ? { branchId } : {}) },
    select: {
      ...summarySelect,
      description: true,
      createdAt: true,
      resolvedAt: true,
      notes: { orderBy: { createdAt: 'asc' }, select: { id: true, body: true, authorId: true, createdAt: true } },
    },
  });
  if (!item) throw AppError.notFound('Customer case not found');

  const authorIds = [...new Set(item.notes.map((note) => note.authorId))];
  const authors = authorIds.length
    ? await prisma.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, name: true, email: true } })
    : [];
  const authorMap = new Map(authors.map((author) => [author.id, author]));
  const { _count, ...rest } = item;
  return {
    ...rest,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    resolvedAt: item.resolvedAt?.toISOString() ?? null,
    noteCount: _count.notes,
    notes: item.notes.map((note) => ({
      ...note,
      createdAt: note.createdAt.toISOString(),
      author: authorMap.get(note.authorId) ?? null,
    })),
  };
}

export interface CreateCustomerCaseInput {
  title: string;
  description?: string;
  priority?: CustomerCasePriority;
  customerId?: string;
  orderId?: string;
  assignedToId?: string;
  branchId?: string;
  actorId: string;
}

async function validateLinks(input: Pick<CreateCustomerCaseInput, 'customerId' | 'orderId' | 'assignedToId' | 'branchId'>) {
  const [customer, order, assignee] = await Promise.all([
    input.customerId ? prisma.customer.findUnique({ where: { id: input.customerId }, select: { id: true } }) : null,
    input.orderId ? prisma.order.findUnique({ where: { id: input.orderId }, select: { id: true, customerId: true, branchId: true } }) : null,
    input.assignedToId ? prisma.user.findFirst({ where: { id: input.assignedToId, isActive: true }, select: { id: true } }) : null,
  ]);
  if (input.customerId && !customer) throw AppError.badRequest('Customer not found', { field: 'customerId' });
  if (input.orderId && !order) throw AppError.badRequest('Order not found', { field: 'orderId' });
  if (input.assignedToId && !assignee) throw AppError.badRequest('Assignee not found', { field: 'assignedToId' });
  if (order && input.customerId && order.customerId && order.customerId !== input.customerId) {
    throw AppError.badRequest('The selected order belongs to a different customer', { field: 'orderId' });
  }
  if (order && input.branchId && order.branchId && order.branchId !== input.branchId) {
    throw AppError.badRequest('The selected order belongs to a different branch', { field: 'orderId' });
  }
  return order;
}

export async function createCustomerCase(input: CreateCustomerCaseInput) {
  const order = await validateLinks(input);
  const created = await prisma.customerCase.create({
    data: {
      caseNumber: caseNumber(),
      title: input.title,
      description: input.description ?? null,
      priority: input.priority ?? CustomerCasePriority.NORMAL,
      customerId: input.customerId ?? order?.customerId ?? null,
      orderId: input.orderId ?? null,
      assignedToId: input.assignedToId ?? null,
      branchId: input.branchId ?? order?.branchId ?? null,
      createdById: input.actorId,
    },
  });
  return getCustomerCase(created.id, input.branchId);
}

export interface UpdateCustomerCaseInput {
  title?: string;
  description?: string | null;
  status?: CustomerCaseStatus;
  priority?: CustomerCasePriority;
  assignedToId?: string | null;
}

export async function updateCustomerCase(id: string, input: UpdateCustomerCaseInput, branchId?: string) {
  const current = await prisma.customerCase.findFirst({ where: { id, ...(branchId ? { branchId } : {}) }, select: { id: true } });
  if (!current) throw AppError.notFound('Customer case not found');
  if (input.assignedToId) await validateLinks({ assignedToId: input.assignedToId });
  await prisma.customerCase.update({
    where: { id },
    data: {
      ...input,
      ...(input.status ? { resolvedAt: input.status === CustomerCaseStatus.RESOLVED || input.status === CustomerCaseStatus.CLOSED ? new Date() : null } : {}),
    },
  });
  return getCustomerCase(id, branchId);
}

export async function addCustomerCaseNote(id: string, body: string, authorId: string, branchId?: string) {
  const current = await prisma.customerCase.findFirst({ where: { id, ...(branchId ? { branchId } : {}) }, select: { id: true } });
  if (!current) throw AppError.notFound('Customer case not found');
  await prisma.customerCaseNote.create({ data: { caseId: id, body, authorId } });
  return getCustomerCase(id, branchId);
}

export async function searchCustomerCaseLinks(query: string, branchId?: string) {
  const normalizedPhone = normalizePhone(query);
  const [customers, orders, assignees] = await Promise.all([
    prisma.customer.findMany({
      where: { OR: [{ name: { contains: query } }, { email: { contains: query } }, { phone: { contains: query } }, ...(normalizedPhone.length >= 2 ? [{ phoneNormalized: { contains: normalizedPhone } }] : [])] },
      select: { id: true, name: true, email: true, phone: true }, take: 10, orderBy: { name: 'asc' },
    }),
    prisma.order.findMany({
      where: { ...(branchId ? { branchId } : {}), orderNumber: { contains: query } },
      select: { id: true, orderNumber: true, customerId: true }, take: 10, orderBy: { placedAt: 'desc' },
    }),
    prisma.user.findMany({
      where: { isActive: true, OR: [{ name: { contains: query } }, { email: { contains: query } }] },
      select: { id: true, name: true, email: true }, take: 10, orderBy: { name: 'asc' },
    }),
  ]);
  return { customers, orders, assignees };
}
