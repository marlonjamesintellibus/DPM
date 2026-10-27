# Use case 1. A daily update reaches the right projects

**Status:** planned. Build steps are in `build-plan.md`. States and edge cases are in `01-update-to-plan-machines.md`.
**Changed 26 Oct 2026** after the briefing in `meetings/2026-10-26-silver-slipper-plaza-3.md`: one update now feeds several projects, and it builds each project's BRAID log, not only the plan.
**Screens:** L18e (capture, phone), L16 (Review my update), L6 (Today, delivery lead). All three need design changes (end of this doc).
**Knowledge base:** A3 core loop, A4 status, A8.2 inbox item, A9.2 extraction review, A10 rules, A11 provenance, C1 capture, C3 tracked status, C4 inbox item, C8 risk log (now BRAID)
**Model checks reused:** `Capture` and `TrackedStatus` in `research/state-machines/js/models`

## Why this one first

A person tells Atlas what they did. That one message is the most common input DPM will get, and it does three jobs:

1. **Updates their own work** across every project they are in (issues, milestones, handovers).
2. **Builds each project's BRAID log** (Blockers, Risks, Assumptions, Issues, Dependencies, Decisions), merging with what others already reported.
3. **Asks the right people to decide**: the PM for risks, the decider for decisions.

It runs the whole core loop (A3) once, with both kinds of confirmation:

```
Capture -> Route -> Extract -> Confirm (accuracy) -> Record -> Evaluate -> Present -> Decide (authority)
Kemar      Atlas    Atlas      Kemar                 store     rules       PMs        Alicia, Andre
```

Meetings (many speakers at once) are use case 2. They reuse everything here and add "who confirms accuracy when four people spoke".

## Two confirmations

| Confirmation | Question | Who | When |
|---|---|---|---|
| Accuracy | "Did Atlas understand me, and file it in the right project?" | The speaker | Before anything is saved (A9.2) |
| Authority | "Does this belong on the log, and do we agree?" | Whoever holds the right for that kind of entry, in that project | After save, for Risks, Assumptions, Dependencies and Decisions |

Nothing reaches any project until the speaker confirms (`NothingAppliedWithoutConfirm` still holds). Blockers and Issues then go straight onto the log as reported. Everything else waits for its decider.

## Who can report and who decides

From the 26 Oct briefing, with gaps answered by Marlon on 26 Oct (decisions S10 to S13 in the machines doc). All rows are now decided.

| Kind | Who can report | On the log when | Who decides | Who resolves |
|---|---|---|---|---|
| Blocker | Any project member | Immediately, as reported | No one; Atlas merges repeats | The person whose work it blocks, or the PM or Lead. Anyone else saying it is cleared makes a proposal to them (decided 26 Oct) |
| Issue | Any project member | Immediately, as reported | No one | PM, Lead or the entry's owner |
| Risk | Any project member | After the PM approves | PM or project lead | PM |
| Assumption | Any project member | After a PM or Lead approves (decided 26 Oct) | PM or project lead | PM or Lead |
| Dependency | Any project member | After a PM or Lead approves (decided 26 Oct) | PM or project lead | PM or Lead |
| Decision | Any project member | Pending until explicitly approved. Never approved by words in a message | 1 approver with the right (PM or Lead), decided 26 Oct. The proposer may approve their own if they hold the right | Superseded by a later decision |

Deciders can **approve**, **decline** (with a reason) or **request more information**. A pending decision never approves itself.

Project roles come from a standard set: **PM**, **Lead**, **Member**. Roles are per project, not per org.

## The story

Snapshot: Tuesday 20 Oct 2026, America/Jamaica. All names are placeholders (KB Part B).

**Kemar's groups** (ASSUMPTION: the KB only places him on Forager 2.0):

| Group | Project | His role | PM | Connected to DPM? |
|---|---|---|---|---|
| Forager 2.0 | Forager 2.0 (Sprouts) | Member | Alicia Campbell | Yes |
| Sprouts Store Insights | Store Insights (Sprouts) | Member | Andre Mitchell | Yes |
| GQ & Academy | GQ & Academy | Member | Alicia Campbell | Yes |
| Data guild | none (a team, not a project) | Member | none | No project to file into |
| UWI Mona study group | none (personal) | Owner | none | Not authorized; never read |

1. **8:58am.** Kemar sends a voice note in Atlas (the messaging app), about 30 seconds: "Finished the TikTok ingest yesterday and the Google Trends connector is done too. Still waiting on Kyle for the store feed, so I think the model slips a day. I'm out from Monday the 26th, and Jodian has the runbook already. On Store Insights, the weekly sales export is fixed, and Andre and I agreed to move the refresh to 6am."
   - The last sentence is new; it is not in the L16 design.
