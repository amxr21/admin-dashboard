import { describe, expect, it } from 'vitest';

import { countSmsSegments } from '../lib/sms-segments.js';
import { toE164 } from '../services/campaign-audience.service.js';
import { unsubscribeToken, verifyUnsubscribeToken } from '../services/campaign-channels.js';
import { contentProblems, fillPlaceholders, pickLocale, renderEmail, renderSms } from '../services/campaign-render.js';

const values = { customerName: 'Mariam Ali', storeName: 'Date & Co', branchName: 'Marina', discountCode: 'EID20' };

describe('SMS segments', () => {
  it('fits 160 GSM-7 characters in one segment and splits at 153 after that', () => {
    expect(countSmsSegments('a'.repeat(160))).toMatchObject({ encoding: 'GSM-7', segments: 1 });
    expect(countSmsSegments('a'.repeat(161))).toMatchObject({ encoding: 'GSM-7', segments: 2 });
    expect(countSmsSegments('a'.repeat(306))).toMatchObject({ segments: 2 });
    expect(countSmsSegments('a'.repeat(307))).toMatchObject({ segments: 3 });
  });

  it('counts extended GSM characters twice', () => {
    expect(countSmsSegments('€'.repeat(80))).toMatchObject({ units: 160, segments: 1 });
    expect(countSmsSegments('€'.repeat(81))).toMatchObject({ units: 162, segments: 2 });
  });

  it('switches the whole message to UCS-2 for Arabic: 70, then 67 per part', () => {
    expect(countSmsSegments('م'.repeat(70))).toMatchObject({ encoding: 'UCS-2', segments: 1 });
    expect(countSmsSegments('م'.repeat(71))).toMatchObject({ encoding: 'UCS-2', segments: 2 });
    expect(countSmsSegments(`${'a'.repeat(100)}م`)).toMatchObject({ encoding: 'UCS-2', segments: 2 });
  });
});

describe('placeholders', () => {
  it('fills the four known placeholders and leaves anything else as typed', () => {
    expect(
      fillPlaceholders('Hi {{customer_name}}, {{ store_name }} at {{branch_name}}: {{discount_code}} {{price}}', values, 'en'),
    ).toBe('Hi Mariam, Date & Co at Marina: EID20 {{price}}');
  });

  it('uses a friendly fallback when the customer has no name', () => {
    expect(fillPlaceholders('Hi {{customer_name}}', { ...values, customerName: ' ' }, 'en')).toBe('Hi there');
    expect(fillPlaceholders('مرحبًا {{customer_name}}', { ...values, customerName: null }, 'ar')).toBe('مرحبًا عميلنا العزيز');
  });
});

describe('rendering', () => {
  const content = { subjectEn: 'Eid offer', subjectAr: 'عرض العيد', bodyEn: 'Use {{discount_code}} <b>now</b>', bodyAr: 'استخدم {{discount_code}}' };

  it('escapes the message and adds an unsubscribe footer to email', () => {
    const email = renderEmail(content, 'en', values, 'https://api.example.test/api/v1/unsubscribe?token=x');
    expect(email.subject).toBe('Eid offer');
    expect(email.html).toContain('Use EID20 &lt;b&gt;now&lt;/b&gt;');
    expect(email.html).toContain('Date &amp; Co');
    expect(email.html).toContain('href="https://api.example.test/api/v1/unsubscribe?token=x"');
    expect(email.text).toContain('Unsubscribe: https://api.example.test');
  });

  it('renders Arabic email right-to-left', () => {
    expect(renderEmail(content, 'ar', values, 'u').html).toContain('dir="rtl"');
  });

  it('always ends an SMS with the opt-out line', () => {
    expect(renderSms(content, 'en', values)).toBe('Use EID20 <b>now</b>\nReply STOP to opt out');
  });

  it('falls back to the language the campaign was written in', () => {
    expect(pickLocale({ ...content, bodyAr: null }, 'ar')).toBe('en');
    expect(pickLocale(content, 'ar')).toBe('ar');
  });

  it('requires a message, and a subject for each email language used', () => {
    expect(contentProblems('SMS', { subjectEn: null, subjectAr: null, bodyEn: null, bodyAr: ' ' })).toHaveLength(1);
    expect(contentProblems('EMAIL', { subjectEn: null, subjectAr: null, bodyEn: 'Hi', bodyAr: null })).toEqual(['Add an English subject']);
    expect(contentProblems('EMAIL', content)).toEqual([]);
  });
});

describe('phone numbers for SMS', () => {
  it('turns stored digits into E.164 with the default country code', () => {
    expect(toE164('0501234567', '971')).toBe('+971501234567');
    expect(toE164('501234567', '971')).toBe('+971501234567');
    expect(toE164('971501234567', '971')).toBe('+971501234567');
    expect(toE164('00447700900123', '971')).toBe('+447700900123');
  });

  it('refuses what cannot be a real number rather than guessing', () => {
    expect(toE164('123', '971')).toBeNull();
    expect(toE164(null, '971')).toBeNull();
  });
});

describe('unsubscribe tokens', () => {
  it('verifies its own tokens and rejects tampered ones', () => {
    const token = unsubscribeToken('recipient-1');
    expect(verifyUnsubscribeToken(token)).toBe('recipient-1');
    expect(verifyUnsubscribeToken(token.replace('recipient-1', 'recipient-2'))).toBeNull();
    expect(verifyUnsubscribeToken('recipient-1.forged')).toBeNull();
    expect(verifyUnsubscribeToken('test')).toBeNull();
  });
});
