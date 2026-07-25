/**
 * Placeholder home page — replace with the real dashboard.
 *
 * Exists so `pnpm build` and `pnpm dev` work on a fresh clone before any
 * feature code lands.
 */
export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-4 p-8">
      <h1 className="text-2xl font-semibold">admin-dashboard</h1>
      <p className="text-sm opacity-70">
        Foundations are in place. See FOUNDATIONS.md at the repo root for the
        conventions this project expects, then start building.
      </p>
    </main>
  );
}
