# Digital Project Manager: Technical Handoff

**For:** the developer(s) building the Intellibus Digital Project Manager (DPM) and its Atlas input layer
**Based on:** Figma file "Digital Project Manager", page "Variation H · Call updates" (current) and "Variation G · Continuity on D" (unchanged screens), plus the 21 Oct 2026 review call
**Status:** design is high fidelity, data and numbers are placeholders, several product and technical decisions are still open (section 12)

This document is written so you can make sound technical decisions without opening the designs. Where something is undecided it is marked **DECISION** or **TBD**.

---

## Contents

1. What we are building
2. Core principles that become technical requirements
3. Users, roles and who sees what
4. Screen inventory
5. Domain model
6. Metric definitions and business rules
7. Atlas: the AI input and assistant layer
8. Integrations and sources of truth
9. Privacy, security and compliance
10. Frontend: design system, components, charts, interaction patterns
11. Suggested architecture
12. Technical decisions to make
13. Questions a developer is likely to ask (with current answers)
14. Build phases and acceptance criteria
15. Placeholder dataset (for seed data and tests)
16. Glossary

---

## 1. What we are building

An internal operations dashboard for Intellibus, positioned to clients as "we don't use Jira, we use Atlas". It answers two daily questions for leadership and gives every person a view of only what they need to act on.

**The loop:** Atlas is the input, the dashboard is the output. People talk or type to Atlas (voice, chat, WhatsApp). Atlas turns that into structured records. The dashboard shows those records as a grid, charts and action lists. Nobody fills in forms.

**Organising framework: "Continuity before improvement"**

| Layer | Question it answers | Where it shows |
|---|---|---|
| Continuity of the individual | Are our people okay? Well, supported, growing | Today, People, Care team, Profiles |
| Continuity of the organisation | Did we sign a new contract we can deliver? Revenue, opportunities | Today, Customers, Contracts |
| Continuity of the team | Do teams have the right skills and cover as people come and go? | Today, Projects, Forager Team tab, Profiles |
| Continuity of the business (added 21 Oct) | Is anything threatening operations? Systems down, weather, understaffed time-and-material contracts | Today |
| Improvement (after continuity) | North Star: tech jobs placed, community, GQ tests, hackathons, C-suite meetings | Today (North Star), Growth |

**Out of scope for now:** the full sales pipeline (Today shows a sales activity summary and links to the CRM; see DECISION D2), data migration from existing tools, a client-facing portal (DECISION D14).

---

## 2. Core principles that become technical requirements

| Principle | What it means for the build |
|---|---|
| Show, don't describe | Most numbers have a small visual (squares, bars, sparklines, strips). Charts need real data structures, not just totals. |
| TV readable | Minimum body text 14px, secondary 12px, WCAG AA contrast. Leadership will put Today on a screen in meetings. |
| Every number drills down | Every count, chip and chart segment links to a filtered list or detail view. Plan for deep-linkable URLs with filters in the query string. |
| Information sticks | Never hide a section because data is missing. Show partial states ("42 of 50 checked in", "Not yet assessed"). Need explicit empty, partial and stale states for every widget. |
| No forms | Input is "Talk to Atlas" / "Update with Atlas". Edits are confirmations of what Atlas parsed. Some inline controls exist (Approve, Change, Nudge). |
| Show where data came from | Most widgets carry a source line ("Atlas check-ins · 9:05am", "CRM · email · calendar"). Every record needs `source`, `source_ref` and `captured_at`. |
| Mark AI content | Anything written by Atlas is labelled (purple "Suggested by Atlas", "Draft by Atlas", "Summary by Atlas") and needs Approve / Change before it takes effect. Store `generated_by`, `approved_by`, `approved_at`. |
| Outcomes before technology | Client "asks" (outcomes) sit above projects. Commitments link to the ask they serve. Model outcomes as first-class records. |
| Light theme primary, dark supported | Every colour is a token with light and dark values (section 10). |

---

## 3. Users, roles and who sees what

### Roles

| Role | Example in designs | Lands on |
|---|---|---|
| Executive / leadership | "Executive view" | H1 Today (leaders) |
| Lead (project or client lead) | Alicia Campbell, lead for Sprouts | Lead Today is next round; uses leader screens for now |
| Employee | Kemar Brown, data engineer | H9 My day |
| Intern | Jodian Taylor, Omari Clarke | Same as employee |
| Care team | Shanelle Grant | H1c Care team Today |
| HR / admin | Not designed | TBD |
| Community member / hackathon participant | Appears in North Star and Growth data; profile "type" label exists | Probably no login in v1 (DECISION D13) |
| Client | Not designed | DECISION D14 |

People can hold more than one role (a lead is also an employee). The header has a view switcher ("Executive view", "Kemar Brown · Employee", "Shanelle Grant · Care team"). In the prototype it switches personas; in production it should switch between the views a person is entitled to.

### Visibility rules (as designed, must be enforced in the data layer, not only the UI)

The employee profile has a "Who sees what" panel that promises the following. Treat it as a contract.

| Data | Everyone | Lead / leadership | Care team | The person | Notes |
|---|---|---|---|---|---|
| Where someone works today (in office, which campus, remote, out) | Yes | Yes | Yes | Yes | |
| Their project(s), team, clients, skills, GQ score | Yes | Yes | Yes | Yes | |
| Today's plan and start time | No | Yes | Yes | Yes | **Conflict:** the leader sidebar footer says "Executive · In or out only". Resolve in DECISION D7. |
| Check-in notes (for example "mild headache") | No | No | Yes | Yes | Health-adjacent |
| Care requests (food, ride, talk to someone) and their details | No | Counts only | Yes | Yes (own) | |
| "Not feeling well" | No | Count only, never names | Names | Yes (own) | H2 shows "2 said they are not feeling well. 1 came into Main office." |
| Weekly pulse (1 to 5 mood) | No | Group average only, and only when 10 or more answered | Group average only | Own answers | Never shown per person to anyone else |
| Leave | Dates and "approved" | Dates, type (vacation, personal) | Same | Yes | Never the medical reason |
| Contracts, revenue, rates, T&M cost estimates | No | Yes | No | No | Leaders only (confirm for leads) |
| Customer health, commitments | No | Yes | No | No | |

Role-based Today (from the 21 Oct call): "If I don't have an action to take, I shouldn't see it." Leaders see continuity summaries plus their own actions. Everyone else sees only their own actions.

