'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { Input } from '@/components/ui/input';
import {
  callingCodeFor,
  exampleFor,
  formatAsYouType,
  isValidPhone,
  toE164,
} from '@/lib/phone-format';

/**
 * One phone input for the whole app (URG-020/022).
 *
 * Built once rather than patched into each of the five call sites (staff,
 * invite, branch, business, supplier) because inconsistent phone handling is
 * exactly what the ticket objects to — a number accepted in one form and
 * rejected in another is worse than neither validating.
 *
 * ─── WHAT IT STORES ──────────────────────────────────────────────────
 * E.164 (`+971501234567`) on blur, when the number is valid for the country.
 * When it is not valid, the raw text is kept and an error is shown: storing a
 * malformed value that LOOKS canonical is worse than storing what was typed.
 *
 * ─── WHY FORMATTING HAPPENS ON CHANGE BUT NORMALIZING ON BLUR ────────
 * `AsYouType` gives readable grouping while typing. Rewriting the value to
 * E.164 on every keystroke fights the caret and makes backspacing erratic, so
 * the canonical form is applied once, when the field is done.
 *
 * ─── RTL ─────────────────────────────────────────────────────────────
 * `force-ltr` because a phone number is a technical identifier: it reads
 * left-to-right even in Arabic, the same rule the Combobox hints follow.
 */

interface PhoneFieldProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** ISO 3166-1 alpha-2 driving validation and the example placeholder. */
  country?: string | null;
  disabled?: boolean;
  maxLength?: number;
  'aria-describedby'?: string;
}

export function PhoneField({
  id,
  value,
  onChange,
  country,
  disabled,
  maxLength = 40,
  ...rest
}: PhoneFieldProps) {
  const tCommon = useTranslations('common');
  const [error, setError] = useState<string | null>(null);

  const errorId = `${id}-phone-error`;
  // An explicit example beats a generic one: the shape of a valid number is
  // country-specific, so showing the selected country's own prefix is the
  // honest hint. Falls back to the shared example when no country is chosen.
  const placeholder = exampleFor(country) ?? tCommon('placeholders.phone');

  function handleBlur() {
    const raw = value.trim();
    if (!raw) {
      setError(null);
      return;
    }

    if (!isValidPhone(raw, country)) {
      setError(country ? tCommon('phoneInvalid') : tCommon('phoneInvalidNoCountry'));
      return;
    }

    setError(null);
    // Valid — store the canonical form. `toE164` cannot return null here,
    // since `isValidPhone` just succeeded on the same input.
    const canonical = toE164(raw, country);
    if (canonical && canonical !== value) onChange(canonical);
  }

  return (
    <>
      <Input
        id={id}
        type="tel"
        inputMode="tel"
        className="force-ltr"
        placeholder={placeholder}
        value={value}
        maxLength={maxLength}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={
          [error ? errorId : null, rest['aria-describedby'] ?? null].filter(Boolean).join(' ') ||
          undefined
        }
        onChange={(event) => {
          // Formatting only — never normalize mid-typing.
          onChange(formatAsYouType(event.target.value, country));
          if (error) setError(null);
        }}
        onBlur={handleBlur}
      />
      {error ? (
        <p id={errorId} role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      {!error && country && callingCodeFor(country) ? (
        <p className="text-muted-foreground text-xs">
          <span className="force-ltr">{callingCodeFor(country)}</span>
        </p>
      ) : null}
    </>
  );
}
