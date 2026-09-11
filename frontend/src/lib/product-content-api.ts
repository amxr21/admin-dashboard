import { apiFetch } from '@/lib/api';

export interface LocalizedProductContent {
  locale: string;
  name: string | null;
  description: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
}

export interface ProductContentContract {
  defaultLocale: string;
  content: LocalizedProductContent[];
}

export type ProductContentInput = Omit<LocalizedProductContent, 'locale'>;

export async function fetchProductContent(productId: string): Promise<ProductContentContract> {
  return apiFetch<ProductContentContract>(`/products/${productId}/content`);
}

export async function saveProductTranslation(
  productId: string,
  locale: 'ar',
  content: ProductContentInput,
): Promise<ProductContentContract> {
  return apiFetch<ProductContentContract>(`/products/${productId}/content/${locale}`, {
    method: 'PUT',
    body: JSON.stringify(content),
  });
}

export interface CatalogueVersionSummary {
  id: string;
  version: number;
  source: 'CREATE' | 'UPDATE' | 'TRANSLATION' | 'RESTORE';
  summary: string;
  actorEmail: string | null;
  actorRole: string | null;
  createdAt: string;
}

export interface CatalogueVersionList {
  versions: CatalogueVersionSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface CatalogueSnapshot {
  name: string;
  sku: string | null;
  description: string | null;
  price: string;
  cost: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  translations: LocalizedProductContent[];
  [key: string]: unknown;
}

export interface CatalogueVersionDetail extends CatalogueVersionSummary {
  productId: string;
  snapshot: CatalogueSnapshot;
  currentUpdatedAt: string;
}

export async function fetchCatalogueVersions(
  productId: string,
  page = 1,
): Promise<CatalogueVersionList> {
  return apiFetch<CatalogueVersionList>(`/products/${productId}/versions?page=${page}`);
}

export async function fetchCatalogueVersion(
  productId: string,
  version: number,
): Promise<CatalogueVersionDetail> {
  return apiFetch<CatalogueVersionDetail>(`/products/${productId}/versions/${version}`);
}

export async function restoreCatalogueVersion(
  productId: string,
  version: number,
  expectedUpdatedAt: string,
): Promise<{ version: number; updatedAt: string }> {
  return apiFetch(`/products/${productId}/versions/${version}/restore`, {
    method: 'POST',
    body: JSON.stringify({ expectedUpdatedAt }),
  });
}
