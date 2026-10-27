# DPM Knowledge Base

**What this is:** an abstraction of the Digital Project Manager (DPM) design work, written for an AI agent (and people) to answer questions, test new use cases and start state machine research from.
**Built from:** Figma file "Digital Project Manager", mainly Variation L (current) and Variation G (the first full system), with lessons from H, I, J and K.
**Owner:** Marlon James (design). Product owner: Ed Watal.
**Status:** design exploration. Every name, number and client in the designs is a placeholder (Part B). Open items are marked **OPEN**.
**Last updated:** 24 Oct 2026. Open questions F13 to F21 added 26 Oct 2026 from a briefing (`meetings/2026-10-26-silver-slipper-plaza-3.md`); the body of Parts A to C is not yet revised for them.

---

## How an agent should use this document

1. **Separate the model from the instance.** Part A is the general model (true for any organisation). Part B is how Intellibus fills it in. When asked "could this work for X?", answer from Part A and build a new Part B style mapping for X.
2. **Do not invent numbers or facts.** If something is not here, say so and mark it as an assumption or an open question.
3. **Cite sections** (for example "A4.2" or "C3") so answers can be checked.
4. **Respect the rules in A4 and A7** (status language, roll-up, visibility). They are the parts most likely to be broken by a quick answer.
5. **For state machine work, start from Part C.** It lists the lifecycles, events, guards and timers seen in the designs, plus what is still undecided.
6. **Writing style for anything produced from this:** plain words, no em dashes, numbers before labels, one type family (Geist) in any visual work.

## Contents

- **Part A. The general model**
  - A1 What the product is
  - A2 Principles
  - A3 Core loop
  - A4 Status, roll-up and reasons
  - A5 Primitives (the abstract entities)
  - A6 Areas: the questions an organisation asks every day
  - A7 Roles, lenses and visibility
  - A8 Views: Chat, Inbox, Dashboard, Table
  - A9 Atlas: the conversational agent
  - A10 Checks, rules and signals
  - A11 Provenance and trust
- **Part B. The Intellibus instance**
- **Part C. Lifecycles and state machines (research seed)**
- **Part D. Design reference (Figma)**
- **Part E. Use cases beyond Intellibus**
- **Part F. Open questions and decisions**
- **Part G. Glossary**

---

# Part A. The general model

## A1. What the product is

A project and operations manager that people mostly talk to. A person talks or types to an AI agent (Atlas). Atlas turns what they say into structured records, asks one question when something is unclear, and waits for the person to confirm. The same records are then shown in four views (Chat, Inbox, Dashboard, Table). Each person sees only what their role allows and, by default, only what needs their action.

It covers five things an organisation manages:

| Domain | Generic question | Typical records |
|---|---|---|
| People | Are our people okay, and can they do the work? | Person, check-in, leave, care request, skill, assessment |
| Projects (delivery) | Is the work on track, with cover? | Project, plan, milestone, work item, risk log entry |
| Customers and contracts | Did we win work we can deliver, and are customers okay? | Customer, ask, contract, commitment, invoice, health signal |
| Internal operations | Is anything threatening our ability to operate? | Incident, alert, staffing seat, facility, timesheet |
| Growth | Are we moving toward the long-term goal? | Goal metric, funnel step, event, meeting |

It is still a project management tool: plans, milestones, issues, owners, dates and risks are first class. What changes is how data gets in (conversation, not forms) and how it gets out (status with reasons, ordered by what needs attention).

## A2. Principles

These came out of the design reviews (21 Oct call with Ed, and the Anubis call on the grid). They should hold for any instance.

| # | Principle | What it means in the model |
|---|---|---|
| P1 | Continuity before improvement | Areas that keep the organisation running roll up into one status. Improvement goals are reported beside it, never rolled in, so a long-term goal can never hide a problem today. |
| P2 | If I have no action to take, I should not see it | Each role's Today is an inbox of their own next things. Everything else lives in its page. |
| P3 | Talk, don't fill forms | Input is conversation. Edits are confirmations of what Atlas parsed. |
| P4 | Show where it came from | Every record and every inbox item carries its source and time. Atlas output shows the words it came from. |
| P5 | AI proposes, people decide | Atlas drafts, suggests and extracts. A person approves before anything changes or is sent. Every approval is logged. |
| P6 | No AI in the numbers | Statuses, counts and roll-ups come from rules. AI may explain them, never compute them. |
| P7 | Same records, many views | Chat, Inbox, Dashboard and Table are projections of the same query. Switching views never changes the data. |
| P8 | Status means something | Only things with a target get a status. Five statuses only. Categories are never coloured like statuses. |
| P9 | A disagreement needs a reason | When a person sets a status that disagrees with the calculated one, they must give a reason, and the reason is linked to the risk log. |
| P10 | Privacy is enforced in data, not in the UI | Some facts are counts only for some roles. Leaders get aggregate queries, not lists with names hidden. |
| P11 | Information sticks | Never hide a section because data is missing. Show partial ("42 of 50"), stale ("as of 9:10am") or "not enough answers to show". |
| P12 | Every number drills down | Counts, chips and segments open the filtered records behind them. |

## A3. Core loop

```
Capture  ->  Extract  ->  Confirm  ->  Record  ->  Evaluate  ->  Present  ->  Act
(talk)      (Atlas)      (person)     (store)     (rules)       (4 views)    (approve, assign, reply)
   ^                                                                              |
   +------------------------------------------------------------------------------+
```

