# DPM app

The Digital Project Manager web app. What it builds and why: `../build-plan.md` and `../use-cases/01-update-to-plan.md`.

## Run

```bash
pnpm install
pnpm dev          # http://localhost:3000
pnpm test         # Vitest, watch mode (pnpm test:run for one pass)
pnpm typecheck
pnpm lint
pnpm e2e          # the use case 1 story in Chrome: builds, starts on port 3100 with its own fresh database, plays steps 1 to 8
```

`pnpm e2e` uses the installed Google Chrome. Without it, run `npx playwright install chromium` and set `E2E_BROWSER=chromium`. While writing tests, `E2E_BASE_URL=http://localhost:3000 pnpm e2e` runs them against a server you started on a fresh `pnpm db:reset`.

`GET /api/health` opens the database and runs its migrations.

```bash
pnpm db:reset     # stop pnpm dev first: recreates app/.data/pglite with the 20 Oct snapshot
pnpm db:generate  # after changing src/db/schema.ts: writes a new migration to drizzle/
```

The seed (`src/db/seed/`) is the 20 Oct 2026 snapshot from the use case: Kemar's 5 groups, 3 projects, Forager 2.0's plan and BRAID log, Kemar's 8:58am note as 11 items waiting for review, and Alicia's 9:02 Off track waiting for a reason. With `DATABASE_URL` set, `db:reset` needs `--yes`.

## Screens

| Route | What | Figma |
|---|---|---|
| `/` | Today: a chat for someone who reports into a project, an inbox for a PM or Lead; `?view=chat` or `?view=inbox` switches | L1, L18f, L6b, L6c |
| `/review/[captureId]` | Review my update: what you said, what Atlas will change per project, and who sees what | L16b |
| `/projects`, `/projects/[projectId]` | The projects you can see. A project's Dashboard: the plan, the BRAID summary by kind and the milestones. `?view=table`: the BRAID log as a table, where a PM or Lead changes an entry's kind and a member asks for it (machines doc, section 13) | L14, L14c, L14d |

The header's View as menu (L0) switches between Kemar, Alicia and Andre; everything then runs as that person. The demo clock starts at 9:10am on Tue 20 Oct 2026 and moves in real time (`DPM_CLOCK=real` for the real time). Run `pnpm db:reset` to start the story again.

## Atlas

Atlas reads captures through OpenRouter when `OPENROUTER_API_KEY` is set in `.env.local` (copy `.env.example`; the file is ignored by git). The default model is GPT-6.1 Sol; a read's last try and the reason wording use Claude Haiku. `OPENROUTER_MODEL`, `OPENROUTER_FALLBACK_MODEL` and `OPENROUTER_DRAFT_MODEL` pick others. With no key, a recorded Atlas answers Kemar's note and fails anything else. Tests never call the network.

```bash
pnpm atlas:live                 # Kemar's note and 3 injection and privacy messages, through the checks (about $0.05)
pnpm atlas:eval                 # the 43 message evaluation on the default model (about $0.27)
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
| Screens | Server Components read the per-viewer queries inside `<Suspense>`; every change is a Server Action in `src/app/actions.ts` that runs a command as the viewer | `src/app`, `src/components` |
| Commands | The only writers: one transaction each, versioned updates, an audit entry for every move, and `evaluate()` after any change to a project | `src/commands` |
| Queries | Per-viewer reads for the screens (inbox, review, project and BRAID log, chat, audit trail). Privacy is enforced here, not in components (P10) | `src/queries` |
| Migrations | `pnpm db:generate` writes SQL to `drizzle/`; the app applies it on first use | `drizzle.config.ts` |
| Tests | Vitest. Node by default; component tests add `// @vitest-environment jsdom`. `src/test/seeded-db.ts` gives each test its own copy of the seeded database. `src/story.test.ts` runs the whole use case through the commands; `e2e/story.spec.ts` (Playwright) runs it through the screens | `vitest.config.mts`, `playwright.config.ts` |

## Settings

| Variable | What it does |
|---|---|
| `DATABASE_URL` | Postgres instead of PGlite |
| `DPM_DATA_DIR` | Where PGlite lives (default `.data/pglite`); the story test uses `.data/e2e` |
| `OPENROUTER_API_KEY` | Atlas reads through OpenRouter; without it, the recorded fixture |
| `DPM_ATLAS=fixture` | The fixture even when a key is set (the story test) |
| `DPM_CLOCK=real` | The real time instead of the demo clock (9:10am on 20 Oct 2026, moving from server start) |
| `DPM_TIMERS=off` | Stops the rules' timers (`src/timers.ts`), which otherwise run every minute: stale reads are read again, reviews are reminded and expire, milestones are missed, proposals and kind change requests are reminded |

## Notes for later phases

- **Cache Components is on.** DPM data is per viewer and must be fresh, so pages read it inside `<Suspense>`, not with `use cache`. Route handlers that touch the database call `await connection()` first.
- **Icons are the SVGs exported from Figma** (`public/icons`), drawn as CSS masks in `currentColor` by `Icon`. Each icon's default colour is the token its Figma colour maps to; pass `tone` to change it. New icons need an entry in the `ICONS` map in `src/components/shell/icon.tsx`.
- **Theme.** The account menu (`account-menu.tsx`) sets `data-theme` on `<html>` and keeps the choice in `localStorage` (`dpm-theme`). A script in the root layout applies it before the first paint. With no choice, the theme follows the computer.
