import type { Request } from 'express';

import { prisma } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';
import { audit, diff } from './audit.service.js';
import { recordCatalogueVersion } from './product-catalogue-version.service.js';

export const DEFAULT_PRODUCT_LOCALE = 'en' as const;
export const PRODUCT_TRANSLATION_LOCALES = ['ar'] as const;
export type ProductTranslationLocale = (typeof PRODUCT_TRANSLATION_LOCALES)[number];
export type ProductLocale = typeof DEFAULT_PRODUCT_LOCALE | ProductTranslationLocale;

export interface ProductContentInput {
  name?: string | null;
  description?: string | null;
  metaTitle?: string | null;
  metaDescription?: string | null;
}

const contentSelect = {
  name: true,
  description: true,
  metaTitle: true,
  metaDescription: true,
} as const;

function serializeContent(locale: string, content: ProductContentInput) {
  return {
    locale,
    name: content.name ?? null,
    description: content.description ?? null,
    metaTitle: content.metaTitle ?? null,
    metaDescription: content.metaDescription ?? null,
  };
}

function normalized(input: ProductContentInput): Required<ProductContentInput> {
  const clean = (value: string | null | undefined) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  };

  return {
    name: clean(input.name),
    description: clean(input.description),
    metaTitle: clean(input.metaTitle),
    metaDescription: clean(input.metaDescription),
  };
}

export function productLocaleFromHeader(value: string | undefined): ProductLocale {
  const requested = value?.split(',')[0]?.trim().toLowerCase();
  return requested === 'ar' || requested?.startsWith('ar-')
    ? 'ar'
    : DEFAULT_PRODUCT_LOCALE;
}

/** Apply locale copy to any product projection carrying an id. This is used by
 * the resource engine, POS and search so fallback rules have one definition. */
export async function localizeProductRows<T extends Record<string, unknown>>(
  rows: readonly T[],
  locale: ProductLocale,
): Promise<T[]> {
  if (locale === DEFAULT_PRODUCT_LOCALE || rows.length === 0) return [...rows];

  const ids = rows.map((row) => row.id).filter((id): id is string => typeof id === 'string');
  const translations = await prisma.productTranslation.findMany({
    where: { productId: { in: ids }, locale },
    select: { productId: true, ...contentSelect },
  });
  const byProduct = new Map(translations.map((entry) => [entry.productId, entry]));

  return rows.map((row) => {
    const translation = typeof row.id === 'string' ? byProduct.get(row.id) : undefined;
    if (!translation) return row;

    return {
      ...row,
      ...(translation.name !== null ? { name: translation.name } : {}),
      ...(translation.description !== null ? { description: translation.description } : {}),
      ...(translation.metaTitle !== null ? { metaTitle: translation.metaTitle } : {}),
      ...(translation.metaDescription !== null
        ? { metaDescription: translation.metaDescription }
        : {}),
    };
  });
}

export async function findLocalizedProductIds(
  search: string | undefined,
  locale: ProductLocale,
): Promise<string[]> {
  const query = search?.trim();
  if (!query || locale === DEFAULT_PRODUCT_LOCALE) return [];

  const rows = await prisma.productTranslation.findMany({
    where: {
      locale,
      OR: [
        { name: { contains: query } },
        { description: { contains: query } },
        { metaTitle: { contains: query } },
        { metaDescription: { contains: query } },
      ],
    },
    select: { productId: true },
  });
  return rows.map((row) => row.productId);
}

/**
 * Returns editable raw values plus the canonical fallback in one stable
 * contract. Missing translated fields stay null here so the editor can tell
 * "inherited" apart from text somebody explicitly authored.
 */
export async function getProductContent(productId: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      ...contentSelect,
      translations: {
        where: { locale: { in: [...PRODUCT_TRANSLATION_LOCALES] } },
        select: { locale: true, ...contentSelect },
      },
    },
  });
  if (!product) throw AppError.notFound('Product not found');

  const byLocale = new Map(product.translations.map((entry) => [entry.locale, entry]));

  return {
    defaultLocale: DEFAULT_PRODUCT_LOCALE,
    content: [
      serializeContent(DEFAULT_PRODUCT_LOCALE, product),
      ...PRODUCT_TRANSLATION_LOCALES.map((locale) =>
        serializeContent(locale, byLocale.get(locale) ?? {}),
      ),
    ],
  };
}

/** Resolve each field independently, so a partial translation degrades to the
 * canonical English value instead of producing blank catalogue cards. */
export async function getResolvedProductContent(productId: string, locale: string) {
  const contract = await getProductContent(productId);
  const fallback = contract.content[0]!;
  const requested = contract.content.find((entry) => entry.locale === locale);

  return {
    locale: requested ? locale : DEFAULT_PRODUCT_LOCALE,
    name: requested?.name ?? fallback.name,
    description: requested?.description ?? fallback.description,
    metaTitle: requested?.metaTitle ?? fallback.metaTitle,
    metaDescription: requested?.metaDescription ?? fallback.metaDescription,
  };
}

export async function setProductTranslation(
  productId: string,
  locale: ProductTranslationLocale,
  input: ProductContentInput,
  req: Request,
) {
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true } });
  if (!product) throw AppError.notFound('Product not found');

  const next = normalized(input);
  const before = await prisma.productTranslation.findUnique({
    where: { productId_locale: { productId, locale } },
    select: contentSelect,
  });
  const hasContent = Object.values(next).some((value) => value !== null);

  if (!hasContent) {
    if (before) {
      await prisma.productTranslation.delete({
        where: { productId_locale: { productId, locale } },
      });
    }
  } else {
    await prisma.productTranslation.upsert({
      where: { productId_locale: { productId, locale } },
      create: { productId, locale, ...next },
      update: next,
    });
  }

  const changes = diff(before ?? {}, next);
  if (Object.keys(changes).length > 0) {
    audit(req, {
      action: 'product.translation.updated',
      entity: 'products',
      entityId: productId,
      changes: { locale, ...changes },
    });
    await recordCatalogueVersion(productId, 'TRANSLATION', `Updated ${locale} content`, req);
  }

  return getProductContent(productId);
}
