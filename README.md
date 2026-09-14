# admin-dashboard

Admin dashboard — Next.js (App Router) frontend + Express/MySQL backend, both TypeScript.

```
.
├─ frontend/              Next.js app → Coolify
├─ backend/               Express API → Coolify
└─ tsconfig.strict.json   shared strict TS base (both packages extend it)
```

## Requirements

- Node 22 (see `.nvmrc`)
- pnpm 11
- MySQL 8+

## First-time setup

```bash
pnpm install

# Env files are never committed and there is no template in the repo.
# Create backend/.env and frontend/.env with local DB and API settings.

pnpm --filter ./backend db:migrate             # create the schema
pnpm --filter ./backend db:seed                # needs SEED_DEVELOPER_EMAIL/PASSWORD
pnpm dev                                       # FE :3000  ·  BE :4000
```

## Scripts (run from the repo root)

| Script | Does |
|---|---|
| `pnpm dev` | Start frontend + backend together |
| `pnpm build` | Production build of both |
| `pnpm lint` | ESLint across both packages |
| `pnpm typecheck` | `tsc --noEmit` across both packages |
| `pnpm db:migrate` | Apply Prisma migrations (dev) |
| `pnpm db:studio` | Open Prisma Studio |

`db:seed` creates or preserves only the Developer account. Set
`SEED_DEVELOPER_EMAIL` and a new `SEED_DEVELOPER_PASSWORD` (at least 12
characters) in the backend environment before running it. It never creates an
Owner or demo data; invite the customer's Owner through Staff after technical
setup. `demo:seed` is a separate command restricted to a designated demo database.

## Conventions

Backend integration tests require a dedicated local MySQL database named
`test_*` or `*_test`. Set `TEST_DATABASE_URL` in `backend/.env` when the app
uses a different local database. The runner refuses ordinary application
database names and remote hosts before importing the application. Do not run
integration tests against data used by the dashboard.

Key conventions:

- Every API route lives under `/api/v1/`.
- Never `console.log` — use `req.log` in routes, `logger` elsewhere.
- Every schema change is a committed Prisma migration. Never hand-edit a database.
- `any` is banned; escape the type system with `unknown` + a runtime check.

## License

Proprietary — all rights reserved.