1. **Capture.** A message, voice note, meeting transcript, email or system event arrives. Channels: the Atlas messaging app (text and voice notes), app chat, phone, integrations (GitHub, calendar, CRM, accounting, HR, monitoring).
2. **Extract.** Atlas proposes record changes. Each proposal has: target record, field, old value, new value, source span (the exact words), confidence (High, Medium, Low).
3. **Confirm.** The person accepts, edits or rejects each proposal. High confidence changes that match existing facts can be pre-accepted but still shown. Medium or Low wait for the person. If one field is unclear, Atlas asks one question.
4. **Record.** Accepted changes are stored with provenance (A11).
5. **Evaluate.** Rules run on every change: statuses, roll-ups, checks (A10), inbox items for whoever must act.
6. **Present.** Each person sees the result in their chosen view, scoped to their role.
7. **Act.** Approve, decline, assign, reply, accept a slip, add a reason. Actions are themselves captured, and the loop continues.

## A4. Status, roll-up and reasons

### A4.1 The five statuses

| Status | Tone | Meaning |
|---|---|---|
| Not started | Neutral | Has a target, work has not begun |
| On track | Ok (green) | Expected to meet its target |
| At risk | Warn (amber) | May miss its target without action |
| Off track | Bad (red) | Will miss its target, or already has, without a change |
| Done | Neutral | Target met or closed |

Rules:
- **Only things with a target get a status.** A person, a location or a category does not.
- **Counts are plain numbers.** "3 of 5 seats staffed" is a fact; its status belongs to the thing with the target (the contract).
- **Categories are neutral.** Risk, Assumption, Issue and Dependency are labels, never coloured dots.
- Steps in a sequence use check marks, not status dots.
- Other words in the designs ("Open", "Mitigating", "Holding", "Resolved", "Blocked", "In progress") are **states of a lifecycle** (Part C), not statuses. Keep the two vocabularies apart.

### A4.2 Roll-up

- A parent shows its **worst child**. Order: Off track > At risk > On track > Not started > Done.
- The organisation's overall status is the worst of its continuity areas, always shown **with the reason in words**: "Off track because Operations is: NEPA support is 2 people short."
- Improvement areas (Growth, North Star) are reported beside and never roll in.
- Roll-up is calculated, never typed.

### A4.3 Set vs calculated

Every tracked item can have two statuses:
- **Calculated:** from rules, children and dates (for example forecast 24 Oct vs target 23 Oct gives At risk).
- **Set:** by the owner (for example the lead marks it Off track after a standup).

If they match, show one. If they differ:
1. Show both ("Set by you, 9:02am: Off track" and "Calculated from the plan: At risk").
2. Create an inbox item for the owner: "Status set with no reason".
3. Require a reason. Atlas can draft one from the risk log.
4. The reason is stored and linked to one or more risk log entries. The set status then wins for display, and the link explains it everywhere (dashboard, briefing, client view, table).

**OPEN:** does a set status expire (for example after 7 days, or when the calculated status changes)?

### A4.4 Worst first

Every list of tracked things is sorted worst first by default. Ties break by due date, then by how long the item has been in that status.

## A5. Primitives (the abstract entities)

These are domain-agnostic. Part B shows the Intellibus names.

Every record also has: `id`, `org_id`, `created_at`, `updated_at`, and provenance (A11).

### A5.1 Actors and structure

| Primitive | Description | Key fields |
|---|---|---|
| **Org** | The organisation using the tool | name, timezone, working days, holidays, currency, area config |
| **Person** | Anyone the org tracks; not all have logins | name, type (employee, intern, contractor, community, external contact), roles, reports_to, home location, usual pattern, joined |
| **Role assignment** | A lens a person may use (A7) | person, role, scope (all, team, project, customer) |
| **Team** | A group of people | name, lead, members |
| **Location** | Where people work | name, kind (office, campus, remote, site) |
| **Agent** | Atlas, acting on behalf of a person | model, permissions = the asking person's |

### A5.2 People and wellbeing

| Primitive | Description |
|---|---|
| **Check-in** | A person's daily "where, when, what I plan, how I am". Partly private. |
| **Presence day** (derived) | in, remote, out, not heard |
| **Leave** | Dates, type, approval. Reason never exposed beyond HR. |
| **Help request** | A private request for support (food, ride, talk to someone, travel). Has a first reply target. |
| **Pulse response** | Anonymous score. Aggregates only, minimum group size. |
| **Skill / Person skill** | can do, learning; source (assessment, lead confirmed, Atlas suggested) |
| **Assessment** | External skills test with scores per area and bands |
| **Cover** (derived) | Whether someone else can do this person's job on a project during a date range |

### A5.3 Work

| Primitive | Description |
|---|---|
| **Project** | A container of work with an outcome, owner, dates, contract type, and a calculated status |
| **Outcome (Ask)** | What the customer (or the org) wants, in their words. Projects serve asks. |
| **Thread** | A steel thread: an end-to-end slice of value through the plan ("Trend to buyer email"). Status = worst of its work items. |
| **Milestone / Release** | A dated target. Has target date, forecast date, status. A release is a milestone visible to the customer. |
| **Work item** | An issue or task. Owner, week, due, linked change (PR, doc), goal, state (C6). |
| **Plan** | Threads and work items laid out by week or day; supports "our view" and "client view" |
| **Risk log entry (RAID)** | Risk, Assumption, Issue or Dependency. Owner, state, links to items and reasons. |
| **Handover** | Steps that move a person's work to cover before leave |
| **Update** | What changed, captured from conversation; becomes proposed record changes |

### A5.4 Customers and money

