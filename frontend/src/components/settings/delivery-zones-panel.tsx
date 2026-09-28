'use client';

import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import {
  fetchDeliveryZones,
  normalizeDeliveryAmount,
  saveDeliveryZone,
  type DeliveryZone,
} from '@/lib/delivery-zones-api';

export function DeliveryZonesPanel() {
  const t = useTranslations('settings.deliveryZones');
  const formatter = useFormatter();
  const locale = useLocale();
  const translateError = useTranslatedApiError();
  const headingId = useId();
  const [zones, setZones] = useState<DeliveryZone[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<DeliveryZone | 'new' | null>(null);
  const [saved, setSaved] = useState(false);
  const load = useCallback(async () => {
    setError(null);
    try {
      setZones(await fetchDeliveryZones());
    } catch (caught) {
      setError(translateError(caught));
    }
  }, [translateError]);
  useEffect(() => {
    void load();
  }, [load]);

  function onSaved(zone: DeliveryZone) {
    setZones((current) =>
      [...(current ?? []).filter((row) => row.id !== zone.id), zone].sort(
        (left, right) =>
          left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, locale),
      ),
    );
    setEditing(null);
    setSaved(true);
  }

  return (
    <section aria-labelledby={headingId} className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 id={headingId} className="flex items-center gap-2 text-lg font-semibold">
            <MapPin className="text-primary size-5 shrink-0" aria-hidden="true" />
            {t('title')}
          </h2>
          <p className="text-muted-foreground max-w-2xl text-sm">{t('description')}</p>
          <p className="text-muted-foreground max-w-2xl text-sm">{t('enableHint')}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={editing !== null || zones === null}
          onClick={() => {
            setEditing('new');
            setSaved(false);
          }}
        >
          {t('add')}
        </Button>
      </div>
      {saved ? (
        <p role="status" className="text-muted-foreground text-sm">
          {t('saved')}
        </p>
      ) : null}
      {error ? (
        <div className="space-y-2 rounded-lg border p-4">
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
          <Button type="button" variant="outline" onClick={() => void load()}>
            {t('retry')}
          </Button>
        </div>
      ) : zones === null ? (
        <Skeleton className="h-24 w-full" />
      ) : zones.length === 0 && editing !== 'new' ? (
        <p className="text-muted-foreground rounded-lg border p-4 text-sm">{t('empty')}</p>
      ) : null}
      {editing ? (
        <DeliveryZoneEditor
          key={editing === 'new' ? 'new' : editing.id}
          zone={editing === 'new' ? null : editing}
          onSaved={onSaved}
          onCancel={() => setEditing(null)}
        />
      ) : null}
      {zones ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {zones.map((zone) => (
            <div key={zone.id} className="bg-card/50 min-w-0 space-y-2 rounded-lg border p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="break-words font-medium">
                    <bdi>{zone.name}</bdi>
                  </h3>
                  <p className="text-muted-foreground text-xs">
                    <bdi dir="ltr">{zone.code}</bdi>
                  </p>
                </div>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {t(zone.isActive ? 'active' : 'inactive')}
                </span>
              </div>
              <dl className="space-y-1 text-sm">
                <div className="flex flex-wrap justify-between gap-2">
                  <dt className="text-muted-foreground">{t('fee')}</dt>
                  <dd className="tabular-nums">{formatter.number(Number(zone.fee), 'currency')}</dd>
                </div>
                <div className="flex flex-wrap justify-between gap-2">
                  <dt className="text-muted-foreground">{t('threshold')}</dt>
                  <dd className="tabular-nums">
                    {zone.freeDeliveryThreshold === null
                      ? t('noThreshold')
                      : formatter.number(Number(zone.freeDeliveryThreshold), 'currency')}
                  </dd>
                </div>
              </dl>
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={editing !== null}
                aria-label={t('editNamed', { name: zone.name })}
                onClick={() => {
                  setEditing(zone);
                  setSaved(false);
                }}
              >
                {t('edit')}
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function DeliveryZoneEditor({
  zone,
  onSaved,
  onCancel,
}: {
  zone: DeliveryZone | null;
  onSaved: (zone: DeliveryZone) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('settings.deliveryZones');
  const translateError = useTranslatedApiError();
  const prefix = useId();
  const [code, setCode] = useState(zone?.code ?? '');
  const [name, setName] = useState(zone?.name ?? '');
  const [fee, setFee] = useState(zone?.fee ?? '0.00');
  const [threshold, setThreshold] = useState(zone?.freeDeliveryThreshold ?? '');
  const [sortOrder, setSortOrder] = useState(String(zone?.sortOrder ?? 0));
  const [isActive, setIsActive] = useState(zone?.isActive ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const normalizedFee = normalizeDeliveryAmount(fee);
    const normalizedThreshold = threshold.trim() ? normalizeDeliveryAmount(threshold) : null;
    if (!normalizedFee || (threshold.trim() && !normalizedThreshold)) {
      setError(t('invalidAmount'));
      return;
    }
    if (!/^[a-z0-9-]{1,48}$/.test(code.trim()) || !name.trim() || name.trim().length > 120) {
      setError(t('invalidIdentity'));
      return;
    }
    if (!/^\d{1,4}$/.test(sortOrder) || Number(sortOrder) > 9999) {
      setError(t('invalidSort'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      onSaved(
        await saveDeliveryZone(
          {
            code: code.trim(),
            name: name.trim(),
            fee: normalizedFee,
            freeDeliveryThreshold: normalizedThreshold,
            isActive,
            sortOrder: Number(sortOrder),
          },
          zone?.id,
        ),
      );
    } catch (caught) {
      setError(translateError(caught));
    } finally {
      setSaving(false);
    }
  }
  const errorId = `${prefix}-error`;
  return (
    <form
      onSubmit={(event) => void submit(event)}
      aria-describedby={error ? errorId : undefined}
      className="bg-card space-y-4 rounded-lg border p-4"
    >
      <h3 className="font-medium">{t(zone ? 'edit' : 'add')}</h3>
      <fieldset disabled={saving} className="grid min-w-0 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${prefix}-name`}>{t('name')}</Label>
          <Input
            id={`${prefix}-name`}
            dir="auto"
            value={name}
            maxLength={120}
            required
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${prefix}-code`}>{t('code')}</Label>
          <Input
            id={`${prefix}-code`}
            dir="ltr"
            value={code}
            maxLength={48}
            required
            aria-describedby={`${prefix}-code-hint`}
            onChange={(event) => setCode(event.target.value)}
          />
          <p id={`${prefix}-code-hint`} className="text-muted-foreground text-xs">
            {t('codeHint')}
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${prefix}-fee`}>{t('fee')}</Label>
          <Input
            id={`${prefix}-fee`}
            dir="ltr"
            inputMode="decimal"
            value={fee}
            required
            onChange={(event) => setFee(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${prefix}-threshold`}>{t('threshold')}</Label>
          <Input
            id={`${prefix}-threshold`}
            dir="ltr"
            inputMode="decimal"
            value={threshold}
            aria-describedby={`${prefix}-threshold-hint`}
            onChange={(event) => setThreshold(event.target.value)}
          />
          <p id={`${prefix}-threshold-hint`} className="text-muted-foreground text-xs">
            {t('thresholdHint')}
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${prefix}-sort`}>{t('sortOrder')}</Label>
          <Input
            id={`${prefix}-sort`}
            dir="ltr"
            inputMode="numeric"
            value={sortOrder}
            required
            onChange={(event) => setSortOrder(event.target.value)}
          />
        </div>
        <div className="flex min-h-11 items-center gap-3">
          <Switch id={`${prefix}-active`} checked={isActive} onCheckedChange={setIsActive} />
          <Label htmlFor={`${prefix}-active`}>{t('active')}</Label>
        </div>
      </fieldset>
      {error ? (
        <p id={errorId} role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={saving} className="min-h-11">
          {t(saving ? 'saving' : 'save')}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={saving}
          onClick={onCancel}
          className="min-h-11"
        >
          {t('cancel')}
        </Button>
      </div>
    </form>
  );
}
