# DPM build plan

**Scope:** how we build the app, starting with use case 1 (`use-cases/01-update-to-plan.md`). Each later use case adds to the same domain and data model.
**Status:** phases 0 to 5 done (26 Oct 2026): the domain, the database, the commands and queries, Atlas through OpenRouter (GPT-6.1 Sol, Haiku as fallback), D1 to D22 decided and built, and the screens: View as, Kemar's chat, Review my update, the inboxes for Alicia and Andre, and the project with its plan and BRAID log, all running as the viewer on the seeded data. 626 tests and a clean production build. Phase 6 (the Playwright story test and polish) is next; open points are D23 to D30 in the machines doc, sections 11 and 12.
**Decided:** use case 1 first; Next.js, TypeScript, Postgres; Atlas extraction through OpenRouter; DPM stays a standalone app that Atlas builds on (26 Oct).
**Changed 26 Oct 2026:** use case 1 now routes one update to several projects and builds each project's BRAID log, with rights per entry kind and project roles (`meetings/2026-10-26-silver-slipper-plaza-3.md`).

## 1. Principles for the code

These come from the knowledge base and decide how code is split.

| KB rule | What it means in code |
|---|---|
| P6 No AI in the numbers | Statuses and roll-ups live in a pure `domain` module with no UI, no database and no model calls. Atlas only fills in the Extraction records. |
| P5 AI proposes, people decide | Atlas writes Extractions only. Real records change only through one `applyCapture` command, which a person triggers. |
| P7 Same records, many views | Pages read through query functions (for example `getInbox(person)`). Chat, Inbox, Dashboard and Table later call the same queries. |
| P10 Privacy in data | Scope is applied in the query layer from the viewer, never by hiding things in components. A project's queries read only items routed to it and their quotes, never the capture. |
| Two confirmations | Accuracy is confirmed by the speaker in `applyCapture`. Authority is a separate command per BRAID entry (`decideBraidEntry`), checked against the project role when it runs. |
| Rights are data | Who may report and who may decide each BRAID kind is a table (`braid_rights`), seeded with the defaults, not `if` statements. |
| A11 Provenance | Every write goes through a function that also writes an audit entry. No direct table writes from pages. |
| C1, C3 model checks | The checked invariants become unit tests with the same names. |
| Only drawn arrows | Each state column has `version` and is changed only by its machine's `transition()`, which checks the arrow and guard and writes audit in the same transaction. States, events, guards and edge cases: `use-cases/01-update-to-plan-machines.md`. |

## 2. Stack

| Layer | Choice | Why |
|---|---|---|
| App | Next.js 16 (App Router, Cache Components on), TypeScript, server actions | One deploy; server components keep queries on the server. Per-viewer data is read inside `<Suspense>`, never `use cache` |
| Styling | Tailwind with the DPM / Precision tokens as CSS variables, Geist font | Tokens from Figma map one to one (section 6) |
| Database | Postgres through Drizzle ORM. Locally PGlite (Postgres in process, no install) | Same SQL dialect locally and in production |
| Atlas | OpenRouter (OpenAI compatible API), tool calling for structured output; model set by `OPENROUTER_MODEL` | Swap models without code changes |
| Tests | Vitest for domain and commands; Playwright for the end to end story | Domain tests run in milliseconds |
| State machines | Plain TypeScript transition functions first. Revisit XState if C4 and C5 need it | The existing models are plain JS; keep the port simple |

**Open:** does Intellibus already host Postgres and Atlas somewhere we should use (F11, Malik)?

**Atlas and DPM (decided 26 Oct, see `meetings/2026-10-26-silver-slipper-plaza-3.md`, D2).** DPM stays a standalone app: it is the base Atlas builds on. DPM owns projects, project roles, BRAID entries, rules and statuses. Atlas owns streams, meetings and transcripts, and feeds DPM through the Atlas API, only for streams whose owner has authorized it. Until that API contract exists, captures are seeded or typed in DPM behind the same `createCapture` command, so swapping in Atlas later changes the source, not the core.

## 3. Folder layout