---

## 4. Screen inventory

All desktop screens are designed at 1440px wide with a left sidebar, a header bar and usually a 320 to 340px right inspector panel. Mobile Atlas flows are 390 x 844.

### Shell (every desktop screen)

- **Sidebar:** workspace switcher ("Intellibus"), Ask Atlas field (⌘K), nav (Today, People, Projects with count, Growth, Customers), Clients list with project counts (Sprouts 5, NEPA 4, Sante Group 2, PICA 1, NIRA 1, TAJ 1), Internal (Campus, Capital, GQ & Academy), signed-in user and role at the bottom.
- **Header:** breadcrumb path and page name, date and snapshot time ("Tue 20 Oct · 9:10am"), view switcher, "Ask Atlas" button.
- **Ask Atlas pop-up (⌘K):** overlays any screen. See section 7.3.

### Leaders

| ID | Screen | Purpose and key content |
|---|---|---|
| H1 | Today (leaders) | Greeting and summary dots ("3 need support · 1 contract signed · 1 team gap · 1 business issue"). Dashboard / Atlas switch, Customise button, jump-to-section chips. **Continuity block:** Q1 "Are our people okay?" (answer plus 50 squares, one per person, coloured by state) and Q2 "Did we sign a new contract?" (answer plus 22-working-day bar strip). Team continuity line (Forager 2.0 has no data engineer on days 15 to 19, "+2 more", Plan cover). Business continuity line (NEPA support T&M 3 of 5 staffed, $9k a week unbilled, Staff it), expandable list (Sprouts API down since 6:10am, hurricane watch). **Your actions:** tagged People / Contracts / Team with inline buttons. **Top projects** table with status, cover, progress bar with "where the plan says we should be" tick, lead. **Sales activity:** opportunities that moved this week with stage dots and "no movement in 9 days" warning. **North Star:** metric tabs with sparklines and a projection chart. Inspector: people okay over last 7 working days (dots), contracts (signed today, due this week, revenue bullet with expected tick, next signature), campus build progress, Ask Atlas prompts. Widgets have drag handles. |
| H1b | Today · Atlas mode | Same page with the conversation in the centre. Answers render as cards (rows plus action buttons) and can be pinned to the dashboard. Right rail keeps the two daily questions, team and business continuity, and pinned items. |
| H2 | People | Location tabs (Everyone 50, Main office 22, UWI Mona 9, Mandeville 7, Remote 4, Out 6). **All numbers on the page follow the selected tab.** Check-in breakdown: 50 = 40 well + 2 not feeling well + 6 on leave + 2 not heard from, as a stacked bar plus "so what" lines with actions. Separate tiles: Care requests (3 open, by state), Weekly pulse (3.9 of 5, last week marker, anonymous), Growing skills (31 of 50 this month). People table grouped (Not heard from yet, Here today by location) with project, today's plan, start time, billable. Inspector shows the selected person. |
| H3 | Care team view | Care team only. Open / Patterns / Escalated / Resolved tabs, requests with waiting time against a 60 minute target, escalation path (care team, HR, security, executive), assignment. |
| H12 | Customers | Overview / Contracts tabs. Strip: healthy clients, revenue this quarter, renewals in 90 days, quiet 14+ days. Atlas suggestion with reasons and Approve / Change. Clients table sorted by risk: client and their ask, 8-week health squares, projects, revenue, next contract moment, last contact, cover (people who know the client). |
| H13 | Customer · Sprouts | Client head (owner, renewal). Strip: health, revenue vs expected, open commitments. "What Sprouts asked for" (each ask with the projects serving it). **Commitments** (we promised / they promised, linked ask, due date, status, action items underneath). Health signals with sources. Inspector: people on both sides with owner and backup, money, growing with the client (opportunity plus Atlas-noticed idea), Ask Atlas. |
| H4 | Contracts | "Did we sign a new contract?" Strip: signed in 22 working days, revenue vs target with expected tick, can we deliver (engineers 6 of 9). **Signed and running:** contract, type (T&M or Fixed), staffed seats (filled vs dashed), effect ($ unbilled per week, start date). Engineers needed vs available over 8 weeks (two lines plus gap area). Close to signing: stage dots (Pitch, Proposal, Pricing, Sign), value, expected date, engineers needed. Link out to CRM. |
| H5 | Projects | Grouped list (Signed · in flight, Working toward a contract, Done this quarter) with drag-to-reorder priority, status, progress, team coverage, target date, lead, row menu with keyboard shortcuts. Client "asks" bar at the top. |
| H6a | Forager 2.0 · Overview | Project question as title ("How do we find the next sea moss?"), tabs (Overview, Team with warning dot, Plan, Checks, Files, Activity), "How we'll know" outcome metrics, latest update, team cover callout, milestone timeline with today line, off-plan request with Keep the plan / Talk to Kyle, activity feed, comment box ("Tell Atlas what changed"). Inspector: properties, production checks, links. |
| H6b | Forager 2.0 · Plan | Week by week / Review switch, Open in GitHub. **26-week strip** with milestone bands, status per week (done, slipped, this week, planned), leave overlay. **Selected week:** activities with the goal(s) each serves, owner(s), GitHub issue or doc (Draft / Published), status. "Tell Atlas what changed this week". Inspector: goals this week, last week recap, GitHub counts. |
| H7 | Forager 2.0 · Team | Availability lanes per person across the plan (leave, out, open roles), skills matrix (person × skill, "can do it" vs "learning", cover column: only Kemar, 2 people), handover and request cover actions. |
| H8 | Growth | Improvement metrics: North Star pace vs needed, path-to-a-job funnel with conversion per step, Atlas suggestion (plan a hackathon), community GQ tests, hackathons, C-suite meetings. |
| H11 | Person profile (lead view) | Type label (Employee · full time), teams and clients, stat strip (checked in 10 of 10, next leave and handover progress, GQ, "only one who can"), where they work over 13 working days, GQ profile card (radar, strengths, areas to develop), projects with cover, check-ins (day, start, where, plan). Inspector: about, growing (Academy courses), recent work (commits, docs), Ask Atlas, privacy note. |

### Everyone else

