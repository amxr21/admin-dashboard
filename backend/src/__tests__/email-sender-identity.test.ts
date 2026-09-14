import { describe, expect, it } from 'vitest';

import { buildFrom } from '../services/email.service.js';

/**
 * The sender-identity half of the email settings (`email.senderName`,
 * `email.replyToAddress`).
 *
 * Unit-level on purpose — no database, no SMTP. `buildFrom` is pure string
 * construction, and the case worth pinning is the one that fails SILENTLY:
 * an unquoted display name containing a comma is parsed by RFC 5322 as an
 * address-list separator, so "Nour Coffee, Ltd." would turn one From header
 * into two malformed addresses. Nothing in a send path would raise; the mail
 * would simply stop arriving, which is the hardest kind of break to trace
 * back to a settings field someone typed months earlier.
 */
describe('buildFrom', () => {
  it('sends the bare address when no sender name is set', () => {
    // '' is the declared default and means "no display name", never a
    // literal empty one — an empty pair of quotes is a real difference to
    // some mail servers.
    expect(buildFrom('alerts@nourcoffee.com', '')).toBe('alerts@nourcoffee.com');
  });

  it('pairs a sender name with the address', () => {
    expect(buildFrom('alerts@nourcoffee.com', 'Nour Coffee')).toBe(
      '"Nour Coffee" <alerts@nourcoffee.com>',
    );
  });

  it('quotes a name containing a comma or period so it cannot split the header', () => {
    // The whole reason the name is quoted at all.
    expect(buildFrom('alerts@nourcoffee.com', 'Nour Coffee, Ltd.')).toBe(
      '"Nour Coffee, Ltd." <alerts@nourcoffee.com>',
    );
  });

  it('escapes a quote inside the name rather than ending the quoted string early', () => {
    expect(buildFrom('alerts@nourcoffee.com', 'The "Good" Cup')).toBe(
      '"The \\"Good\\" Cup" <alerts@nourcoffee.com>',
    );
  });

  it('escapes a backslash, which would otherwise escape the closing quote', () => {
    expect(buildFrom('alerts@nourcoffee.com', 'A\\B')).toBe('"A\\\\B" <alerts@nourcoffee.com>');
  });
});
