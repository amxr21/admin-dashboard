import type { CampaignChannel } from '@prisma/client';

/**
 * Turning a campaign's stored content into one customer's message.
 *
 * Placeholders are a closed list, replaced literally — never evaluated — so a
 * campaign body cannot reach anything but these four values. Every value is
 * HTML-escaped before it goes into an email body, including the owner's own
 * text: an email client renders whatever arrives, and a stray `<` in a
 * product name must not become markup.
 */

export const PLACEHOLDERS = ['customer_name', 'store_name', 'branch_name', 'discount_code'] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];

export type CampaignLocale = 'en' | 'ar';

/** Used when a customer has no usable name — "Dear ," helps nobody. */
const NAME_FALLBACK: Record<CampaignLocale, string> = { en: 'there', ar: 'عميلنا العزيز' };

/** Appended to every marketing SMS. Counted in the cost estimate. */
export const SMS_OPT_OUT: Record<CampaignLocale, string> = {
  en: 'Reply STOP to opt out',
  ar: 'أرسل STOP لإلغاء الاشتراك',
};

const EMAIL_FOOTER: Record<CampaignLocale, { reason: string; unsubscribe: string }> = {
  en: {
    reason: 'You are receiving this because you agreed to hear from {store}.',
    unsubscribe: 'Unsubscribe',
  },
  ar: {
    reason: 'تصلك هذه الرسالة لأنك وافقت على تلقي رسائل من {store}.',
    unsubscribe: 'إلغاء الاشتراك',
  },
};

export interface RenderValues {
  customerName: string | null;
  storeName: string;
  branchName: string | null;
  discountCode: string | null;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Replace `{{placeholder}}` tokens; anything else in braces is left as typed. */
export function fillPlaceholders(template: string, values: RenderValues, locale: CampaignLocale): string {
  const name = values.customerName?.trim();
  const map: Record<Placeholder, string> = {
    customer_name: name ? name.split(/\s+/)[0]! : NAME_FALLBACK[locale],
    store_name: values.storeName,
    branch_name: values.branchName ?? values.storeName,
    discount_code: values.discountCode ?? '',
  };

  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (match, key: string) =>
    (PLACEHOLDERS as readonly string[]).includes(key) ? map[key as Placeholder] : match,
  );
}

export interface CampaignContent {
  subjectEn: string | null;
  subjectAr: string | null;
  bodyEn: string | null;
  bodyAr: string | null;
}

/**
 * The language a recipient gets: their own when the campaign has it, else
 * whichever language the campaign was written in. Never an empty message.
 */
export function pickLocale(content: CampaignContent, preferred: CampaignLocale): CampaignLocale {
  const has = (locale: CampaignLocale) => Boolean(locale === 'ar' ? content.bodyAr?.trim() : content.bodyEn?.trim());
  if (has(preferred)) return preferred;
  return preferred === 'ar' ? 'en' : 'ar';
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function renderEmail(
  content: CampaignContent,
  locale: CampaignLocale,
  values: RenderValues,
  unsubscribeUrl: string,
): RenderedEmail {
  const subject = fillPlaceholders((locale === 'ar' ? content.subjectAr : content.subjectEn) ?? '', values, locale);
  const body = fillPlaceholders((locale === 'ar' ? content.bodyAr : content.bodyEn) ?? '', values, locale);
  const footer = EMAIL_FOOTER[locale];
  const reason = footer.reason.replace('{store}', values.storeName);
  const dir = locale === 'ar' ? 'rtl' : 'ltr';

  const paragraphs = body
    .split(/\n{2,}/)
    .map((block) => `<p style="margin:0 0 16px">${escapeHtml(block).replaceAll('\n', '<br>')}</p>`)
    .join('');

  const html = `<!doctype html><html lang="${locale}" dir="${dir}"><body style="margin:0;padding:24px;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:8px;padding:24px;line-height:1.6;font-size:16px;text-align:${locale === 'ar' ? 'right' : 'left'}">${paragraphs}</div>
<p style="max-width:600px;margin:16px auto 0;font-size:12px;color:#6b7280;text-align:center">${escapeHtml(reason)}<br><a href="${escapeHtml(unsubscribeUrl)}" style="color:#6b7280">${footer.unsubscribe}</a></p>
</body></html>`;

  const text = `${body}\n\n--\n${reason}\n${footer.unsubscribe}: ${unsubscribeUrl}`;

  return { subject, html, text };
}

export function renderSms(content: CampaignContent, locale: CampaignLocale, values: RenderValues): string {
  const body = fillPlaceholders((locale === 'ar' ? content.bodyAr : content.bodyEn) ?? '', values, locale).trim();
  return `${body}\n${SMS_OPT_OUT[locale]}`;
}

/** Content checks shared by save-as-ready and send. */
export function contentProblems(channel: CampaignChannel, content: CampaignContent): string[] {
  const problems: string[] = [];
  const hasEn = Boolean(content.bodyEn?.trim());
  const hasAr = Boolean(content.bodyAr?.trim());

  if (!hasEn && !hasAr) problems.push('Write the message in English, Arabic, or both');
  if (channel === 'EMAIL') {
    if (hasEn && !content.subjectEn?.trim()) problems.push('Add an English subject');
    if (hasAr && !content.subjectAr?.trim()) problems.push('Add an Arabic subject');
  }
  return problems;
}