| ID | Screen | Purpose and key content |
|---|---|---|
| H1c | Today · Care team | Only the care team's actions: talk to someone (escalated, 1h 12m), breakfast, book a flight, fix a hotel booking, review timesheets. Each shows waiting time, status, primary action and **where it came from** ("From WhatsApp · Alicia · 8:02am · link attached"). Done today (collapsed). Inspector: not heard from, patterns to follow up, this week stats. |
| H9 | My day (employee) | Check-in card (what you said vs what Atlas saved, with "Care team only" note), today's tasks, my project with alerts, before-your-leave handover line, need something (food, ride, talk to someone), my growth (GQ), this week, North Star. |
| H10 | My profile (employee) | Before your leave (handover steps), GQ profile card, recent work, "Who sees what", next two weeks, own check-ins (notes private), Ask Atlas. "Preview as others" opens H11. |

### Atlas

| ID | Screen | Purpose |
|---|---|---|
| H17 | Ask Atlas pop-ups | Start (leaders), Start (employee), Team cover answer, Handover draft. Overlay with dimmed backdrop, esc and click-outside to close. |
| HM | Mobile · after a meeting | 1) "Summarise my 10am and share it" gives a summary (Decided, We promised, Next actions). 2) Routing: Person doc (new tab for this meeting), Project, Company, plus share-with people and groups. 3) Shared, filed, and commitments now tracked on Today; offer to book follow-up. |
| G14 | Mobile flows (in Variation G) | Morning check-in (one message, Atlas asks about the one unclear field), midday wellbeing tap (yes / not yet / no), create a project by talking, care request ("need food", location sharing optional). |

---

## 5. Domain model

Field lists are indicative. Every table also needs `id`, `created_at`, `updated_at`, `source` (atlas, whatsapp, email, calendar, github, crm, accounting, hr, gq, academy, manual), `source_ref` (URL or external ID) and, where AI is involved, `generated_by`, `confidence`, `approved_by`, `approved_at`.

### People and wellbeing

- **Person:** name, initials, photo, `person_type` (employee, intern, contractor, community_member, hackathon_participant), employment status, `reports_to` (Person), home location, usual pattern ("2 days in, 3 at home"), joined date, billable flag, roles (many). Not all people have logins.
- **Location:** name (Main office, UWI Mona, Mandeville, Remote), kind (office, campus, remote).
- **CheckIn:** person, date, `submitted_at`, location (or remote), start time, plan items (list of text plus optional links to Activity), wellbeing (well / not_well / unanswered), note (private, care-team visible), raw input (text or audio transcript), parse confidence per field, confirmed_at.
- **PresenceDay** (derived or materialised): person, date, state (in, remote, out, not_heard), reason class (leave, unknown).
- **Leave:** person, start, end, type (vacation, personal, sick, other), approved_by, status. Sick reason is never exposed beyond HR.
- **MiddayCheck:** person, date, breakfast / lunch / water (yes, not_yet, no). Care-team only.
- **CareRequest:** requester, type (food, ride, talk, travel, booking, other), description, location shared (optional), channel, created_at, first_reply_at, assignee, status (new, in_progress, escalated, resolved), escalation level (care team, HR, security, executive), SLA target (60 min first reply), private flag.
- **PulseResponse:** person (stored but never queryable per person outside the person), week, score 1 to 5. Aggregates only with n ≥ 10.
- **CarePattern** (derived): person, pattern (no breakfast 3 days running, no check-in 2 working days), first_seen, status.

### Skills and growth

- **GQAssessment:** person, role diagnostic (for example "Data engineer"), assessed_at, overall score (0 to 100, "role diagnostic average"), per-area scores (for example Data pipelines 92, SQL 84, Python 69, Logical ability 67), percentiles, strengths (topic, % correct, n correct of n), areas to develop (text, from percentile to target percentile), areas not yet assessed. Synced daily from the GQ platform.
- **Skill:** name. **PersonSkill:** person, skill, level (can_do, learning), source (GQ, lead-confirmed, Atlas-suggested), confirmed_by.
- **AcademyProgress:** person, course, % complete, completed_at.

### Projects, plans and work

- **Project** (a "theme" is a project with `kind = theme`; DECISION D5): name, outcome question ("How do we find the next sea moss?"), client (optional), kind (client, internal, theme), priority rank (leadership drag order), status (on track, behind, waiting, needs budget, researching), lead, members, open roles, dates, cadence, stage (signed in flight, working toward a contract, done).
- **OutcomeMetric** ("How we'll know"): project, name, target, current, status.
- **Milestone:** project, name, start week, end week, status.
- **PlanWeek:** project, week number (1 to 26), calendar mapping (**note:** Forager runs one plan week per working day, DECISION D6), status (done, slipped, current, planned), recap.
- **Goal:** project, name. **Activity** (task): project, plan week, title, owners (many), status (done, in progress, blocked, to do), blocked reason, GitHub issue (repo, number, state), linked docs. **ActivityGoal:** many-to-many (one goal can need many activities, one activity can serve several goals).
- **Artifact:** activity or project, kind (doc, commit, PR, folder, file), URL, state (draft, published), published_at, published_to (client).
- **ProjectRequirement:** project, skill, people needed. Used for cover and "only one who can".
- **OffPlanRequest:** project, requester (can be a client contact), what they asked, detected effect (for example trend model moves from day 10 to day 15), decision (keep plan, accept, discuss), decided_by.
- **Update:** project, author, text, status, posted_at (daily update from the lead).

### Customers and money

- **Client:** name, sector, client since, relationship owner, backup owner, renewal date.
- **ClientContact:** client, name, title, sponsor flag.
- **ClientAsk** (outcome): client, text ("Catch the next sea moss trend"), why it matters, linked projects.
- **Commitment:** client or project (or person, for meetings with officials), direction (we_promised, they_promised), text, owner, due date, linked ask, status (on track, at risk, late, done), source meeting.
- **ActionItem:** commitment (optional), text, owner, done flag, due.
- **Contract:** client, name, type (time_and_material, fixed_price), value, stage (pitch, proposal, pricing, signed), signed_at, expected sign date, start date, renewal date, seats contracted, rate (for T&M), engineers needed.
- **Assignment:** person, contract or project, allocation, start, end. Used to compute staffed seats and capacity.
- **Opportunity** (pipeline summary only): client, name, stage, value, last stage change, last action, next step, owner.
- **Invoice:** client, amount, issued, due, paid_at.
- **RevenueTarget:** quarter, target, expected-to-date curve.
- **HealthSignal:** client, week, signal type (meeting tone, reply time, escalations, sponsor contact, off-plan requests, overdue invoice, days since contact), value, source. **ClientHealth:** client, week, status (healthy, watch, at_risk), computed from signals plus owner confirmation.

