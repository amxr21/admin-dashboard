# admin-dashboard

Admin dashboard — Next.js (App Router) frontend + Express/MySQL backend, both TypeScript.

```
.
├─ frontend/              Next.js app  → Vercel
├─ backend/               Express API  → Render
├─ tsconfig.strict.json   shared strict TS base (both packages extend it)
└─ FOUNDATIONS.md         how this project is set up and why — read this first
```

## Requirements

- Node 22 (see `.nvmrc`)
- pnpm 11
- MySQL 8+

## First-time setup

```bash
pnpm install

# Env files are never committed and there is no template in the repo.
# Create backend/.env and frontend/.env — see CLAUDE.md for the variables.

pnpm --filter ./backend db:migrate             # create the schema
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

## Conventions

All non-obvious ones are documented in [FOUNDATIONS.md](FOUNDATIONS.md). The short version:

- Every API route lives under `/api/v1/`.
- Never `console.log` — use `req.log` in routes, `logger` elsewhere.
- Every schema change is a committed Prisma migration. Never hand-edit a database.
- `any` is banned; escape the type system with `unknown` + a runtime check.

## License

Proprietary — all rights reserved.
