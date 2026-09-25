'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { fetchBranches } from '@/lib/branches-api';
import type { CampaignAudience } from '@/lib/campaigns-api';
import { fetchRows } from '@/lib/resource-api';

const ANY = '__any__';
const MONEY = /^\d{1,8}(\.\d{1,2})?$/;

interface Options {
  branches: ComboboxOption[];
  products: ComboboxOption[];
  categories: ComboboxOption[];
  customers: ComboboxOption[];
}

async function loadOptions(): Promise<Options> {
  const rows = (resource: string, detail?: string) =>
    fetchRows(resource, { pageSize: 200, sort: 'name', dir: 'asc' })
      .then((result) =>
        result.rows.map((row) => ({
          value: String(row.id),
          label: String(row.name ?? row.id),
          ...(detail && typeof row[detail] === 'string' ? { hint: String(row[detail]) } : {}),
        })),
      )
      .catch(() => [] as ComboboxOption[]);

  const [branches, products, categories, customers] = await Promise.all([
    fetchBranches()
      .then((list) => list.map((branch) => ({ value: branch.id, label: branch.name })))
      .catch(() => [] as ComboboxOption[]),
    rows('products', 'sku'),
    rows('categories'),
    rows('customers', 'email'),
  ]);
  return { branches, products, categories, customers };
}

/** Pick several items from a list: a combobox that adds, and removable chips. */
function MultiPicker({
  id,
  label,
  options,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  options: ComboboxOption[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
}) {
  const t = useTranslations('campaigns.audience');
  const byValue = new Map(options.map((option) => [option.value, option.label]));
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Combobox
        id={id}
        options={options.filter((option) => !value.includes(option.value))}
        value={null}
        onValueChange={(picked) => {
          if (picked) onChange([...value, picked]);
        }}
        placeholder={placeholder}
      />
      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {value.map((item) => (
            <li key={item} className="bg-muted flex items-center gap-1 rounded-full py-0.5 ps-2.5 pe-1 text-sm">
              <span>{byValue.get(item) ?? item}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-6"
                aria-label={t('remove', { name: byValue.get(item) ?? item })}
                onClick={() => onChange(value.filter((entry) => entry !== item))}
              >
                <X className="size-3.5" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Money as text: the draft ("12.") stays local while typed, and only a
 * complete amount — or an empty field — reaches the audience.
 */
function MoneyInput({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string | undefined;
  onChange: (next: string | undefined) => void;
}) {
  const [text, setText] = useState(value ?? '');
  useEffect(() => setText(value ?? ''), [value]);
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        inputMode="decimal"
        className="force-ltr"
        value={text}
        onChange={(event) => {
          const next = event.target.value.trim();
          if (!/^\d{0,8}(\.\d{0,2})?$/.test(next)) return;
          setText(next);
          if (next === '') onChange(undefined);
          else if (MONEY.test(next)) onChange(next);
        }}
      />
    </div>
  );
}

interface AudienceBuilderProps {
  value: CampaignAudience;
  onChange: (next: CampaignAudience) => void;
}

/**
 * Who the campaign is for. Every filter narrows the one before it; no filter
 * at all means every customer who can be reached on the channel.
 */
export function CampaignAudienceBuilder({ value, onChange }: AudienceBuilderProps) {
  const t = useTranslations('campaigns.audience');
  const [options, setOptions] = useState<Options | null>(null);

  useEffect(() => {
    void loadOptions().then(setOptions);
  }, []);

  const set = (patch: Partial<CampaignAudience>) => {
    const next: CampaignAudience = { ...value, ...patch };
    // Absent, never empty: the server treats a present-but-empty list as a filter.
    for (const key of Object.keys(next) as (keyof CampaignAudience)[]) {
      const entry = next[key];
      if (entry === undefined || entry === '' || (Array.isArray(entry) && entry.length === 0)) delete next[key];
    }
    onChange(next);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label id="audience-mode-label">{t('mode')}</Label>
        <SegmentedControl
          aria-labelledby="audience-mode-label"
          value={value.mode}
          onChange={(mode) => onChange({ mode: mode as CampaignAudience['mode'] })}
          options={[
            { value: 'filter', label: t('modeFilter') },
            { value: 'manual', label: t('modeManual') },
          ]}
        />
      </div>

      {value.mode === 'manual' ? (
        <MultiPicker
          id="audience-customers"
          label={t('customers')}
          options={options?.customers ?? []}
          value={value.customerIds ?? []}
          onChange={(customerIds) => set({ customerIds })}
          placeholder={t('pickCustomer')}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="audience-branch">{t('branch')}</Label>
            <Select value={value.branchId ?? ANY} onValueChange={(branchId) => set({ branchId: branchId === ANY ? undefined : branchId })}>
              <SelectTrigger id="audience-branch">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>{t('anyBranch')}</SelectItem>
                {options?.branches.map((branch) => (
                  <SelectItem key={branch.value} value={branch.value}>
                    {branch.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="audience-type">{t('customerType')}</Label>
            <Select
              value={value.customerType ?? ANY}
              onValueChange={(type) => set({ customerType: type === ANY ? undefined : (type as 'new' | 'returning') })}
            >
              <SelectTrigger id="audience-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>{t('anyCustomer')}</SelectItem>
                <SelectItem value="new">{t('newCustomers')}</SelectItem>
                <SelectItem value="returning">{t('returningCustomers')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <MultiPicker
            id="audience-products"
            label={t('products')}
            options={options?.products ?? []}
            value={value.productIds ?? []}
            onChange={(productIds) => set({ productIds })}
            placeholder={t('pickProduct')}
          />
          <MultiPicker
            id="audience-categories"
            label={t('categories')}
            options={options?.categories ?? []}
            value={value.categoryIds ?? []}
            onChange={(categoryIds) => set({ categoryIds })}
            placeholder={t('pickCategory')}
          />

          <div className="space-y-2">
            <Label htmlFor="audience-inactive">{t('inactiveDays')}</Label>
            <Input
              id="audience-inactive"
              inputMode="numeric"
              value={value.inactiveDays === undefined ? '' : String(value.inactiveDays)}
              onChange={(event) => {
                const days = Number.parseInt(event.target.value, 10);
                set({ inactiveDays: Number.isFinite(days) && days > 0 ? Math.min(days, 3650) : undefined });
              }}
              placeholder={t('inactivePlaceholder')}
              aria-describedby="audience-inactive-hint"
            />
            <p id="audience-inactive-hint" className="text-muted-foreground text-xs">
              {t('inactiveHint')}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <MoneyInput id="audience-min" label={t('minSpend')} value={value.minSpend} onChange={(minSpend) => set({ minSpend })} />
            <MoneyInput id="audience-max" label={t('maxSpend')} value={value.maxSpend} onChange={(maxSpend) => set({ maxSpend })} />
          </div>
        </div>
      )}
    </div>
  );
}