```
DPM/
  DPM-knowledge-base.md, build-plan.md, use-cases/, research/, reference/
  app/
    src/
      domain/
        machines/  one transition table per machine (M2 to M16), one transition() per machine
        routing/   candidate projects for a speaker, routing rules (M14)
        status/    calculated status rules and roll-up (M12)
        atlas-checks/  server checks on Atlas output (machines doc, section 4)
        config.ts  every DECIDE default in one place
      db/          Drizzle schema, client (PGlite or Postgres), migrations, seed (B5 snapshot)
      atlas/       Extractor interface, OpenRouter extractor, fixture extractor, prompt, schema
      commands/    the only writers: createCapture, decideExtraction, routeExtraction, applyCapture,
                   decideBraidEntry, resolveBraidEntry, mergeBraidEntries, setStatus, saveReason
      queries/     readers scoped by viewer: getInbox, getReview, getProject, getBraidLog, getTodayChat
      app/         routes and components
    tests/e2e/     Playwright story
```

## 4. Data model (use case 1 slice)

**Built 26 Oct (phase 2):** `app/src/db/schema.ts`, migration `app/drizzle/0001_use_case_1.sql`, 23 tables. Columns mirror the domain records (`app/src/domain`), and every state column is typed with the domain's own state type. Machine-moved rows carry `version`; most rows carry `created_at` and `updated_at`. Ids are text (readable in the seed).