### Continuity, operations and growth

- **ContinuityItem:** kind (team, business), severity, title, detail, source (cover rule, monitoring, weather feed, staffing rule, manual), affected project or client, action, status, opened_at, resolved_at.
- **CampusBuild:** site (Kingston, Christiana), % complete, next milestone, date, status.
- **NorthStarMetric:** name (jobs placed, community, GQs taken, hackathon reach, C-suite meetings), period, value, target. **FunnelStep:** step (used Atlas, joined community, took a GQ, verified identity, got a tech job), count, period.
- **Hackathon:** name, date, attendance, partners, status.

### Atlas and documents

- **AtlasMessage:** conversation, author (person or Atlas), text or audio, created_at, channel (app, WhatsApp, voice).
- **AtlasSuggestion:** target (screen or record), text, reasons, sources, status (pending, approved, changed, dismissed), decided_by.
- **AtlasAction:** type (send message, book meeting, assign cover, file document), payload, requested_by, approved_by, executed_at, result, undo_token.
- **Meeting:** title, attendees, started_at, recording ref, transcript ref, summary (Decided, We promised, Next actions), routed_to (documents).
- **OperatingDocument:** scope (person, project, company), subject, Google Doc ID, tabs (one per meeting for person docs).
- **WidgetLayout:** person, screen, ordered widget list, hidden widgets, pinned Atlas cards.
- **AuditLog:** actor, action, record, timestamp, reason. Required for care data reads and all Atlas actions.

---

## 6. Metric definitions and business rules

These are the numbers on screen. Each needs an agreed definition before build. Values in brackets are what the designs assume.

### People

1. **Headcount** for a view = active people in scope (all, or a location tab). All People numbers follow the selected tab.
2. **Breakdown must add up:** headcount = well + not feeling well + on leave + not heard from. "In" vs "remote" is a separate split of those who checked in (Today: 38 in + 4 remote + 6 out + 2 not heard = 50).
3. **Checked in:** a confirmed CheckIn exists for today before the snapshot time. Cutoff for "not heard from" and the coach reminder time (9:00am) are **TBD** (DECISION D8).
4. **On leave / out:** approved Leave covering today. Reason shown to leaders as a category only.
5. **Care requests open:** status not resolved. **First reply time:** average of first_reply_at minus created_at over the week. Target 60 minutes.
6. **Weekly pulse:** mean of PulseResponse scores for the scope and week, shown only when n ≥ 10. Compare with previous week. Show "n of N answered".
7. **Growing skills:** people with a GQ score increase or an Academy course completed in the calendar month.
8. **People okay over last 7 working days:** per day, "okay" if not-feeling-well and not-heard-from are below a threshold (**TBD**).

### Team continuity

9. **Cover gap:** for a project, a required skill where the number of qualified, available people in a date range falls below the requirement. Forager example: data pipeline needs 1, only Kemar qualifies, Kemar on leave days 15 to 19, gap = 1.
10. **"Only one who can":** skills a person holds that no one else on their project holds at "can do" level.
11. **Handover progress:** completed handover action items over total for a planned leave.

### Business continuity

12. **Understaffed T&M contract:** contracted seats minus assigned seats > 0. Weekly cost = empty seats × rate × hours per week (rates **TBD**). Fixed-price gaps are shown amber, not red.
13. **Systems issue:** an open incident from monitoring for a client-facing system. Source **TBD** (DECISION D10).
14. **Weather / national alerts:** from an official alert feed (**TBD**), mapped to people who travel in from affected areas.

### Contracts and revenue

15. **Signed in N working days:** count of contracts with signed_at in the last 22 working days, one bar per day. Working days exclude weekends and Jamaican public holidays.
16. **Revenue this quarter:** recognised or invoiced? **DECISION D9.** Bullet shows value vs quarterly target ($1.4M of $4M) with a tick at expected-to-date ($0.9M). "Ahead" if value > expected-to-date.
17. **Can we deliver:** engineers needed by signed and likely work vs available engineers (6 of 9). **Needed vs available over 8 weeks** = sum of contract or project needs per week vs sum of available engineers after leave.
18. **Close to signing:** opportunities at Proposal, Pricing or with legal, plus signed today.

### Sales activity

19. **Moved this week:** stage change or logged action in the last 7 days. **Stalled:** no movement in N days (design shows 9; threshold **TBD**).

### Customers

20. **Client health:** weekly status from signals. Proposed rule-based score (not AI): days since last contact (warn > 7, bad > 14), average reply time vs 4h target, escalations in 30 days, overdue invoices, sponsor attendance at reviews, off-plan requests. AI meeting-tone is optional and labelled. The relationship owner confirms or overrides weekly through Atlas.
21. **Quiet 14+ days:** last two-way contact more than 14 days ago (email, meeting, WhatsApp).
22. **Renewals in 90 days:** renewal date within 90 days.
23. **Cover (client):** number of people marked as knowing the client well. 1 = warning.

### Projects and plan

24. **Progress:** activity or milestone completion %. **Expected tick:** where the plan says the project should be today.
25. **Plan week status:** done (all activities done), slipped (finished late or carried over), current, planned.
26. **Off plan:** a request or change that moves a milestone date. Effect is calculated from milestone dependencies, not by AI.

### GQ

27. **Role diagnostic average:** mean of area scores, 0 to 100. Bands: Low 0 to 49, Mid-range 50 to 79, High 80 to 100. Percentiles come from the GQ platform. "Not yet assessed" areas are shown, not hidden.

### North Star

28. **Jobs placed:** cumulative placements, monthly pace (62 a month) vs pace needed for the target (about 1,280 a month for 2029, placeholder). Funnel conversion = step count / previous step count.

---

## 7. Atlas: the AI input and assistant layer

**Check first:** Atlas already exists in some form (bot and WhatsApp usage, summaries "formatted by whatever Malik thinks it should be"). Confirm its current architecture, channels and owners before designing new services (DECISION D1).

### 7.1 Input: turning words into records

