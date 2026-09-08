#!/usr/bin/env sh
#
# Run `next build` on push ONLY when the push can plausibly break it.
#
# ─── WHY THIS CHECK EXISTS AT ALL ────────────────────────────────────
# `next build` is the only thing that catches a `useSearchParams()` (or
# `useParams()`) without a Suspense boundary. Typecheck passes, the whole unit
# suite passes, and the build still fails — jsdom never prerenders, so no test
# can see it. It has cost a round trip twice.
#
# ─── WHY IT IS CONDITIONAL, NOT EVERY PUSH ───────────────────────────
# Building on every push costs 60–90s including doc-only ones. That is enough
# friction to get bypassed with --no-verify, and a check people skip is worse
# than one that runs rarely and honestly.
#
# So: grep what is actually being pushed. No risky hook, no build, exit
# instantly. The residual gap — a page becoming dynamic some other way — is
# rare, and CI still runs the full build on every PR.
#
# ─── WHY IT REFUSES NEXT TO A LIVE DEV SERVER ────────────────────────
# A production build into the same `frontend/.next` as a running `pnpm dev`
# corrupts the cache, and the dev server then throws module-not-found errors
# that read like a code regression but are pure build-cache damage. Refusing
# is better than causing that silently.

set -e

# What this push actually adds, compared to the branch it will merge into.
RANGE="origin/dev...HEAD"

if ! git rev-parse --verify --quiet origin/dev >/dev/null 2>&1; then
  # No origin/dev to compare against (a fresh clone, a detached checkout).
  # Fall back to the last commit rather than skipping: erring toward running
  # the build is the safe direction for a check that exists to catch a break.
  RANGE="HEAD~1..HEAD"
fi

ADDED=$(git diff "$RANGE" -- 'frontend/src' 2>/dev/null | grep -E '^\+[^+].*use(SearchParams|Params)\(' || true)

if [ -z "$ADDED" ]; then
  exit 0
fi

echo "→ useSearchParams/useParams added in this push."
echo "  Running next build — the only check that catches a missing Suspense boundary."

# A completed build leaves a BUILD_ID; a dev server's cache does not. Absent
# .next entirely is fine — the build will create it.
if [ -d frontend/.next ] && [ ! -f frontend/.next/BUILD_ID ]; then
  echo ""
  echo "✗ frontend/.next looks like a LIVE dev server's cache."
  echo "  Building into it corrupts the cache, and the dev server then throws"
  echo "  module-not-found errors that look like a code bug but are not."
  echo ""
  echo "  Stop the dev server, then: rm -rf frontend/.next"
  echo "  Or push with --no-verify and let CI run the build."
  exit 1
fi

pnpm --filter ./frontend exec next build