| Primitive | Description |
|---|---|
| **Customer** | An external organisation. Owner and backup owner. |
| **Contact** | A person at the customer. Sponsor flag. |
| **Contract** | Type (time and material, fixed price), value, seats, dates, stage |
| **Seat** | One contracted role. Filled or empty. Empty T&M seats lose money. |
| **Opportunity** | Work not yet signed. Stage, value, expected date. |
| **Commitment** | A promise: we promised or they promised. Owner, due, linked ask. |
| **Invoice** | Amount, due, paid |
| **Health signal** | Days quiet, overdue invoice, sponsor change, reply time, project status |

### A5.5 Operations and growth

| Primitive | Description |
|---|---|
| **Incident / Alert** | A system down, a weather watch, a site issue. Severity, affected people or customers. |
| **Facility / Site build** | Progress, next milestone |
| **Goal metric** | A long-term target (North Star) with pace now vs pace needed |
| **Funnel step** | A stage toward the goal with count and conversion |
| **Event** | Hackathon, community event, meeting with an executive |

### A5.6 Conversation and decisions

| Primitive | Description |
|---|---|
| **Capture** | Raw input: text, audio, transcript, email, event. Never edited. |
| **Extraction** | Proposed change from a capture: field, old, new, source span, confidence |
| **Inbox item** | Something a specific person must act on. Derived from rules, Atlas or people (A8.2). |
| **Decision** | An inbox item that needs a choice (approve staffing, accept a slip). Options, recommendation, outcome. |
| **Suggestion** | Atlas proposes something not asked for. Reasons, sources, Approve / Change / Dismiss. |
| **Action** | Something Atlas does after approval (send, book, assign, file). Undo where possible. |
| **Briefing** | A generated summary for an audience (leadership, a customer). Draft, edited, approved, sent. |
| **Check** | A rule that runs on every change and flags violations (A10) |
| **Audit entry** | Who did what, when, why. Required for care data reads and all Atlas actions. |

## A6. Areas: the questions an organisation asks every day

An **Area** is a configurable grouping that answers one question. Each area has: question, owner, the tracked items it includes, and a calculated status (worst child) with a reason.

Two kinds:
- **Continuity areas** roll up into the overall status.
- **Improvement areas** are reported beside.

The two daily questions sit above the areas. In the Intellibus instance they are "Are our people okay?" and "Did we sign a new contract?". They are configured per org, not hard coded.

Template:

| Area | Kind | Question | Included items (examples) |
|---|---|---|---|
| People | Continuity | Are our people okay, supported and covered? | check-ins, help request reply time, cover gaps |
| Delivery | Continuity | Are projects on track, with cover? | projects, milestones, threads |
| Customers and contracts | Continuity | Did we sign, can we deliver, are customers okay? | contracts, renewals, customer health, capacity |
| Operations | Continuity | Is anything threatening operations? | understaffed T&M contracts, incidents, alerts |
| Growth | Improvement | Are we moving toward the long-term goal? | goal metric pace, funnel, events |

## A7. Roles, lenses and visibility

### A7.1 A role is a lens

A role defines four things:
1. **Scope:** which records (all, own team, own projects, own customers, self).
2. **Default view** for Today (Chat, Inbox, Dashboard or Table). The person can change it and it is remembered.
3. **Inbox rules:** which conditions create items for them.
4. **Aggregation:** which facts they see as names and which only as counts.

People can hold several roles. The view switcher only offers roles the person holds. (In the prototype a "View as" menu switches between four people.)

### A7.2 Role templates (from L)

| Role | Scope | Today opens in | Sees | Never sees |
|---|---|---|---|---|
| Executive | Whole org | Dashboard | Overall status, areas worst first, decisions only, Growth beside | Care details, names of who is unwell, individual pulse |
| Delivery lead | Their projects and people | Inbox | Delivery checks, blockers, cover, customer replies, set vs calculated status | Care details |
| Employee | Self, their project | Inbox on web, Chat on phone | Own work, check-in, private help, own growth | Company numbers, others' data beyond the team basics |
| Care team | All people, care only | Inbox | Help requests by waiting time, who has not been heard from | Contracts, revenue |
| Finance or admin (not designed) | Contracts, invoices, people admin | Table | Invoices overdue, contracts to countersign, timesheets | Care details |
| Customer (not designed) | Their projects | Dashboard | Client view of the plan: releases and dates only | Internal statuses, people data |

### A7.3 Visibility classes

Each field has a visibility class. Enforce in the data layer.

| Class | Example | Who |
|---|---|---|
| Public in org | Where someone works today, their project, skills | Everyone |
| Lead | Today's plan, start time (**OPEN**, conflicts with "in or out only" for executives) | Lead, care team, self |
| Private care | Check-in notes, help request details, "not feeling well" names | Care team, self |
| Counts only | Not feeling well, help requests, escalations | Leaders see counts, never names |
| Aggregate only, minimum n | Weekly pulse (n ≥ 10) | Groups only; nothing below n |
| Commercial | Contracts, rates, revenue, customer health | Leadership (leads **OPEN**) |
| Client visible | Releases and their dates | The customer, if client view is on |

## A8. Views: Chat, Inbox, Dashboard, Table

Four ways to read the same records. Every page (Today, People, a project, Customers, Growth) can be read in any of them. A person, an update review and a briefing are single pages without the switch.

| View | For | Shape | Strength |
|---|---|---|---|
| **Chat** | Everyone, phone first | Conversation; answers are cards with actions and "Open as" chips | Asking and capturing |
| **Inbox** | People with things to clear | List of actions on the left, the selected one open on the right | Doing, one thing at a time |
| **Dashboard** | People who glance | Tiles worst first; two daily questions on top | Knowing the state |
| **Table** | Power users | Rows, grouping, filters, totals, keyboard, checks as flags | Changing many things at once |

