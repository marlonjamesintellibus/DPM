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

```bash
pnpm db:reset     # stop pnpm dev first: recreates app/.data/pglite with the 20 Oct snapshot
pnpm db:generate  # after changing src/db/schema.ts: writes a new migration to drizzle/
```

The seed (`src/db/seed/`) is the 20 Oct 2026 snapshot from the use case: Kemar's 5 groups, 3 projects, Forager 2.0's plan and BRAID log, Kemar's 8:58am note as 11 items waiting for review, and Alicia's 9:02 Off track waiting for a reason. With `DATABASE_URL` set, `db:reset` needs `--yes`.

## Atlas

Atlas reads captures through OpenRouter when `OPENROUTER_API_KEY` is set in `.env.local` (copy `.env.example`; the file is ignored by git). The default model is GPT-6.1 Sol; `OPENROUTER_MODEL` picks another. With no key, a recorded Atlas answers Kemar's note and fails anything else. Tests never call the network.

```bash
pnpm atlas:live                 # Kemar's note and 3 injection and privacy messages, through the checks (about $0.05)
pnpm atlas:eval                 # the 33 message evaluation on the default model (about $0.08)
pnpm atlas:eval anthropic/claude-haiku-5.5 openai/gpt-6.1-sol   # compare models; --only id,id runs some cases
```

Evaluation results go to `.data/atlas-eval/`.

## Stack

| Part | What | Where |
|---|---|---|
| App | Next.js 16 App Router, Cache Components on | `src/app` |
| Styling | Tailwind 4 with the DPM / Precision tokens (light and dark) and the D/ text styles as `type-*` utilities | `src/app/globals.css` |
| Font | Geist via `next/font` | `src/app/layout.tsx` |
| Shell | Sidebar, Header, inset panel, page head (Figma L16) | `src/components/shell` |
| Domain | Pure rules, no database or UI: transition engine, status rules, rights, config, the M2 to M16 machines, routing, and the server checks on Atlas output | `src/domain` |
| Database | Drizzle ORM, 23 tables mirroring the domain records. PGlite in `app/.data/pglite` by default; Postgres when `DATABASE_URL` is set | `src/db` |
| Atlas | The extractor interface, OpenRouter client (tool calling), recorded fixture, prompt, reason wording, and the evaluation set | `src/atlas` |
| Commands | The only writers: one transaction each, versioned updates, an audit entry for every move, and `evaluate()` after any change to a project | `src/commands` |
| Queries | Per-viewer reads for the screens (inbox, review, project and BRAID log, chat, audit trail). Privacy is enforced here, not in components (P10) | `src/queries` |
| Migrations | `pnpm db:generate` writes SQL to `drizzle/`; the app applies it on first use | `drizzle.config.ts` |
| Tests | Vitest. Node by default; component tests add `// @vitest-environment jsdom`. `src/test/seeded-db.ts` gives each test its own copy of the seeded database. `src/story.test.ts` runs the whole use case | `vitest.config.mts` |

## Notes for later phases

- **Cache Components is on.** DPM data is per viewer and must be fresh, so pages read it inside `<Suspense>`, not with `use cache`. Route handlers that touch the database call `await connection()` first.
- **Icons are the SVGs exported from Figma** (`public/icons`). Their colours are baked in, so they do not follow dark mode yet.
- `src/app/shell-placeholder.ts` holds Kemar's sidebar from L16 until phase 3 brings queries scoped to the viewer.
