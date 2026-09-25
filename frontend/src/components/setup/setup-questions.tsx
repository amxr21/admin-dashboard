'use client';

import { useTranslations } from 'next-intl';

import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { SetupDraft, SetupValue } from '@/lib/setup-api';

/** VAT a business charges when it says it needs VAT but has no rate yet — the
 *  UAE standard rate. The rate stays editable in the Operations step. */
const STANDARD_VAT_RATE = 5;
const PAYMENT_METHODS = ['cash', 'cardOnDelivery', 'online'] as const;
type Fulfilment = 'pickup' | 'delivery' | 'both';

interface SetupQuestionsProps {
  draft: SetupDraft;
  onChange: (next: SetupDraft) => void;
}

/**
 * Plain-language questions that fill in the feature and default choices for
 * the owner. Every answer is READ BACK from the draft, so going back and
 * forward never loses an answer and the later steps still show — and can
 * override — exactly what each answer set.
 */
export function SetupQuestions({ draft, onChange }: SetupQuestionsProps) {
  const t = useTranslations('setup.questions');

  const setDefaults = (defaults: Record<string, SetupValue>, features: Partial<SetupDraft['features']> = {}) =>
    onChange({ ...draft, features: { ...draft.features, ...features }, defaults: { ...draft.defaults, ...defaults } });

  const taxRate = Number(draft.defaults['store.taxRate'] ?? 0);
  const fulfilment = (draft.defaults['setup.fulfilment'] as Fulfilment | undefined) ?? (draft.features.delivery ? 'both' : 'pickup');
  const payments = String(draft.defaults['setup.paymentMethods'] ?? 'cash').split(',').filter(Boolean);

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">{t('intro')}</p>

      <YesNo
        id="inventory"
        question={t('inventory.question')}
        hint={t('inventory.hint')}
        value={draft.features.inventory}
        onChange={(yes) =>
          // POS and suppliers depend on inventory, so "no" turns them off too —
          // otherwise the dependency rule would switch inventory straight back on.
          setDefaults(
            { 'notifications.lowStockAlerts': yes },
            yes ? { inventory: true } : { inventory: false, pos: false, suppliers: false },
          )
        }
      />

      <Choice
        id="fulfilment"
        question={t('fulfilment.question')}
        value={fulfilment}
        options={(['pickup', 'delivery', 'both'] as const).map((value) => ({ value, label: t(`fulfilment.${value}`) }))}
        onChange={(value) => setDefaults({ 'setup.fulfilment': value }, { delivery: value !== 'pickup' })}
      />

      <YesNo
        id="employees"
        question={t('employees.question')}
        hint={t('employees.hint')}
        value={draft.features.staff}
        onChange={(yes) => setDefaults({}, { staff: yes })}
      />

      <YesNo
        id="vat"
        question={t('vat.question')}
        hint={t('vat.hint', { rate: STANDARD_VAT_RATE })}
        value={taxRate > 0}
        onChange={(yes) => setDefaults({ 'store.taxRate': yes ? (taxRate > 0 ? taxRate : STANDARD_VAT_RATE) : 0 })}
      />

      <YesNo
        id="website"
        question={t('website.question')}
        hint={t('website.hint')}
        value={draft.defaults['setup.sellsOnline'] === true}
        onChange={(yes) => setDefaults({ 'setup.sellsOnline': yes })}
      />

      <fieldset className="bg-card rounded-lg border p-4">
        <legend className="px-1 font-medium">{t('payments.question')}</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {PAYMENT_METHODS.map((method) => (
            <div key={method} className="flex min-h-11 items-center gap-2">
              <Checkbox
                id={`payment-${method}`}
                checked={payments.includes(method)}
                onCheckedChange={(checked) => {
                  const next = checked === true ? [...payments, method] : payments.filter((item) => item !== method);
                  // At least one way to be paid; the last one cannot be unticked.
                  if (next.length === 0) return;
                  setDefaults({ 'setup.paymentMethods': PAYMENT_METHODS.filter((item) => next.includes(item)).join(',') });
                }}
              />
              <Label htmlFor={`payment-${method}`} className="flex min-h-11 flex-1 items-center">
                {t(`payments.${method}`)}
              </Label>
            </div>
          ))}
        </div>
      </fieldset>

      <YesNo
        id="options"
        question={t('options.question')}
        hint={t('options.hint')}
        value={draft.defaults['products.defaultHasVariants'] === true}
        onChange={(yes) => setDefaults({ 'products.defaultHasVariants': yes })}
      />

      <YesNo
        id="campaigns"
        question={t('campaigns.question')}
        hint={t('campaigns.hint')}
        value={draft.defaults['setup.wantsCampaigns'] === true}
        onChange={(yes) => setDefaults({ 'setup.wantsCampaigns': yes })}
      />
    </div>
  );
}

function YesNo({
  id,
  question,
  hint,
  value,
  onChange,
}: {
  id: string;
  question: string;
  hint?: string;
  value: boolean;
  onChange: (yes: boolean) => void;
}) {
  const t = useTranslations('setup.questions');
  return (
    <Choice
      id={id}
      question={question}
      hint={hint}
      value={value ? 'yes' : 'no'}
      options={[
        { value: 'yes', label: t('yes') },
        { value: 'no', label: t('no') },
      ]}
      onChange={(next) => onChange(next === 'yes')}
    />
  );
}

/** A labelled group of toggle buttons; the pressed one is announced. */
function Choice<T extends string>({
  id,
  question,
  hint,
  value,
  options,
  onChange,
}: {
  id: string;
  question: string;
  hint?: string | undefined;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-labelledby={`question-${id}`} aria-describedby={hint ? `question-${id}-hint` : undefined} className="bg-card rounded-lg border p-4">
      <p id={`question-${id}`} className="font-medium">
        {question}
      </p>
      {hint ? (
        <p id={`question-${id}-hint`} className="text-muted-foreground mt-1 text-sm">
          {hint}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              'min-h-11 rounded-md border px-4 text-sm font-medium transition-colors',
              'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
              value === option.value
                ? 'border-primary bg-primary text-primary-foreground'
                : 'bg-background hover:bg-accent',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