### A8.1 View rules

- Switching view keeps the same filter and scope.
- A chat answer can open as any other view ("Open as Inbox / Dashboard / Table") and can be pinned to the dashboard.
- The table is desktop only. The phone has Chat, Inbox and Dashboard.
- Each tile, row or chat card links to the record it came from.

### A8.2 Inbox item anatomy

Every inbox item has:
- **Title** in plain words ("Forager 2.0 is set Off track, but the plan says At risk")
- **Why here** ("a status and the data disagree, and no reason is given")
- **Source and age** ("Delivery check · 2h", "Atlas · 8:12am", "GitHub · yesterday")
- **Primary action** (Add reason, Approve, Chase Kyle, Assign, Reply)
- **Group:** Decide now / Today / This week (or, for care, Waiting longest / From the team / Today)
- **Auto-close condition:** the item disappears when its cause is gone

### A8.3 Dashboard anatomy (Today)

1. Page head: title, overall status with reason, view switch.
2. The two daily questions as tiles, each with a small visual and a link.
3. Areas worst first, each with one number, a short line and a link.
4. Your decisions.
5. Improvement beside (Growth).
6. Optional: briefing ready, customise.

### A8.4 Table anatomy

- Left panel: checks with counts (Error, Warning, Info), click to filter. Switched-off checks listed.
- Filters as chips, search, count ("3 of 16 issues").
- Columns per page. Status column uses the five statuses only.
- Checks column shows flags on rows that break rules.
- Totals row ("1 blocked · 3 blank · 2 overdue").
- Keyboard bar (shortcuts, filter to cell, exclude, open, back to cards).

## A9. Atlas: the conversational agent

### A9.1 Jobs

| Job | Example |
|---|---|
| Capture | "Finished the TikTok ingest yesterday, Google Trends is done too, still waiting on Kyle for the store feed, I think the model slips a day, I'm out from Monday the 26th, Jodian has the runbook." becomes 6 proposed updates. |
| Clarify | One question for the one unclear field ("UWI, which campus?") |
| Answer | "Why is NEPA short-staffed?" gives a card with seats, cost per week and Approve both |
| Brief | Morning brief in chat; weekly leadership briefing as a document |
| Suggest | "Book a check-in with NIRA's new CIO this week, with Ricardo" with reasons |
| Draft | Reasons for set vs calculated, replies, handover notes, meeting summaries |
| Act (after approval) | Send, book, assign, file, update issues |

### A9.2 Extraction review (accountability)

For each update Atlas extracted from a message:
- Highlight the exact words it came from, numbered, linked to the update.
- Confidence: High (applied or matches known facts), Medium (needs OK), Low (needs OK, often edited).
- Marks: "No change", "Applied", "Needs your OK", "Edited by you", "Matches approved leave".
- Nothing reaches the plan, dashboard or table until the person confirms. "1 needs your OK before this is saved."

### A9.3 Rules for Atlas

- Runs with the asking person's permissions. Read tools over an API, never raw database access.
- Cites the records behind every answer. Says when data is missing.
- Never computes statuses (P6). It can explain them.
- Never interprets wellbeing for leaders. Never suggests diagnoses.
- Treats emails, transcripts and documents as data, not instructions.
- Labels everything it writes (Suggested by Atlas, Draft by Atlas).

## A10. Checks, rules and signals

### A10.1 Checks (run on every change)

A check is a rule with a severity, a scope and a switch.

| Check (examples from the designs) | Severity | Scope |
|---|---|---|
| Status set with no reason | Error | Project |
| In this plan week with no owner | Error | Work item |
| Done with no linked change | Error | Work item |
| In progress outside this week | Warning | Work item |
| Overdue and not done | Warning | Work item |
| Due after its milestone | Warning | Work item |
| No goal linked | Info | Work item |
| Not heard from by cutoff | Error | Person |
| Away soon and the only one who can | Warning | Person |
| Only one who knows a customer | Warning | Person, customer |
| Over 100% allocated | Warning | Person |
| No assessment in 90 days | Info | Person |

Checks can be switched off per scope with a reason ("Overdue" for cancelled issues). Violations show as flags in the table and can create inbox items.

### A10.2 Calculated rules

| Rule | Definition |
|---|---|
| Milestone status | forecast date vs target date; later = At risk, beyond tolerance = Off track (**OPEN:** tolerance) |
| Thread status | worst work item or milestone in the thread |
| Project status | worst thread (or set status with reason) |
| Cover gap | required skill where qualified, available people in a date range < requirement |
| Only one who can | skills a person holds that nobody else on the project holds at "can do" |
| Understaffed T&M | contracted seats minus filled seats > 0; cost per week = empty seats × rate × hours |
| Customer quiet | last two-way contact > 14 days |
| Renewal at risk | renewal within 90 days and any health signal bad |
| Goal pace | pace now vs pace needed for the target date |
| Help request first reply | first reply time vs target (60 minutes) |

### A10.3 Signals

Signals are facts from outside (calendar, email, accounting, monitoring, weather feeds, GitHub). They feed rules. They are shown with their source ("From: Accounting", "From: CRM contact update").

## A11. Provenance and trust

Every record and every change stores:
- `source` (atlas, whatsapp, email, calendar, github, crm, accounting, hr, assessment, monitoring, manual)
- `source_ref` (link or external id) and `captured_at`
- `capture_id` and `source_span` when it came from a conversation
- `generated_by` (person or Atlas), `confidence`
- `confirmed_by`, `confirmed_at`
- `edited` flag when a person changed Atlas's proposal