2. **Atlas routes and extracts.** Candidates come only from projects in groups Kemar belongs to whose owner has connected them to DPM. Each card says why it went to that project.

   | # | Project | Kind | Target | Change | Why this project | Confidence | Mark |
   |---|---|---|---|---|---|---|---|
   | 1 | Forager 2.0 | Update | Issue #142 TikTok trend ingest | Already Done | #142 | High | No change |
   | 2 | Forager 2.0 | Update | Issue #145 Google Trends connector | In progress to Done | #145 | High | Ready |
   | 3 | Forager 2.0 | Update | Issue #151 Store sales feed access | to Blocked: waiting on Kyle (Sprouts IT) | Kyle is the contact on #151 | High | Ready |
   | 4 | Forager 2.0 | Update | Milestone Trend model | Forecast 23 Oct to 24 Oct | Kemar owns it | Medium | Needs your OK |
   | 5 | You | Update | Leave Kemar Brown | 26 to 30 Oct | Personal | High | Matches approved leave |
   | 6 | Forager 2.0 | Update | Handover Runbook | Not done to Handed to Jodian | His handover | Low | Needs your OK |
   | 7 | Forager 2.0 | BRAID, same as existing | Blocker "Store sales feed access" | Add Kemar as a source (2 reports) | Same subject as #151 | High | Ready |
   | 8 | Forager 2.0 | BRAID, new | Risk "Trend model may slip to 24 Oct" | Propose to the PM | Same quote as #4 | Medium | Needs your OK |
   | 9 | Forager 2.0 | BRAID, same as existing | Risk "Only Kemar can run the pipeline" | Add evidence: runbook handed to Jodian | Same subject as #5 and #6 | Medium | Needs your OK |
   | 10 | Store Insights | Update | Issue #208 Weekly sales export | In progress to Done | "On Store Insights" | High | Ready |
   | 11 | Store Insights | BRAID, new | Decision "Move the daily refresh to 6am" | Propose to the decider | "On Store Insights" | High | Ready (as a proposal) |

   - Kemar's chat (L18e): "Got it. 9 updates for 2 projects; 4 need your OK."
   - "The store feed" could mean Forager or Store Insights. Kyle settles it: he is the contact on #151.
3. **9:02am.** After standup, Alicia sets Forager 2.0 to Off track. She gives no reason.
4. **9:10am.** Kemar opens Review my update, grouped by project. He accepts #4, #8 and #9, edits #6 ("Handed to Jodian"), and saves. 9 changes are saved; #1 and #5 change nothing.
5. **Rules and routing run.**
   - Forager 2.0: the trend model milestone is At risk; Forager is calculated At risk.
   - The blocker "Store sales feed access" shows 2 reports (Alicia, 6 days ago; Kemar, today).
   - A new risk waits for Alicia, and the pipeline risk gains new evidence.
   - Store Insights: #208 is Done. A decision is pending for Andre.
   - BRAID entries are categories, so none of them changes a calculated status (A4.1, P6).
6. **Alicia's Today (L6)** shows:
   - Item 1: "Forager 2.0 is set Off track, but the plan says At risk" (unchanged from the design).
   - Item 2 (new): "Kemar raised a risk: Trend model may slip to 24 Oct. Add to the risk log?" She approves it.
   - Back on item 1, Atlas drafts a reason from the BRAID log. She saves it linked to the blocker and the risk she just approved. Both items close.
7. **Andre's Today** shows "Kemar proposed a decision for Store Insights: move the daily refresh to 6am", with Approve, Decline or Ask for more. He approves, and the decision is on the Store Insights log with Andre as approver and Kemar's words as the source.
8. **What each person can see:**
   - Alicia sees the Forager quotes from Kemar's note, never the Store Insights sentence.
   - Andre sees only the Store Insights sentence.
   - Only Kemar sees the whole note.

## Acceptance criteria

Routing and visibility
- [ ] Candidates come only from projects in groups the speaker belongs to and whose owner has connected them to DPM.
- [ ] Each item shows its project and why it was routed there. Explicit references (issue numbers, project names) win over guesses.
- [ ] An item that fits two projects is marked "Choose a project". Save is refused until Kemar picks one or keeps it private.
- [ ] An item that fits no project stays private to the speaker ("Not filed") and can still be saved.
- [ ] Moving an item to another project re-runs the server checks for that project.
- [ ] Project members see only the quotes routed to their project. The full capture is visible only to its author.
- [ ] Nothing is ever filed into a project the speaker is not a member of, or across an org boundary.

Capture and review (C1, A9.2)
- [ ] A capture is stored as received and never edited. Items point into it by character range; one quote can feed several items.
- [ ] Each item has project, kind, target, field, old value, new value, source span, confidence, and a mark.
- [ ] High confidence items that match known facts are ready but still shown. Medium and Low are never ready by default (`NoAutoAcceptBelowHigh`).
- [ ] Save is disabled while any item needs an OK or a project. The footer says how many.
- [ ] Nothing changes in any project until Save (`NothingAppliedWithoutConfirm`).
- [ ] Saving twice, or the same capture from two channels, applies each item once (`AppliedAtMostOnce`, with dedup on).
- [ ] Every applied change writes an audit entry with actor, time, capture and source span (A11).
- [ ] Hovering a highlight in "What you said" highlights its cards, and the other way round.
- [ ] What the server checks refused, and words that fed nothing, are shown to the author only, with the reason in plain words (machines doc section 20, U1).