- **Morning check-in:** "Heading to UWI today, plan is trend ingest, NFR checklist, standup. Bit of a headache." becomes location, start time, plan items and a private note. Use structured output with a fixed schema, a confidence per field, and **one** clarifying question when a field is ambiguous ("UWI, which campus? Mona / Western"). Nothing saves until the person confirms. Show "You said" next to "Atlas saved".
- **Voice:** speech to text, then the same parser. Keep the transcript as the source.
- **Midday wellbeing:** three yes / not yet / no taps. Not AI.
- **Care requests:** "need food" becomes a CareRequest with optional location. Route to the care team, never to leaders.
- **Requests from chat and email** (care team actions): Atlas turns messages into actions and keeps the original link ("From WhatsApp · Alicia · 8:02am · link attached").
- **Projects by talking:** describe a project, Atlas proposes structure and asks one question at a time, quick-reply chips fill gaps, preview before creating.
- **Meetings:** recording or transcript, then summary in three parts (Decided, We promised, Next actions). Commitments and action items become records.
- **Routing to operating documents:** Atlas proposes where each part goes (person document with a new tab for this meeting, project, company) and who to share with. The person confirms. Private notes stay in the person's own document.

### 7.2 Ask Atlas: answering questions

- Example: "Can we cover Forager 2.0 while Kemar is away?" Answer: "Mostly", facts behind it (cover person, handover 2 of 4, due date, what happens if nothing changes), a quote from the source message, and actions.
- Build as an agent with **read-only tools** over the API (people, leave, skills, projects, plan, contracts, clients), never raw database access.
- Every answer must cite records. If data is missing, say so; don't guess.
- Respect the asker's permissions: tools run as the user.
- Atlas mode (H1b) renders answers as cards built from the same components as dashboard widgets, so a card can be pinned to the dashboard as a widget.

### 7.3 Ask Atlas pop-up behaviour

- Opens from the header button, the sidebar field and ⌘K on every screen, plus context buttons (Plan cover, Draft the rest with Atlas).
- Start state: text input with mic, "Suggested for you" (role-specific), "Jump to" (records), footer with privacy line.
- Answer state: question, context chips, answer, facts table, source quote, actions list with shortcuts (↵ for the primary action), footer saying what the primary action will do.
- Draft state: labelled draft, recipients, Send / Change / Book / Mark done.
- Close with esc or click outside. First suggestion swaps to its answer in place.

### 7.4 Suggestions and actions

- Suggestions (for example "Book a check-in with NIRA's new CIO this week, with Ricardo") show reasons and sources, and need Approve / Change / Dismiss.
- Actions in stages: drafts only, then low-risk actions (calendar invite) with approval and undo, then higher-risk ones. Log every approval in AuditLog.

### 7.5 Safety rules

- Never interpret or summarise wellbeing for leaders. Never suggest diagnoses.
- Treat emails, transcripts and documents as untrusted input (prompt injection). They are data, not instructions.
- Label every AI-written string in the UI and in storage.
- Check the AI vendor's data processing terms and retention before sending health-adjacent or client data.

### 7.6 Evaluation

- Check-in parsing: test set of about 100 real messages with expected fields, re-run on every prompt or model change.
- Ask Atlas: question bank with expected answers and sources (target 90%+ correct before launch).
- "This is wrong" control on every AI answer, reviewed weekly.

---

## 8. Integrations and sources of truth

Decide one source of truth per entity (DECISION D3). Every synced record shows its source and freshness on screen.

| System | Used for | Direction | Notes and open questions |
|---|---|---|---|
| Atlas (existing) | Check-ins, care requests, meetings, Ask Atlas | Read and write | Confirm current stack and data store |
| WhatsApp | Check-ins, care requests, sharing summaries, group posts | Read and write | WhatsApp Business Platform? Which groups can Atlas read? Consent |
| Google Calendar | Meetings, leave (if kept here), last contact with clients, sponsor attendance | Read, later write (invites) | Which calendars; service account vs per-user OAuth |
| Gmail | Reply time, last contact, requests to the care team | Read | Scope is sensitive; per-user consent |
| Google Drive / Docs | Operating documents (person, project, company) with one tab per meeting, editing and publishing to clients | Read and write | Confirm Docs API tab support meets the need; folder structure Atlas may create |
| GitHub | Plan activities as issues in private repos, PRs, commits for "recent work" | Read, later write (create issues) | Org, repos, labels for goals and plan weeks, webhooks |
| CRM | Clients, contacts, opportunities, contract stages | Read | **Which CRM?** Pipeline scope (DECISION D2) |
| Accounting / invoicing | Invoices, overdue amounts, revenue | Read | Which system; revenue definition (DECISION D9) |
| HR / leave | People, person type, reporting lines, leave | Read | Which system, or does Atlas own leave requests? |
| Timesheets | Care team reviews weekly timesheets | Read | Which system |
| Travel booking | Care team books flights and hotels | Link out or read | Which agency or tool |
| GQ platform | Assessments, scores, percentiles, strengths | Read (daily) | API available? |
| Academy (LMS) | Course progress and completions | Read | API available? |
| Monitoring / status | "Sprouts store sales API down since 6:10am" | Read (webhook) | Which tool (DECISION D10) |
| Weather / national alerts | Hurricane watch | Read | Official feed (DECISION D10) |
| Campus build | Progress, next milestone | Read or manual via Atlas | Owner and source |
| Zoom / Meet | Recordings and transcripts | Read | Consent to record |
| Anubis's grid component and state machine | Power-user grid, workflow states | Reuse | Call with Anubis before building plan and task states |

---

## 9. Privacy, security and compliance

- **Law:** Jamaica's Data Protection Act applies. Check-in notes, "not feeling well", care requests and pulse are health or sensitive data. Get HR and legal sign-off on a written policy (purpose, who sees what, retention, consent) **before** build.
- **Enforce in the data layer:** row-level security per role. Care data in its own schema or database with separate access. Pulse queryable only through an aggregate view that returns nothing when n < 10.
- **Counts without names:** leader views get aggregate endpoints, not lists with names hidden in the UI.
- **Audit:** log every read of care data and every Atlas action.
- **Retention:** define how long check-in notes, care requests, transcripts and recordings are kept (**TBD**).
- **Consent:** for recording meetings, reading email or WhatsApp, and sharing location in care requests (opt-in per request).
- **Auth:** SSO (Google Workspace likely), MFA for leaders and the care team.
- **Surveillance risk:** start times, location squares and "last contact" can feel like monitoring. G11 removed the "usual start" stat from the lead view for this reason. Keep that line, and commit in writing that check-ins are never used for discipline.
- **AI vendor:** data processing agreement, no training on our data, region and retention settings.