On screen: a source line on widgets, "where it came from" on inbox items, highlights on extraction review, "Draft by Atlas" labels.

---

# Part B. The Intellibus instance

How Intellibus fills in Part A. All data is a placeholder snapshot: **Tuesday 20 Oct 2026, 9:10am, America/Jamaica**.

## B1. Org

- Intellibus, Kingston, Jamaica. Positioning to clients: "we don't use Jira, we use Atlas".
- Working days exclude weekends and Jamaican public holidays. Currency USD in designs (per contract **OPEN**).
- Locations: Main office, UWI Mona, Mandeville, Remote.
- Internal units in the sidebar: Campus, Capital, GQ & Academy.
- Customers in the sidebar (projects): Sprouts 5, NEPA 4, Sante Group 2, PICA 1, NIRA 1, TAJ 1.

## B2. Name mapping

| Part A primitive | Intellibus name |
|---|---|
| Check-in | Morning check-in (with Atlas, in the Atlas messaging app) |
| Help request | Care request ("I need food", "I need a ride", "I want to talk to someone") |
| Assessment | GQ (skills diagnostic, 0 to 100 per area; bands Low 0 to 49, Mid 50 to 79, High 80 to 100) |
| Learning | Academy courses |
| Outcome (Ask) | Client ask ("Catch the next sea moss trend") |
| Goal metric | North Star: people placed in tech jobs |
| Funnel | Path to a job: used Atlas, joined the community, took a GQ, verified identity, got a tech job |
| Agent | Atlas |
| Care team | Shanelle Grant's team; escalation path care team, HR, security, executive |

## B3. Two daily questions and areas (snapshot)

**Overall: Off track, because Operations is: NEPA support is 2 people short.**

| | Answer / status | Detail |
|---|---|---|
| Are our people okay? | Yes, mostly (On track) | 50 people: 40 well, 2 not feeling well, 6 on leave, 2 not heard from (Kemoy Walters, Sasha Brown). 38 in, 4 remote. Care replies in 22 min (target 60). |
| Did we sign a new contract? | Yes, 1 today (On track) | Sante Group data platform, $420k. 9 signed in 22 working days. |
| Operations | Off track | NEPA support (T&M) 3 of 5 seats staffed, about $9k a week unbilled. Hurricane watch Thursday. Sprouts store API was down 1h 30m (Done). |
| Delivery | At risk | 5 of 7 projects on track. Forager 2.0 trend model 1 day late; QR for Foraging behind (412 of 1,000 ideas). |
| Customers and contracts | At risk | $1.4M of $4M this quarter (expected $0.9M by now). NIRA renewal 30 Nov at risk: 16 quiet days, $40k invoice 21 days overdue, sponsor changed 2 Oct. Can we deliver: 6 of 9 engineers. |
| People | On track | 42 of 50 checked in. |
| Growth (beside) | Off track | 1,240 of 50,000 placed; 62 a month vs about 1,280 needed (target year placeholder). C-suite meetings 7 of 12 (At risk). |

## B4. People in the snapshot

| Person | Role | Notes |
|---|---|---|
| Executive (unnamed) | Executive | "In or out only" view of people |
| Alicia Campbell | Delivery lead | Owns NEPA support staffing, Forager 2.0, GQ & Academy pricing |
| Kemar Brown | Data engineer | Forager 2.0, reports to Alicia, UWI Mona, on leave 26 to 30 Oct (Forager days 15 to 19), only one who can run the data pipeline, GQ 78 (Data pipelines 92, SQL 84, Python 69, Logical 67, Cloud not assessed) |
| Jodian Taylor | Intern | Covering the pipeline; handover 2 of 4 |
| Shanelle Grant | Care team | Owns care requests |
| Ricardo Henry, Omari Clarke | Engineer, intern | Free Monday; proposed for NEPA seats |
| Tashana Reid, Andre Mitchell, Marcus Bailey, Nadine Francis, Damian Lewis, Jada Lewis, Kemoy Walters, Sasha Brown | Various | Seed data |

## B5. Example project: Forager 2.0

