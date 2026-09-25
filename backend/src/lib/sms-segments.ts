/**
 * How many billable segments an SMS takes — what an SMS provider charges by.
 *
 * A message that fits the GSM-7 alphabet carries 160 characters in one
 * segment and 153 per segment once split (7 go to the joining header). One
 * character outside it — any Arabic letter, most emoji — switches the WHOLE
 * message to UCS-2: 70 in one segment, 67 per part. That jump is why an
 * Arabic campaign costs roughly twice an English one of the same length, and
 * why the estimate is computed rather than guessed from the character count.
 */

const GSM_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
/** These cost two GSM-7 characters each (escape + character). */
const GSM_EXTENDED = '^{}\\[~]|€\f';

export interface SmsSegments {
  encoding: 'GSM-7' | 'UCS-2';
  /** Length in the encoding's own units (extended GSM characters count 2). */
  units: number;
  segments: number;
}

export function countSmsSegments(text: string): SmsSegments {
  let units = 0;
  let gsm = true;

  for (const char of text) {
    if (GSM_BASIC.includes(char)) units += 1;
    else if (GSM_EXTENDED.includes(char)) units += 2;
    else {
      gsm = false;
      break;
    }
  }

  if (!gsm) {
    // UCS-2 counts UTF-16 code units, so an emoji outside the BMP costs two.
    units = text.length;
    return { encoding: 'UCS-2', units, segments: units === 0 ? 0 : units <= 70 ? 1 : Math.ceil(units / 67) };
  }

  return { encoding: 'GSM-7', units, segments: units === 0 ? 0 : units <= 160 ? 1 : Math.ceil(units / 153) };
}