BRAID
- [ ] Each BRAID item says whether it is new or the same as an existing entry. Kemar can reject the match, and it becomes a new entry.
- [ ] A merged report adds a source; the entry shows its report count and every source.
- [ ] Blockers and Issues go on the log when saved. Risks, Assumptions and Dependencies wait for the PM or Lead. Decisions wait for an approver.
- [ ] A decider can approve, decline with a reason, or request more information. Each creates an audit entry and tells the reporter.
- [ ] A Decision is never approved by words in a message ("we agreed", "approved").
- [ ] Atlas never creates BRAID entries about a person's health, or judgements of a named person.
- [ ] BRAID entries never change a calculated status.

Status (A4, A10.2, C3)
- [ ] Statuses come from rules only (P6). Atlas never computes one.
- [ ] Roll-up is worst child: Off track > At risk > On track > Not started > Done.
- [ ] Setting a status that differs from the calculated one opens an inbox item for the owner (`ReasonRule`).
- [ ] Saving a reason links it to at least one BRAID entry that is on the log (not still proposed) and closes the item.
- [ ] If calculated and set agree again, the item auto-closes. If the plan moves after a reason, the reason is marked stale (S1).

Inbox and views (A8.2, A7)
- [ ] Each inbox item shows title, why here, source and age, and one primary action.
- [ ] "View as" (L0) switches between Kemar, Alicia and Andre. Each sees only their own Today and only their projects.

Atlas
- [ ] Extraction runs through OpenRouter when `OPENROUTER_API_KEY` is set, and from a recorded fixture otherwise. Tests always use the fixture.
- [ ] Message text is treated as data, never as instructions (A9.3).
- [ ] A target or project that is not in the candidate list is dropped, not invented.

## Rules used in this slice

Marked ASSUMPTION where the knowledge base does not decide it. Each is one constant in `app/src/domain/config.ts`.

| Rule | Definition |
|---|---|
| Milestone | Done if done. Off track if forecast is more than tolerance after target. At risk if forecast is after target. On track otherwise. Tolerance is OPEN (F10); ASSUMPTION 3 calendar days. |
| Work item | Done if done. Off track if past due and not done. At risk if blocked (ASSUMPTION). Not started if to do. On track otherwise. |
| Thread | Worst of its milestones and work items. |
| Project | Worst thread. A set status with a reason wins for display (A4.3). |
| BRAID entries | Categories, never statuses (A4.1). They explain statuses through reasons; they do not compute them. |
| Set status expiry | OPEN (F3). Proposed `when_done` plus `reason_stale`, model checked 26 Oct: clears when calculated equals set or is Done; if calculated moves while a reason stands, the reason is marked stale. `on_any_change` would clear Alicia's Off track when Kemar saves, so this story would break (it fails `SetStatusRespected`). See the machines doc, M9. |

## Out of scope for this slice

- Meetings with several speakers (use case 2)
- Check-in and check-out as scheduled prompts. This update works the same whenever it arrives; the 9am and end of day prompts come next.
- Real voice capture, transcription and the Atlas messaging app API (captures are seeded or typed in DPM through the same `createCapture` command; build plan B8)
- GitHub integration (records are seeded as if synced)
- Executive and care team Today screens (L3, L4, L8), Dashboard and Table views
- Atlas asking one clarifying question (C1 needs_clarification). Routing ambiguity is resolved on the review page instead.
- Assigning project roles in the UI (roles are seeded)
- Auth. "View as" stands in for sign-in, as in the prototype.

## Design changes (Figma)

**Done 26 Oct 2026** in the Variation L page, next to the originals, which are kept: L16b (`248:5355`), L6b (`253:5471`), L6c Andre's Today (`254:5614`), L14b BRAID log (`255:6227`) and L18f chat (in the L18 section). All are built from the file's own D/ components, variables and text styles. The list below is what they cover.

1. **L16 Review my update:** group cards by project, with "You" for personal items and "Not filed" for the rest. Each card needs a project chip with "why this project", a way to move it, a kind label (Update, or the BRAID kind), and for BRAID items "New" or "Same as: …" with a reject-match control. Footer: "9 updates for 2 projects. 4 need your OK."
2. **L6 Today (delivery lead):** an approval item for proposed risks (Approve, Decline, Ask for more). The reason box links BRAID entries, not only "risk log" entries.
3. **New: decider's Today item** for a pending decision (Andre).
4. **New: project BRAID view** with six kinds, report counts, sources, pending approvals and conflicts. L14 shows a risk log only.
5. **L18e chat:** the reply counts projects ("9 updates for 2 projects; 4 need your OK").

## Questions this slice raises

1. L16 marks High confidence updates "Applied" before Save, while A9.2 says nothing reaches the plan until the person confirms. This plan says "Ready". Is that the right word?
2. #151 is "blocked for 6 days" in L6 but becomes Blocked through update 3 in L16. Which system first marked it blocked: GitHub, or Kemar's note?
3. L16 shows "Sat 24 Oct" as the new forecast. Should forecasts snap to working days?
4. Should a Blocker entry and a work item's Blocked state stay separate (this plan), or be one thing?
5. Is an action someone is assigned in conversation a work item, a BRAID entry, or both?
