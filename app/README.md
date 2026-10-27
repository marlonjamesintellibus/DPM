# DPM app

The Digital Project Manager web app. What it builds and why: `../build-plan.md` and `../use-cases/01-update-to-plan.md`.

## Run

```bash
pnpm install
pnpm dev          # http://localhost:3000
pnpm test         # Vitest, watch mode (pnpm test:run for one pass)
pnpm typecheck
pnpm lint
```

`GET /api/health` opens the database and runs its migrations.

## Stack

| Part | What | Where |
|---|---|---|
| App | Next.js 16 App Router, Cache Components on | `src/app` |
| Styling | Tailwind 4 with the DPM / Precision tokens (light and dark) and the D/ text styles as `type-*` utilities | `src/app/globals.css` |
| Font | Geist via `next/font` | `src/app/layout.tsx` |
| Shell | Sidebar, Header, inset panel, page head (Figma L16) | `src/components/shell` |
| Database | Drizzle ORM. PGlite in `app/.data/pglite` by default; Postgres when `DATABASE_URL` is set | `src/db` |
| Migrations | `pnpm db:generate` writes SQL to `drizzle/`; the app applies it on first use | `drizzle.config.ts` |
| Tests | Vitest. Node by default; component tests add `// @vitest-environment jsdom` | `vitest.config.mts` |

## Notes for later phases

- **Cache Components is on.** DPM data is per viewer and must be fresh, so pages read it inside `<Suspense>`, not with `use cache`. Route handlers that touch the database call `await connection()` first.
- **Icons are the SVGs exported from Figma** (`public/icons`). Their colours are baked in, so they do not follow dark mode yet.
- `src/app/shell-placeholder.ts` holds Kemar's sidebar from L16 until phase 3 brings queries scoped to the viewer.
