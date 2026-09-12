import { useTranslations } from 'next-intl';

import type { FieldConfig } from '@/lib/resource-api';

/** Localize schema-driven labels without changing the API field names. */
export function useResourceFieldLabel(resource: string) {
  const t = useTranslations('resource');

  return (field: FieldConfig): string => {
    const override = `fieldLabelOverrides.${resource}.${field.name}`;
    if (t.has(override)) return t(override);
    const shared = `fieldLabels.${field.name}`;
    return t.has(shared) ? t(shared) : field.label;
  };
}