- Customer Sprouts. Fixed price. Serves the ask "Catch the next sea moss trend".
- 12 Oct to 6 Nov 2026, day 9 of 26 (one plan step per working day).
- Threads: Trend to buyer email (At risk), Store sales signal (At risk, worst thread), Production ready (On track).
- Milestones: Data sources 16 Oct (Done), Trend model target 23 Oct forecast 24 Oct (At risk), Buyer pilot · Release 1 30 Oct (On track), Production checks 3 Nov (On track), Rollout · Release 2 6 Nov (On track). Client view shows only the two releases.
- Risk log: Dependency "Store sales feed access from Sprouts IT" (#151, owner Alicia, Open); Risk "Only Kemar can run the pipeline; away days 15 to 19" (Mitigating); Assumption "Buyers available for the pilot week of 26 Oct" (Holding); Issue "Google Trends rate limit" (#145, Resolved).
- Status: calculated At risk; Alicia set Off track at 9:02am without a reason, which created the inbox item that asks for one.
- 16 GitHub issues (#142 to #163) with delivery checks: 6 errors, 4 warnings.

## B6. Executive decisions (snapshot)

1. Approve Ricardo and Omari for NEPA support (the only off-track item; $9k a week until staffed)
2. Accept the Forager trend model moving one day (Release 1 unaffected)
3. Book a check-in with NIRA's new CIO (Atlas suggestion)
4. 1 care request escalated to HR (noted; details stay with the care team)
5. Sign off GQ & Academy pricing ($380k; Sprouts review Thursday)

---

# Part C. Lifecycles and state machines (research seed)

Purpose: a starting point for formal state machine work. Each machine lists states, events, guards and timers seen or implied in the designs. Names are proposals. Anything not seen in a design is marked **(proposed)**.

## C0. Modelling notes

- **Two layers.** Lifecycle state (what is happening to the thing) is separate from status (how it is doing against its target, A4). A work item can be In progress (state) and At risk (status).
- **Stored vs derived.** Lifecycle states are stored and changed by events. Statuses are mostly derived by rules, except a set status (A4.3), which is stored with a reason.
- **Hierarchy.** Status rolls up: work item → thread → project → area → overall. A good fit for hierarchical or composed machines (statecharts).
- **Time.** Many transitions are timers: cutoffs, SLAs, due dates, quiet days, renewals.
- **Actors.** Events come from people (by role), Atlas (always as a proposal until confirmed), rules and integrations. Guards check role and scope.
- **Audit.** Every transition stores actor, time, source and reason.

## C1. Capture and extraction

```
received -> transcribing* -> parsing -> (needs_clarification <-> parsing) -> proposed
proposed -> partially_confirmed -> confirmed -> applied
proposed -> rejected
* only for voice
```

Per extracted update: `proposed -> accepted | edited | rejected`. Medium or Low confidence cannot auto-accept.

- Events: MESSAGE_RECEIVED, TRANSCRIBED, PARSED, FIELD_UNCLEAR, ANSWERED, ACCEPT(update), EDIT(update), REJECT(update), SAVE
- Guards: SAVE only when no update is "needs your OK"; only the author (or their delegate, **OPEN**) can confirm
- Effects: applied changes trigger rule evaluation (C3) and checks (A10)

## C2. Check-in (person per day)

```
expected -> reminded (at 9:00am) -> submitted -> needs_clarification -> confirmed
expected | reminded -> not_heard (at cutoff, OPEN) -> nudged -> submitted | care_follow_up
any -> on_leave (approved leave covers today)
```
Midday check: unanswered -> yes | not_yet | no (care team only).

## C3. Tracked item status (any item with a target)

```
not_started -> on_track <-> at_risk <-> off_track
on_track | at_risk | off_track -> done
```
- Calculated by rules (A10.2) on every relevant change and on timers (due dates).
- Override sub-machine:
```
calculated_only -> set_differs (owner sets another status) -> reason_required -> explained (reason saved, linked to RAID)
explained -> calculated_only (when they agree again, or on expiry, OPEN)
```
- Effects: set_differs creates the inbox item "Status set with no reason" for the owner.

## C4. Inbox item

```
created -> open -> (snoozed -> open) | (delegated -> open for someone else) -> acted -> closed
open -> auto_closed (cause cleared)
```
- Created by: rule, check violation, Atlas suggestion, a person's request, an incoming message.
- Group assignment (Decide now / Today / This week) recalculated by timers.

## C5. Atlas suggestion and action

```
Suggestion: drafted -> shown -> approved | changed -> (approved) | dismissed
Action:     requested -> awaiting_approval -> approved -> executing -> succeeded | failed
            succeeded -> undone (if undo is available)
```
- Guard: approver must hold the role and scope for the target records.
- Every step is audited.

## C6. Work item (issue)

```
to_do -> in_progress -> done
in_progress -> blocked -> in_progress
any -> cancelled
```
- Synced from GitHub (proposed: GitHub is the backbone for engineering work).
- Checks (A10.1) run on each transition.

## C7. Milestone and release

```
planned -> in_progress -> done
in_progress -> missed (target passed, not done)
forecast_changed (event) recalculates status
```
- Accepting a slip is a decision (C4) that updates the target, with an audit entry.

## C8. Risk log entry (RAID)

```
Risk:        open -> mitigating -> resolved | realised (becomes an Issue)
Assumption:  holding -> confirmed | broken (becomes a Risk or Issue)
Issue:       open -> resolved
Dependency:  open -> waiting -> met | late (raises a Risk)
```

## C9. Leave and cover

```
requested -> approved -> handover_in_progress (n of m steps) -> covered | uncovered -> active -> ended
uncovered raises a cover gap (team continuity) and inbox items for the lead
```

## C10. Help request (care)

```
new -> acknowledged (first reply) -> in_progress -> resolved
in_progress -> escalated(level: care team, HR, security, executive) -> resolved
timer: no first reply in 60 min -> breach (care area At risk)
```
- Leaders receive only "escalated" counts.

## C11. Contract, opportunity and seat

```
Opportunity: pitch -> proposal -> pricing -> with_legal -> signed | lost
             any -> stalled (no movement in N days, OPEN)
Contract:    signed -> mobilising -> running -> renewal_due (90 days) -> renewed | ended
Seat:        open -> proposed -> approved -> filled -> released
```
- Understaffed T&M (empty seats on a running T&M contract) makes Operations Off track.

## C12. Customer health

```
healthy <-> watch <-> at_risk
```
- Rule-based from signals (A10.3), confirmed or overridden weekly by the owner (set vs calculated applies).

## C13. Briefing

```
scheduled -> drafted (Atlas) -> edited -> approved -> sent
```
- Variants: leadership, customer (client view only).

## C14. Questions for the state machine research

1. Which statuses are stored and which are always derived? Can derived statuses be cached safely?
2. How do we model roll-up: one composed statechart, or independent machines plus a reducer?
3. How long does a set status last? What events clear it?
4. Which transitions may Atlas propose, and which can only a person make?
5. How do we merge the same event arriving from two channels (Atlas and the DPM app)? Answered for use case 1: two captures, deduplicated by channel and message id (machines doc D14).
6. How do external systems (GitHub, CRM) map to our states, and who wins on conflict?
7. Which timers are org config (cutoffs, SLAs, quiet days, tolerance) and which are fixed?
8. How do we replay or simulate a day (for testing rules and briefings)?
9. Can the Anubis grid's state machine be reused for work items and checks?
10. What is the minimal set of machines that covers all five domains? (Hypothesis: capture, tracked status, inbox item, request, and a generic "staged pipeline" for opportunities, seats and briefings.)

---

# Part D. Design reference (Figma)

File: https://www.figma.com/design/ZO8VzQEZ1t1hPDtfn4Dij8/Digital-Project-Manager

## D1. Variation history (what each round taught)

| Variation | Idea | Kept | Dropped or changed |
|---|---|---|---|
| G · Continuity on D | The first full system: continuity framework, Today for leaders, People, Customers, Contracts, Projects, Plan, Team, Growth, profiles, care team, mobile Atlas flows | The framework, the two daily questions, cover, care privacy, provenance | Dense pages, too many widgets per screen |
| H · Call updates (21 Oct) | Business continuity added; role-based Today ("no action, don't see it"); clearer People tiles | Role-based Today, business continuity | |
| I · Three levels | After the Anubis call and MercuryOS: one problem shown as chat, cards and grid; extraction accountability; delivery checks; steel threads; RAID; set vs calculated | Status language, checks, extraction review, set vs calculated | Spaces and flows (too unfamiliar) |
| J · Every role | I applied to every role and every area: role homes, People, Customers, Growth | Role homes, area pages, "why here" | MercuryOS shell (spaces, drop zones, faded cards) |
| K · Four views | Pulled back to a familiar app: sidebar, pages, Ask Atlas, view switch Chat / Inbox / Dashboard / Table; chat on web and phone | The shell and the four views | Lost J's roles and area pages |
| **L · Four views, every role (current)** | K's shell with J's reach | Everything above | |

## D2. Variation L screens

Page: "Variation L · Four views, every role"

| ID | Screen | Role | View |
|---|---|---|---|
| L1 | Today · Chat (web) | Executive | Chat |
| L2 | Today · Chat with an answer open (Forager milestones and risk log on the right) | Executive | Chat |
| L3 | Today · Inbox (NEPA staffing decision open) | Executive | Inbox |
| L4 | Today · Dashboard | Executive | Dashboard |
| L5 | Today · Table | Executive | Table |
| L6 | Today · Delivery lead (set vs calculated detail, your projects) | Delivery lead | Inbox |
| L7 | Today · Employee (check-in, need something, your growth) | Employee | Inbox |
| L8 | Today · Care team (request detail, not heard from) | Care team | Inbox |
| L9 | People | Executive | Dashboard |
| L10 | People | Executive | Table |
| L11 | Person · Kemar Brown | Executive | Single page |
| L12 | Customers and contracts | Executive | Dashboard |
| L13 | Growth and North Star | Executive | Dashboard |
| L14 | Forager 2.0 (plan, risk log, milestones) | Executive | Dashboard |
| L15 | Forager 2.0 (issues, delivery checks, owner filter) | Executive | Table |
| L16 | Review my update (extraction review) | Employee | Single page |
| L17 | Briefing (weekly, leadership) | Executive | Single page |
| L18 | Mobile: morning brief, answer, inbox, dashboard glance, capture by voice | Employee / Executive | Chat, Inbox, Dashboard |
| L0 | View as menu (prototype role switch) | All | Overlay |
| L16b | Review my update, grouped by project, with BRAID cards and routing reasons (26 Oct) | Employee | Single page |
| L6b | Today · Delivery lead with a BRAID risk approval; reason links BRAID entries (26 Oct) | Delivery lead | Inbox |
| L6c | Today · Store Insights PM (Andre) with a pending decision (26 Oct) | Delivery lead | Inbox |
| L14b | Forager 2.0 with the full BRAID log: six kinds, report counts, approvals (26 Oct) | Executive | Dashboard |
| L18f | Mobile chat: one update, two projects (26 Oct) | Employee | Chat |

Prototype flows: L · Executive, L · Chat (web), L · Delivery lead, L · Employee, L · Care team, L · People, L · Project, L · Mobile.

## D3. Variation G screens (still useful as reference)

G1 Today (leaders), G2 People, G3 Care team, G4 Contracts, G5 Projects, G6 Forager overview, G7 Plan (26-week strip), G8 Team (availability lanes, skills matrix), G9 to G13 Customers, Sprouts, Growth, person profile, my day, G14 mobile Atlas flows (morning check-in, midday tap, create a project by talking, care request), G15 to G17 Atlas pop-ups (start, team cover answer, handover draft).

Detailed screen notes, metric definitions, integrations, privacy and the design tokens are in `reference/technical-handoff-variation-H.md`. It reflects G and H; where it differs from this document, this document wins for concepts from I onward (status language, views, roles, checks).

## D4. Design system (summary)

- Tokens "DPM / Precision", light and dark. Status tones: ok #18794e, warn #ad5700, bad #ce2c31, neutral #a1a1aa, ai #6e56cf, accent #3e63dd.
- Type: Geist only. Display 48, Metric 28, Title 20, Heading 15, Body 14, Label and Caption 13, Micro 12.
- Components: D/Status, D/Button, D/Avatar, D/Kbd, D/Nav item, D/Sidebar, D/Header.

---

# Part E. Use cases beyond Intellibus

The model is general if an org has: people whose wellbeing and availability matter, work with targets, external parties who pay or depend on it, and a long-term goal. Use this table to test a new case.

| Part A primitive | Agency / consultancy | Construction or site development | School or training programme | Clinic or care operations | Nonprofit programme |
|---|---|---|---|---|---|
| Customer | Client | Owner, funder, regulator | Partner employer, sponsor | Payer, referral partner | Donor, government partner |
| Outcome (Ask) | Client outcome | Approved, opened site | Learners placed in jobs | Patients seen within target | Beneficiaries reached |
| Project | Engagement | Work package, phase | Cohort | Service line, initiative | Programme |
| Thread | Steel thread | Approval path (permit to inspection) | Learner journey | Patient pathway | Service pathway |
| Milestone | Release | Permit, inspection, handover | Exam, graduation | Accreditation, audit | Reporting deadline |
| Seat | Contracted role | Crew role, subcontractor | Instructor slot | Shift | Field staff |
| Check | Delivery check | Safety or compliance check | Attendance or progress check | Clinical admin check | Reporting check |
| Help request | Care request | Site welfare request | Learner support request | Staff support request | Volunteer support |
| Goal metric | Placements | Visitors, revenue after opening | Placement rate | Access, outcomes | People reached |
| Operations alert | System down | Weather, materials delay | Venue, connectivity | Equipment, staffing | Logistics |

Signs the model fits: work is planned, people are the constraint, statuses must be explained to someone outside the team, and input happens in conversation (Atlas messages, calls, meetings).

Signs it does not: pure ticket queues with no targets, highly regulated records that cannot accept conversational input, or teams with no external party.

---

# Part F. Open questions and decisions

| # | Question | Notes |
|---|---|---|
| F1 | Is the product Intellibus-only, a configurable product for similar orgs, or a template others adopt? | Drives how much of Part A becomes configuration |
| F2 | Which areas and daily questions are configurable, and by whom? | A6 |
| F3 | Set status expiry and who may override | A4.3, C3 |
| F4 | Executive visibility of plans and start times vs "in or out only" | A7.3, handoff D7 |
| F5 | Leads' access to commercial data | A7.3 |
| F6 | GitHub as the backbone for work items vs in-app tasks | C6, handoff D15 |
| F7 | Reuse the Anubis grid and its state machine | C14.9 |
| F8 | Customer access (client view) | A7.2 |
| F9 | Finance or admin role design | A7.2 |
| F10 | Thresholds as org config: not heard cutoff, quiet days, stalled days, milestone tolerance, minimum group size, SLA | A10 |
| F11 | Existing Atlas architecture and channels | handoff D1 |
| F12 | Privacy policy sign-off under Jamaica's Data Protection Act before build | handoff section 9 |
| F13 | RAID becomes BRAID (Blockers, Risks, Assumptions, Issues, Dependencies, Decisions). Rewrite C8 and A5.3 for six kinds? | Briefing 26 Oct; use case 1 machines M15 |
| F14 | Who reports and who decides per kind. Briefing: blockers and issues by anyone; risks approved by the PM or lead; decisions pending until explicitly approved. Assumptions and dependencies not covered | Briefing; use case 1 rights table, S10 to S13 |
| F15 | Project roles from a standard set (PM, lead, member), assigned per project in Atlas. How do they relate to the org-level roles in A7.2? | Briefing; build plan B9 |
| F16 | Visibility follows group membership: within a company, only the people in the group see its data. Does the executive lens (A7.2, "whole org") survive? | Briefing; A7, P10, B3 |
| F17 | Data reaches DPM only from groups whose owner authorized it; groups are tagged to org emails for org dashboards. Replace "org" in A5.1 with group plus org tag? | Briefing; build plan B8 |
| F18 | Consolidation: semantic dedupe across chats and meetings, and conflicting decisions flagged for a person | Briefing; use case 1 machines M16 |
| F19 | One update routes to several projects. Routing rules and privacy of the quotes | Use case 1 machines M14 |
| F20 | Check-out at the end of the day, beside check-in (C2) | Briefing |
| F21 | Plans and goals generated from conversations, exported to PowerPoint or Docs, edits returned by upload | Briefing |

People to involve: Ed Watal (product owner), Anubis (grid component, workflow states), Carl (state machines), Malik (current Atlas), Ram (Max, the US team's tool with MCP integrations; name spelling unconfirmed).

---

# Part G. Glossary

| Term | Meaning |
|---|---|
| Area | A grouping that answers one daily question and has one status |
| Ask | A customer's desired outcome in their words |
| Atlas | The conversational agent: capture, clarify, answer, suggest, draft, act after approval |
| Calculated status | Status derived from rules and children |
| Capture | Raw input from a conversation or system |
| Check | A rule run on every change that flags violations |
| Continuity | Keeping people, teams, customers and operations able to function |
| Cover | Someone else who can do a person's work while they are away |
| Extraction | A proposed record change from a capture, with source words and confidence |
| Improvement | Long-term goals, reported beside continuity |
| Inbox item | Something a specific person must act on, with why and where from |
| Lens | What a role sees: scope, default view, inbox rules, aggregation |
| North Star | Intellibus's long-term goal: people placed in tech jobs |
| RAID | Risks, Assumptions, Issues, Dependencies |
| Roll-up | Parent status = worst child |
| Set status | Status chosen by a person; needs a reason when it differs from calculated |
| Steel thread | An end-to-end slice of value through a plan |
| T&M | Time and material: paid per person per hour, so empty seats lose money |
| View | Chat, Inbox, Dashboard or Table: four readings of the same records |
| Worst first | Default sort for anything with a status |
