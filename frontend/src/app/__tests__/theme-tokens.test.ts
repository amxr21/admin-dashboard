import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards the one Tailwind v4 rule this project keeps getting bitten by.
 *
 * ─── THE BUG THIS EXISTS TO PREVENT ──────────────────────────────────
 * `@theme inline` INLINES a token's value into the generated utility. So
 *
 *     @theme inline { --font-sans: var(--font-latin), ui-sans-serif, … }
 *
 * compiled to `.font-sans { font-family: var(--font-latin), … }` — pinned to
 * the Latin variable. Re-pointing `--font-sans` under `html[lang='ar']` then
 * did NOTHING, because the utility no longer read that token. Arabic rendered
 * in Inter with an OS fallback while IBM Plex Sans Arabic downloaded and sat
 * unused.
 *
 * It typechecks, lints, builds, and passes every component test, because the
 * damage is in compiled CSS that none of them read. The only symptom is "the
 * font doesn't look applied", which reads as a font problem rather than a
 * cascade one.
 *
 * THE RULE: with `@theme inline`, re-point the INNER variable, never the theme
 * token. Colours already work this way (`.bg-card` → `var(--card)`, re-pointed
 * by `.dark`); fonts now do too (`.font-sans` → `var(--font-app)`).
 */

// Resolved from cwd (the frontend package) rather than import.meta.url, which
// Vitest's transform does not leave as a file: URL.
const source = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8');

/**
 * Comments are stripped before any structural analysis.
 *
 * They are prose, not structure — and this file's comments legitimately
 * mention `@theme inline` and variable names while explaining the very rule
 * below, so leaving them in makes the parser match documentation instead of
 * code. (That is exactly how the first version of this test failed.)
 */
const css = source.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * The body of the block whose header starts at `from`.
 *
 * Brace-matched rather than "find the next `}`" — these blocks sit at
 * different indentation depths and contain nested at-rules, so any
 * string-search shortcut silently over-reads into the rest of the file.
 */
function blockBody(from: number): string {
  const open = css.indexOf('{', from);
  if (open === -1) return '';

  let depth = 0;

  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }

  return '';
}

/** Custom-property names declared DIRECTLY in a block (not in a nested one). */
function declaredIn(body: string): string[] {
  const withoutNested = body.replace(/\{[^{}]*\}/g, '');
  return [...withoutNested.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1] ?? '');
}

/** Token names declared inside the `@theme inline` block. */
function themeTokens(): string[] {
  const start = css.indexOf('@theme inline');
  expect(start).toBeGreaterThan(-1);
  return declaredIn(blockBody(start));
}

/** Variables re-pointed under a selector other than `:root`. */
function repointedUnderSelector(): string[] {
  const names: string[] = [];

  for (const selector of [/html\[lang='ar'\]\s*\{/, /^\s*\.dark\s*\{/m]) {
    const match = selector.exec(css);
    if (!match) continue;

    names.push(...declaredIn(blockBody(match.index)));
  }

  return names;
}

describe('@theme inline tokens are never re-pointed under a selector', () => {
  it('has a theme block to check', () => {
    expect(themeTokens().length).toBeGreaterThan(10);
  });

  it('re-points only inner variables, never theme tokens', () => {
    const tokens = new Set(themeTokens());
    const offenders = repointedUnderSelector().filter((name) => tokens.has(name));

    // A name in both lists is the exact shape of the font bug: the override
    // looks right, reads right, and silently does nothing.
    expect(offenders).toEqual([]);
  });
});

describe('the font swap actually reaches the utility', () => {
  it('points --font-sans at an indirection variable, not a literal stack', () => {
    const declaration = /--font-sans:\s*var\((--[\w-]+)\)\s*;/.exec(css);

    expect(declaration).not.toBeNull();
    // A literal stack here (`--font-sans: var(--font-latin), ui-sans-serif…`)
    // is what broke it: the comma list gets inlined and pins the utility.
    expect(declaration?.[1]).toBe('--font-app');
  });

  it('swaps the Arabic stack on that same variable', () => {
    const arabicBlock = css.slice(css.search(/html\[lang='ar'\]\s*\{/));

    expect(arabicBlock).toMatch(/--font-app:\s*var\(--font-arabic\)/);
    // Latin stays in the stack after it, so SKUs, emails and order numbers
    // inside Arabic text keep Inter rather than IBM Plex's Latin cut.
    expect(arabicBlock).toMatch(/--font-app:[^;]*var\(--font-latin\)/);
  });
});