| Table | Key fields | KB |
|---|---|---|
| orgs | name, time_zone | A5.1 |
| people | name, initials, title, org_role (executive, delivery_lead, employee, care_team; null for outside contacts) | A5.1, A7.2 |
| groups, group_members | org_id, name, kind (project, team, personal), owner_id, connected_to_dpm (owner authorized), atlas_group_ref | Meeting D2, M13 |
| projects | group_id (one project per group), name, aliases, customer, owner_id, contract_type, dates; set_override, set_status, reason_given_at, set_by, set_at | A5.3, A4.3, M9 |
| project_memberships | project_id, person_id, state, role (pm, lead, member) | M13 |
| project_contacts | project_id, person_id, tie ("contact on #151"): outside people routing can use | M14 |
| threads | project_id, name, description, position | A5.3 |
| milestones | project_id, thread_id, name, owner_id, state, target_date, forecast_date (null means the target), client_visible | C7, M6 |
| work_items | project_id, thread_id, milestone_id, number (#142), title, owner_id, state, due_date, blocked_note, blocked_links | C6, M5 |
| handovers, handover_steps | from and to person, title, state; each step has its own state, and "k of m" is the steps handed over | C9, M7 |
| leave | person_id, start_date, end_date, state. **No reason column** (A5.2, E17) | C9, M8 |
| braid_entries | project_id, kind, title, state, owner_id, reported_by, round, proposed_on, reminders, decided_by and on, self_approved, resolved_by and on, resolve_proposed_by, new_alert, merged_into, state_before_merge | M15 |
| braid_sources | entry_id (holds it now), origin_entry_id (gives it back on unmerge), person_id, capture_id, extraction_id, span, at | M15, M16, A11 |
| braid_links, braid_answers | relation (related, supersedes, conflicts_with, raised_from); every approve, decline, request and reply, per round | M15 |
| status_reasons, status_reason_links | project_id, text, drafted_by_atlas, edited, saved_by, saved_at, stale_since; links to BRAID entries | A4.3, M9 |
| captures | author_id, channel, kind, text (never edited), duration, message_at, received_at, dedup_key, state, tries, proposals, more_found, reminded, transcript_confidence | C1, M1, M2 |
| extractions | capture_id, ordinal, kind, scope, project_id, routing, draft (jsonb: the server checks' output), state, confidence, value, saw, conflict, withdrawn, touched, applied_at | A9.2, M3, M4 |
| inbox_items | owner_id, cause_key, episode, state, snoozed_until, closed_at. Titles are worked out from the cause when read | A8.2, M10 |
| audit_entries | at, actor_type (person, atlas, rule, system), actor_id, action, machine, subject, from_state, to_state, capture_id, extraction_id, detail | A11 |

Changes from the first draft of this table:
- **No `braid_rights` table yet.** The rights live in `app/src/domain/rights.ts` as data. A table is worth it only when an org can change them.
- **`handover_steps` added.** Kemar's note talks about one step ("the runbook"), and KB B4 counts steps ("2 of 4").
- **Added for routing:** `project_contacts` (Kyle) and `group_members` (groups with no project, such as the Data guild).
- **Inbox items store their cause, not their text.**

Statuses are **not stored**, except the set status. Calculated statuses are computed on read with `calculatePlan` (`app/src/domain/status/rules.ts`) (C14 question 1: start derived, cache later if needed).

## 5. Flows

### 5.1 Capture to proposals

1. `createCapture(author, channel, text)` stores the capture as received. Dedup key = channel message id, or a hash of author + text + minute.
2. The extractor gets the text plus a **candidate list** built from every project Kemar can file into (member, connected to DPM, same org tag): per project, his open work items, milestones, handovers, the people tied to it, and its open BRAID entries; plus his own leave. Projects he cannot file into are not sent to the model at all.
3. The model returns items through one tool call: `kind`, `project_id`, `routing_reason`, `target_id` or `braid_kind`, `match_entry_id`, `field`, `new_value`, `quote` (exact words), `confidence`, `rationale`.
4. Server side checks, never trusted to the model:
   - target id must be in the candidate list, or the proposal is dropped
   - `quote` must be found in the text; its position becomes the span
   - old value is read from the database, not from the model
   - mark: No change if new equals old; Matches approved leave if it equals an approved leave row; otherwise Pre-accepted for High, Needs your OK for Medium or Low
   - routing, BRAID and privacy checks 9 to 14 in the machines doc, section 4 (project is a candidate, target belongs to it, kind allowed for the role, proposals stay proposals, no health or people judgements, routing reason is real)
5. Capture moves to proposed. Kemar's chat shows "Got it. 9 updates for 2 projects; 4 need your OK" (L18e).
6. Built as three transactions around the model call (`beginRead`, the call, then `proposeItems` or `failRead`), so no transaction waits on the network. A failed read waits and retries (2s, 4s) and fails after 3 tries, keeping the text (E18). Machines doc, section 10.

Fixture extractor: returns the 11 items in the use case story for the seeded note, so tests and demos run without a key. Without `OPENROUTER_API_KEY` the app uses it, and it fails any message it has no recording for.

### 5.2 Review and save (L16)

- `decideExtraction(id, accept | edit(value) | reject)`, author only (C1 guard; delegates OPEN). For BRAID items it also takes `reject_match` or `match(entry)`.
- `routeExtraction(id, project | keep_private)`, author only; re-runs checks 9 to 11 for the new project.
- `applyCapture(captureId)`: refuses while any item needs an OK or a project; checks membership of every routed project when it runs; runs in one transaction across projects; skips items already applied (dedup); writes the record change, the BRAID REPORT or ADD_SOURCE, and an audit entry for each; marks the capture applied; then runs `evaluate()` for every project it touched.

### 5.3 Evaluate (rules after every change)

`evaluate(projectId)`:
1. Compute calculated statuses for work items, milestones, threads, project (A10.2).
2. Run the set status machine (M9 in `use-cases/01-update-to-plan-machines.md`): if set status exists and differs from calculated with no reason, ensure one open inbox item "Status set with no reason" for the owner (keyed by cause, so it is never duplicated). If calculated now equals set, or is Done, clear the set status and auto-close the item. If calculated moved while a reason stands, mark the reason stale (policy `when_done` plus `reason_stale`, S1, model checked).
3. Write audit entries for any status change it caused.

### 5.4 BRAID decisions

- `decideBraidEntry(entryId, approve | decline(reason) | request_info(question))`: checks the person's project role against `braid_rights` when it runs; moves the entry (M15); writes audit; tells the reporter; `evaluate()` closes the approval item.
- `resolveBraidEntry`, `mergeBraidEntries`, `unmergeBraidEntries`: same pattern, PM or rights table.
- `evaluate()` also keeps BRAID inbox items (approval, pending decision, new blocker, no decider) one per cause key, and sends reminders on the S18 schedule. It never decides a proposal.

### 5.5 Reason (L6)

- `draftReason(projectId)` asks Atlas for a draft from the BRAID entries on the log and the worst items, labelled "Drafted by Atlas". Fixture draft when no key.
- `saveReason(projectId, text, entryIds)` requires at least one link to an entry on the log (not proposed), stores the reason, runs `evaluate()`, which closes the item.
- "Use At risk instead" clears the set status and runs `evaluate()`.

## 6. Design tokens (from Figma, L16 and L6)

| Token | Value | | Token | Value |
|---|---|---|---|---|
| canvas | #f4f4f5 | | ok | #18794e |
| panel | #ffffff | | warn / warn-soft | #ad5700 / #fff4e5 |
| panel-2 | #f4f4f5 | | bad | #ce2c31 |
| hover | #ededef | | neutral | #a1a1aa |
| line / line-strong | #e7e7ea / #d4d4d8 | | ai | #6e56cf |
| text-1 / 2 / 3 | #111113 / #52525b / #71717a | | accent / accent-soft | #3e63dd / #eef2fe |
| inverse / on-inverse | #111113 / #ffffff | | radius sm / control / full | 6 / 8 / 999 |

Type (Geist): Title 20/26 600 -1, Heading 15/20 600 -0.5, Body 14/20 400 -0.2, Body medium 14/20 500, Label 13/18 500, Caption 13/18 400, Micro 12/16 500. Spacing 4, 6, 8, 12, 16, 20.

Dark mode tokens exist in the file ("DPM / Precision", light and dark) but were not pulled yet.

Components to build first: Sidebar, Header (breadcrumb, time, View as, Ask Atlas), Status dot, Button (primary, secondary), Card panel with head, Inbox row, Extraction card (with project chip, kind label and match line), Highlighted transcript, BRAID entry row.

Designed 26 Oct in Figma (Variation L page, beside the originals): L16b review grouped by project with BRAID cards, L6b Alicia's risk approval, L6c Andre's pending decision, L14b project BRAID log, L18f chat. Phase 5 builds from these.

## 7. Phases

Each phase ends with something that runs and a check that proves it.

| # | Phase | Done when |
|---|---|---|
| 0 | Scaffold: Next.js app, tokens, Geist, PGlite, Drizzle, Vitest, one empty page in the shell | **Done 26 Oct.** Shell measured against L16 (sidebar 240, panel at 240,8 and 1192 wide, radius 12, header 55); `/api/health` opens PGlite and migrates; 5 tests, typecheck and lint pass |
| 1a | Model first: TrackedStatus (`reason_stale`), BraidEntry, Routing, Match, CaptureSave and InboxItem models | **Done 26 Oct.** 57 check rows and 12 replayed stories, all as expected; every planted bug caught |
| 1b | Domain: transition tables for M2 to M16, routing rules, status rules (M12), server checks 1 to 14, rights table, config | **Done 26 Oct.** 387 tests: every arrow and refusal, edge cases by ID, property tests (fast-check) holding the model invariants, and the map stories replayed. Each model's planted bugs were planted in the real code and caught. Kemar's note gives exactly the 11 items |
| 2 | Data: schema, migrations, seed of the 20 Oct snapshot (B4, B5) with Kemar's 5 groups, 3 projects, roles, existing BRAID entries, Kemar's note and Alicia's 9:02 set status | **Done 26 Oct.** `pnpm db:reset` gives Forager 2.0 calculated On track, set Off track, one open inbox item; the blocker with 1 report; Kemar's 11 items (9 changes for 2 projects, 4 need his OK). The seed derives rule outcomes with the domain code, and a test keeps the domain fixture and the seed in step |
| 3 | Commands and queries: capture, decide, route, apply, BRAID decisions, evaluate, set status, save reason, audit; queries scoped by viewer and project | **Done 26 Oct.** `app/src/story.test.ts` runs the whole story through the commands (Kemar's note, Alicia's Off track, the save across two projects, approvals, the reason, the stale reason two days later) and checks every screen's data through the queries, including what Alicia and Andre cannot see. A planted bug in evaluate() is caught |
| 4 | Atlas: extractor interface, fixture, OpenRouter with tool calling, server side checks | **Done 26 Oct.** With a key, Kemar's note gives 11 items in the same 2 projects; 10 are the story's, and the 11th links the feed dependency instead of the pipeline risk (D21 in the machines doc). Three injection messages change nothing outside Kemar's rights. 33 evaluation messages: GPT-6.1 Sol passes 33 (twice), Haiku 32, Sonnet 31. Reasons are reworded by Atlas with a rules fallback. `pnpm atlas:live`, `pnpm atlas:eval` |
| 5 | Screens: View as (L0) for Kemar, Alicia and Andre; Kemar's Today chat (web L18e); Review my update (L16, grouped by project); Alicia's Today inbox (L6) with set vs calculated, risk approval and Your projects; Andre's pending decision; project BRAID view | **Done 26 Oct.** Built from L0, L1, L6b, L6c, L14b, L16b and L18f at 1440 wide, with the icons exported from Figma. Played through in the browser: Kemar reviews and saves his note; Alicia approves the risk with a note and saves her reason; Andre approves the decision; Kemar sees both notices, sends a new update that Atlas reads live, and resolves the blocker. Every change is a Server Action that runs the command as the viewer. Also built here: D17 (add to the log while writing a reason), D18 (Not the same, Pick an entry, Done with no linked change) |
| 6 | Story test and polish: Playwright runs steps 1 to 8 of the use case; empty, stale and error states (P11) | One command runs the story green |

Phases 1 and 2 can run in parallel. Phase 4 can run in parallel with phase 5 once phase 3's interfaces exist.

## 8. Decisions needed before or during build

| # | Question | Default if no answer |
|---|---|---|
| B1 | Existing Postgres or Atlas hosting to reuse? (F11) | Local PGlite now, any Postgres later |
| B2 | OpenRouter model | **Decided 26 Oct:** GPT-6.1 Sol (`openai/gpt-6.1-sol`) by default; `OPENROUTER_MODEL` overrides it. Compared with Claude Sonnet 5.5 and Haiku 5.5 on 33 messages (machines doc, section 10) |
| B3 | Milestone tolerance (F10) | 3 calendar days, in config |
| B4 | Set status expiry (F3) | `when_done` plus `reason_stale` (S1, model checked 26 Oct). Not `on_any_change`: it clears Alicia's status when Kemar saves, so L6 never appears (fails `SetStatusRespected`) |
| B5 | "Applied" vs "Pre-accepted" label on L16 | Keep the design's word, store as pre-accepted |
| B6 | Where the code lives: this folder, or a new repo | **Decided 26 Oct:** `app/` in this folder, git at the root |
| B7 | Privacy sign-off (F12) before real people's data | Seed data only until signed off |
| B8 | Atlas to DPM contract: DPM pulls authorized streams, Atlas pushes captures, or both; who owns it (Malik, Carl) | Atlas pushes captures to one DPM endpoint that calls `createCapture`; DPM checks the stream's authorization on every call |
| B9 | Where project roles are assigned: in Atlas (per the briefing) or in DPM | Atlas owns them; DPM reads them with the group. Seeded until the API exists |
| B10 | BRAID rights not covered in the briefing | S10 to S12 decided 26 Oct (leads approve assumptions and dependencies; 1 decision approver; self-approval with the right). S13 decided 26 Oct (a blocker is resolved by the owner of the blocked work or a PM or Lead; anyone else proposes). S14 to S18 on defaults |

## 9. After use case 1

Likely next, in order, because each reuses this slice:
1. Use case 2: a meeting builds the BRAID log (many speakers, attendees, consolidation per meeting and per project, who confirms accuracy)
2. Check-in and check-out as scheduled prompts (9am and end of day) feeding the same flow
3. Atlas asks one clarifying question (C1 needs_clarification)
4. Cross-stream view: one BRAID log across chosen groups (the "experience" in the briefing)
5. Forager 2.0 Dashboard and Table (L14, L15): new views over the same queries
6. Executive Today (L3, L4): roll-up to areas, limited to the groups the executive can see (meeting D1)
7. Real capture channels: the Atlas messaging app API and voice transcription