---

## 10. Frontend: design system, components, charts, interaction patterns

### 10.1 Colour tokens ("DPM / Precision", light and dark)

| Token | Light | Dark | Use |
|---|---|---|---|
| p/canvas | #f4f4f5 | #09090b | App background behind panels |
| p/panel | #ffffff | #111113 | Main panel, cards |
| p/panel-2 | #f4f4f5 | #18181b | Table headers, subtle fills |
| p/hover | #ededef | #202024 | Hover, selected action |
| p/line | #e7e7ea | #242428 | Hairlines and borders |
| p/line-strong | #d4d4d8 | #34343a | Empty states, planned, dashed |
| p/text-1 | #111113 | #ededef | Primary text |
| p/text-2 | #52525b | #a1a1aa | Secondary text |
| p/text-3 | #71717a | #80808a | Tertiary, captions, sources |
| p/inverse | #111113 | #ededef | Primary buttons, user chat bubbles |
| p/on-inverse | #ffffff | #111113 | Text on inverse |
| p/accent | #3e63dd | #8da4ef | Links, progress, "this week", remote |
| p/accent-soft | #eef2fe | #172042 | Selected row |
| p/chart-fill | #e4eafd | #1a2350 | Area chart fill |
| p/ok | #18794e | #3dd68c | Healthy, done, well |
| p/ok-soft | #e9f6ef | #0f2a1e | |
| p/warn | #ad5700 | #ffb224 | Watch, gap, slipped, not heard from |
| p/warn-soft | #fff4e5 | #2e2010 | |
| p/bad | #ce2c31 | #ff6369 | At risk, blocked, escalated, losing money |
| p/bad-soft | #feebec | #3b1219 | |
| p/ai | #6e56cf | #b4a4f7 | Anything written by Atlas |
| p/ai-soft | #f4f0fe | #221b3d | AI suggestion and draft backgrounds |
| p/neutral | #a1a1aa | #5a5a63 | Neutral status |

Contrast note: p/text-3 on p/panel-2 in light mode is about 4.4:1, just under AA for small text. Use text-2 on panel-2 surfaces, or darken text-3 slightly.

### 10.2 Spacing and radius

Spacing scale: 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64.
Radius: sm 6, control 8, md 10, panel 12, lg 14, xl 20, 2xl 24, full 999.

Shadows: Card `0 1 3 rgba(13,18,26,0.06)`. Soft `0 1 2 rgba(13,18,26,0.04), 0 8 24 -6 rgba(13,18,26,0.06)`. Raised (pop-ups) `0 16 40 -4 rgba(13,18,26,0.16)`.

### 10.3 Type (one family: Geist)

| Style | Weight | Size / line height | Letter spacing |
|---|---|---|---|
| Display | Medium | 48 / 52 | -3% |
| Metric | Medium | 28 / 32 | -2% |
| Metric small | Medium | 22 / 28 | -1.5% |
| Title | SemiBold | 20 / 26 | -1% |
| Heading | SemiBold | 15 / 20 | -0.5% |
| Body | Regular | 14 / 20 | -0.2% |
| Body medium | Medium | 14 / 20 | -0.2% |
| Label | Medium | 13 / 18 | 0 |
| Caption | Regular | 13 / 18 | 0 |
| Micro | Medium | 12 / 16 | 0 |

Use tabular numbers for all figures and tables.

### 10.4 Components (exist in Figma)

- **Sidebar** (nav item states Default / Active, counts, client list).
- **Header** (path, page, date, view switcher, Ask Atlas button).
- **Status chip:** tones Ok, Warn, Bad, Info, Neutral, AI. A dot plus label.
- **Button:** Primary, Secondary, Ghost, Accent in MD and SM.
- **Avatar:** XS, SM, LG with presence (none, in, remote, out) and initials fallback.
- **Kbd:** keyboard key hint (⌘K, esc, ↵).
- **Annotation** (design-only, ignore).
- Patterns built from these: stat strip (hairline cells), tables with group headers, inspector sections, tabs, segmented switch, source line ("atlas" icon plus caption), AI suggestion block, answer card, command palette.

### 10.5 Charts and visuals to build

| Visual | Where | Spec |
|---|---|---|
| People squares | Today Q1 | One square per person (50), colour by state (in, remote, out, not heard). Hover or click shows the person, if the viewer may see them. |
| Day bars | Today Q2, Contracts | 22 working days, bar height by count, empty days as a short grey stub, today outlined. |
| Bullet bar with expected tick | Revenue, GQ, project progress | Track, fill, 2px tick at expected value. |
| Stacked breakdown bar | People | Segments that must sum to headcount, legend with counts. |
| 1 to 5 scale | Weekly pulse | Track, fill to value, grey tick at last week, end labels. |
| Health squares | Customers, Sprouts | 8 weekly squares coloured by status. |
| Line / area chart | North Star, Contracts capacity | Two series plus gap area; projection as dashed line. |
| Funnel bars | Growth | Horizontal bars with conversion % per step, worst step highlighted. |
| Radar | GQ profile | 4 axes (or more), grid at 25/50/75/100, each vertex and its kite coloured by band, selected point ringed, readout below. |
| 26-week strip | Forager Plan | 26 cells, milestone bands above, status colours, leave overlay as dashed outline, current week outlined. |
| Availability lanes | Forager Team | Person rows across plan days with leave and out blocks, today line. |
| Location strip | Profiles | 13 working days, filled (office), accent (home), outline (planned), dashed (leave). |
| Sparklines | North Star tabs | Small trend lines per metric. |

Decide on a chart library early (D11). Several of these are custom (squares, strips, radar with banded kites) and may be simpler in plain SVG.

### 10.6 Interaction patterns

