/**
 * Parses and matches `security.ipAllowlist` — a comma-separated list of
 * exact IPv4 addresses and/or IPv4 CIDR ranges.
 *
 * ─── IPv4 ONLY, DELIBERATELY ────────────────────────────────────────
 * IPv6 CIDR matching needs 128-bit arithmetic JS has no native integer type
 * for, and this feature ships off by default (empty = disabled) — adding
 * that complexity now, before anyone has asked for IPv6 specifically, would
 * be exactly the kind of code this app avoids writing ahead of a real need.
 * An IPv6 address in the list, or any other unparseable entry, is ignored
 * rather than thrown on: a typo in one entry should not make the WHOLE
 * allowlist fail closed and lock out everyone.
 */

interface ParsedEntry {
  /** Network address as a 32-bit unsigned integer. */
  network: number;
  /** Number of leading bits that must match. 32 for an exact address. */
  prefixLength: number;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;

  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    result = (result << 8) | octet;
  }
  // `<<` operates on signed 32-bit ints in JS; force back to unsigned so
  // 255.255.255.255 doesn't come out negative.
  return result >>> 0;
}

function parseEntry(raw: string): ParsedEntry | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  const [address, prefixRaw] = trimmed.split('/');
  const network = ipv4ToInt(address ?? '');
  if (network === null) return null;

  if (prefixRaw === undefined) return { network, prefixLength: 32 };

  if (!/^\d{1,2}$/.test(prefixRaw)) return null;
  const prefixLength = Number(prefixRaw);
  if (prefixLength < 0 || prefixLength > 32) return null;

  return { network, prefixLength };
}

/** Parses the raw setting value once per check. Cheap enough not to cache — this runs per request, not per byte. */
export function parseAllowlist(raw: string): ParsedEntry[] {
  return raw
    .split(',')
    .map(parseEntry)
    .filter((entry): entry is ParsedEntry => entry !== null);
}

function maskFor(prefixLength: number): number {
  // A /0 mask is all zeros — `-1 << 32` is a no-op in JS (shift amounts wrap
  // mod 32), so it has to be special-cased rather than computed generically.
  return prefixLength === 0 ? 0 : (-1 << (32 - prefixLength)) >>> 0;
}

/**
 * True if `ip` falls inside any entry. An IP that fails to parse (IPv6, a
 * proxy-mangled value, garbage) returns `false` — NOT matching is the safe
 * failure for a request whose address couldn't even be understood.
 */
export function isIpAllowed(ip: string, entries: readonly ParsedEntry[]): boolean {
  const candidate = ipv4ToInt(ip);
  if (candidate === null) return false;

  return entries.some((entry) => {
    const mask = maskFor(entry.prefixLength);
    return (candidate & mask) === (entry.network & mask);
  });
}