- **Drill-down everywhere:** counts, chips, segments and rows link to filtered views. Use URL state for tabs and filters.
- **Command palette (⌘K)** as an overlay on every screen.
- **Dashboard / Atlas switch** on Today.
- **Customise:** reorder and hide widgets per person, persisted in WidgetLayout. Pinned Atlas answers become widgets.
- **Jump to section:** chips under the greeting scroll to sections.
- **Inline actions** in lists (Approve, Discuss, Nudge via Atlas, Plan cover, Staff it) with optimistic updates and undo where possible.
- **Drag to reorder** project priority (leadership ranking), with keyboard alternative (⌥↑ / ⌥↓, row menu).
- **Expand "+2 more"** in continuity lines.
- **States for every widget:** loading, empty, partial (show what is known), stale (show "as of" time), error, and "hidden for your role" (say why, don't just vanish).
- **Snapshot time:** the header shows "as of" time. Decide realtime vs periodic refresh (D12).

### 10.7 Layout, locale and accessibility

- Desktop designed at 1440px; define behaviour down to about 1280px and a TV / large-screen mode. Mobile is Atlas chat at 390px (native app, PWA or WhatsApp only? DECISION D4).
- Timezone America/Jamaica. Working days exclude weekends and Jamaican public holidays.
- Currency USD in designs; confirm (JMD for some clients?).
- WCAG AA, keyboard reachable, never rely on colour alone (all status chips have text labels).
- Copy style: plain words, no em dashes, numbers before labels.

---

## 11. Suggested architecture

A starting point, not a decision.

- **Frontend:** Next.js with TypeScript and Tailwind, tokens from section 10 as CSS variables with light and dark themes.
- **Database:** Postgres (for example Supabase) with row-level security per role, a separate schema for care data, aggregate views for pulse with the n ≥ 10 rule, and audit logging.
- **Sync workers:** one per integration (scheduled plus webhooks), writing to the database with source and freshness.
- **Rules engine:** plain SQL or TypeScript for every metric in section 6 (cover gaps, T&M understaffing, health scores, stalled opportunities). No AI in the numbers.
- **Atlas service:** LLM with structured output for parsing, tool-calling for Ask Atlas over a read API, an action queue requiring approval, and evaluation harness. Reuse the existing Atlas if possible.
- **Documents:** Google Drive / Docs for operating documents and published client documents; GitHub for engineering artifacts and tasks.
- **Auth:** Google Workspace SSO, roles stored in the app.

---

## 12. Technical decisions to make

| # | Decision | Options | Current lean | Blocks |
|---|---|---|---|---|
| D1 | Build on the existing Atlas or a new service? | Extend, wrap, rebuild | Extend; review its architecture first | Everything Atlas |
| D2 | Sales pipeline scope | Summary only with CRM link-out; full pipeline in the app | Summary only for now (assumption on the plan page) | Sales activity, Contracts |
| D3 | Source of truth per entity | App database vs external system | App DB for check-ins, care, commitments, plans; external for CRM, invoices, HR, GQ | Data model, sync |
| D4 | Mobile channel | WhatsApp only, PWA, native app | WhatsApp first (people already use it), app later | Check-in adoption |
| D5 | Projects vs themes | One entity with a `kind`; separate entities | One entity, "Projects" in the UI | Data model |
| D6 | Plan cadence | 26 real weeks; 26 plan steps compressed into days (Forager) | Support both: plan steps mapped to dates | Plan tab |
| D7 | What do leaders see per person? | Plan and start time vs in-or-out only | Resolve the conflict between "Who sees what" and "In or out only" | RLS, People table |
| D8 | Check-in timing | Cutoff for "not heard from", reminder schedule, weekends | 9:00am reminder, cutoff TBD | People, Today |
| D9 | Revenue definition | Invoiced, recognised, contracted | TBD with finance | Contracts, Customers |
| D10 | Business continuity sources | Which monitoring tool, which alert feed, manual entry via Atlas | Start with manual via Atlas plus T&M rule; add feeds | Today |
| D11 | Chart approach | Library (Recharts, visx) vs custom SVG | Custom SVG for squares, strips, radar; library for line and area | Frontend |
| D12 | Data freshness | Realtime subscriptions vs polling vs snapshot | Snapshot with "as of" time plus refresh; realtime for care team | Infra |
| D13 | Community and hackathon participants | Records only vs accounts | Records only in v1 | Auth, People |
| D14 | Client access | None; read-only project view for clients | TBD (the call mentioned giving clients "this tool") | Auth, RLS |
| D15 | Task tracking | Build tasks in-app vs GitHub issues as the backbone | GitHub issues, mirrored | Plan tab |
| D16 | Power-user grid | Reuse Anubis's grid component and state machine vs new | Reuse after review | Projects, Plan |
| D17 | LLM provider and hosting | Vendor, region, retention | TBD with legal | Atlas |
| D18 | Health score | Rule-based vs AI-assisted vs owner-set | Rule-based plus owner confirmation, AI tone optional | Customers |
| D19 | Widget customisation scope | Order only; order plus hide; plus pin Atlas cards | Order, hide and pin | Today |
| D20 | Role switching | One account with multiple views vs separate logins | One account, view switcher limited to the person's roles | Header |
| D21 | Retention periods | Notes, care data, recordings, transcripts | TBD with HR and legal | Privacy |
| D22 | Currency | USD only vs per-contract currency | Per-contract with reporting currency | Money |

---

## 13. Questions a developer is likely to ask

**Is the data real?** No. All figures, names, clients and dates in the designs are placeholders that are internally consistent (section 15). Use them as seed data.

**Which Figma page is current?** "Variation H · Call updates". Screens marked "copied from G" are unchanged from Variation G. The page "Plan · Variation H (21 Oct call)" lists what changed and why.

**Do I build Variations A to F?** No. They are earlier explorations.

**Is there a design library?** Tokens, text styles and components are in the file (section 10). No coded library exists yet.

**Can a leader see who is "not feeling well"?** No. Counts only. Names stay with the care team.

**Why does the pulse sometimes show nothing?** Fewer than 10 answers in that scope. Show "Not enough answers to show" rather than hiding the tile.

**What happens when Atlas isn't sure?** It asks one question about the unclear field and saves nothing until the person confirms.

**Does Atlas take actions on its own?** No. Every action is approved by a person. Start with drafts.

**What is an "operating document"?** A Google Doc per important person, project or the company. Person documents get a tab per meeting. Atlas files meeting summaries into them and shares them.

**What is "Forager 2.0"?** The example project: a trend-spotting product for the client Sprouts, running 12 Oct to 6 Nov 2026, day 9 of 26. Most project screens use it.

**What is GQ?** An external skills diagnostic. Scores 0 to 100 per area with percentiles, synced daily.

**What does "cover" mean?** Whether someone else can do a person's job on a project while they are away. Computed from skills, requirements and leave.

**How should "drill down" URLs look?** Not specified. Suggest `/people?location=uwi-mona&state=not-heard`, `/projects/forager-2-0/plan?week=9`, `/customers/sprouts`.

**Is the header date static?** It's the snapshot time. Production should show the data's "as of" time.

**Do we support dark mode at launch?** Tokens exist for both. Light is primary; dark should work but can follow.

**Is there an admin screen?** Not designed (people, roles, locations, clients, rates, thresholds). Needed (section 14).

**What about notifications?** Not designed beyond Atlas messages and the coach reminder. Likely WhatsApp plus in-app. TBD.

**Who owns thresholds** (not heard cutoff, stalled days, health rules, pulse n)? Product, stored as configuration, not hard-coded.

---

## 14. Build phases and acceptance criteria

| Phase | Scope | Move on when |
|---|---|---|
| 0 | Privacy policy signed off; Atlas review; decisions D1 to D3, D7 to D9 | Written policy approved by HR and legal |
| 1 | Auth and roles, People, check-ins through Atlas (WhatsApp first), care requests and care team Today, employee My day, admin basics | 80%+ daily check-ins for a month; care first reply under 60 minutes |
| 2 | Integrations: Calendar, Drive, Gmail (consented), HR / leave, GitHub, CRM, accounting, GQ, Academy | Today's numbers match the source systems |
| 3 | Projects with plans (GitHub-backed), Team tab and cover rules, Customers with rule-based health, Contracts with staffing | Leads stop keeping separate trackers |
| 4 | Ask Atlas (read-only, cited), Atlas mode on Today, pop-ups, widget customisation | 90%+ of the question bank answered correctly |
| 5 | Atlas actions with approval and undo; meeting summaries and operating documents; business continuity feeds; Growth | Actions logged, reversible and approved |

Missing screens to design or build before or during these phases: Lead Today, Well / Weekly pulse trend / Growing detail screens, plan review mode, admin and settings, notifications, sales pipeline (if D2 changes), operating document pages, campus page, empty and error states.

---

## 15. Placeholder dataset (for seed data and tests)

Snapshot: **Tuesday 20 Oct 2026, 9:10am**, America/Jamaica.

- **People:** 50 total. 38 in, 4 remote, 6 out, 2 not heard from (Kemoy Walters, Sasha Brown). Breakdown: 40 well, 2 not feeling well (1 at Main office), 6 on leave (4 vacation, 2 personal), 2 not heard. Locations: Main office 22, UWI Mona 9, Mandeville 7, Remote 4, Out 6.
- **Named people:** Kemar Brown (data engineer, Forager 2.0, reports to Alicia Campbell, checked in 8:45am, on leave 26 to 30 Oct = Forager days 15 to 19, GQ 78/100), Alicia Campbell (lead, Sprouts), Jodian Taylor (intern, covering the pipeline), Nadine Francis (engineer, out), Damian Lewis (intern, remote), Tashana Reid (designer), Andre Mitchell (engineer), Shanelle Grant (care team), Ricardo Henry (engineer), Omari Clarke (intern), Marcus Bailey (designer), Jada Lewis (care request escalated).
- **Care:** 3 open requests (1 escalated, 1 new, 1 in progress), first reply 22 minutes against a 60 minute target, 14 handled this week. Weekly pulse 3.9 (last week 3.7), 44 of 50 answered. Growing skills 31 of 50 (25 GQ, 6 Academy).
- **Forager 2.0:** Sprouts, 12 Oct to 6 Nov, day 9 of 26, 35% progress, handover 2 of 4. Kyle (Sprouts IT) asked to delay the store sales feed, which would start the trend model on day 15 instead of day 10.
- **Contracts:** 9 signed in 22 working days, 1 today (Sante Group data platform, $420k). Revenue $1.4M of $4M this quarter, expected $0.9M by now. Engineers 6 of 9 available, gap of 3. Needed by week: 6, 8, 9, 9, 9, 8, 8, 7. Available: 5, 6, 6, 6, 6, 6, 6, 6. Close to signing: NEPA Phase 2 extension ($260k, with legal, Thu 22 Oct), Sprouts GQ & Academy ($380k, pricing, Thu 29 Oct), Sprouts GCC management services ($1.2M, proposal, Fri 20 Nov). Running: NEPA support T&M 3 of 5 seats ($9k a week unbilled), Sante data platform T&M 0 of 2 (starts Mon 26 Oct), Forager Fixed 4 of 6, PICA Fixed 1 of 1.
- **Clients:** Sprouts (healthy, $520k this quarter, renewal 30 Jun 2027), NEPA (watch, $310k), Sante Group (healthy, $420k), PICA (healthy, $90k, renewal Fri 15 Jan), NIRA (at risk, $40k, no contact for 16 days, $40k invoice 21 days overdue, sponsor changed 2 Oct, renewal Mon 30 Nov), TAJ (watch, $60k, 9 days since contact).
- **North Star:** 1,240 jobs placed of 50,000, pace 62 a month, about 1,280 a month needed for 2029 (placeholder target year). Community 17,000. GQs taken 3,000. Hackathon reach 1,000, next 2,500. C-suite meetings 7 of 12 this quarter.
- **Campus:** Kingston 64% (next: roof complete, Fri 6 Nov), Christiana 12% (site preparation).

---

## 16. Glossary

| Term | Meaning |
|---|---|
| Atlas | Intellibus's assistant. The input layer (chat, voice, WhatsApp) and the Q&A layer. |
| Continuity | Keeping people, teams, the organisation and the business able to function before investing in improvement. |
| Cover | Someone else who can do a person's job on a project while they are away. |
| Gap | A required skill or seat with no available person. |
| Ask | A client's desired outcome, in their words. |
| Commitment | Something we (or they) promised, linked to an ask, with action items underneath. |
| Operating document | A Google Doc per important person, project or the company that collects meetings and context. |
| GQ | External skills diagnostic, 0 to 100 per area. |
| Academy | Intellibus's learning platform. |
| T&M | Time-and-material contract: paid per person per hour, so empty seats lose money. |
| Fixed | Fixed-price contract: paid on deliverables. |
| North Star | The long-term improvement goal: people placed in tech jobs. |
| Snapshot time | The "as of" time for the data on screen. |
| Theme | A project used for broader work (strategy, branding). Treated as a project with `kind = theme`. |
