# Atlas conversational plan: waves 0 and 1 (27 Oct 2026)

**Goes with:** `atlas-conversational-plan.md` (the plan) and `01-update-to-plan-machines.md` sections 15 to 18
**Branch:** `atlas-conv/wave-1`, from `3c94eb2`. Not merged into main. Nothing pushed.
**Status:** built and checked, waiting for review. This file holds what the build found, so the plan and the machines doc can be updated when this branch is merged.

## 1. What was built

| Part | Branch | What it is |
|---|---|---|
| Topic registry | `atlas-conv/topic-registry` | Each question topic in its own files: `domain/topics/<topic>.ts` (id, rule words, prompt line, suggestions) and `queries/answers/<topic>.ts` (the answer). Behaviour unchanged; the prompt was hashed before and after and matched |
| Phase A | `atlas-conv/phase-a-fixed` | Topics my_work, due, updates (with the "since you last asked" cursor), mentions (rule-9 quotes only) and small_talk; the richer single-project answer; the other answer lists everything; follow-ups work with the new topics; prompt `read-6` |
| Phase R | `atlas-conv/phase-r-fixed` | Jamaican English and Patois: prompt guidance (quotes kept exactly, replies in standard English, CD20), Patois hedges in check 4, rule patterns, JA7 in code (`namesProject`), 19 `ja-` eval cases; prompt `read-8` |
| Phase S | `atlas-conv/phase-s-fixed` | Thumbs up or down with "What was wrong?", the "Help improve Atlas" setting (off by default, sidebar account menu), M36 Eval candidate, usage numbers through `pnpm atlas:usage`, migrations 0007 and 0008 |
| Model checks | `atlas-conv/model-*` (13) | M20 to M36 modelled in `research/state-machines/js/models/`, wired into `checks.mjs` |

### Checked

- Each phase was built by one agent, checked by another that had not written it, then fixed: phase A 9 gaps (4 must fix), phase R 10 (3), phase S 14 (2). All must-fix gaps are fixed with tests.
- On `atlas-conv/wave-1`: typecheck and lint clean, 1,032 unit tests pass (809 before), the browser story passes 12 of 12, and all 361 model settings match what they expect.
- Evals: only the new cases were run: 13 of 13 for phase A (on `read-6`), 19 of 19 for phase R (on `read-7`, the 5 changed after the fix on `read-8`). The full eval set has not been run on `read-8`; do that before merging.

### Not built, or left open

| # | What | Why |
|---|---|---|
| W1 | JA8: fixing a transcript before review | M2 has no event for it and A5.6 says a transcript is never edited. Either reword JA8 ("Medium; shown exactly as sent; fixes go in the items") or plan a TRANSCRIPT_FIXED event |
| W2 | CQ9 for lowercase first names | Matching "kemar" in any case would make Mark, Will, Grace or Pat "mentioned" by everyday words ("mark #145 done"). A first name counts only when written with its capital. Needs a decision |
| W3 | LF7 for executives | No executive screen exists; `pnpm atlas:usage --org` prints counts only. Enforce it in the query behind whatever screen executives get |
| W4 | A maintainer role | DPM has none. The numbers and candidate list are a script; whoever runs it names themselves with `--as` |
| W5 | Automatic anonymising (LF3) | ACCEPT refuses text that matches the stored words or contains a real (non-seed) name, but the maintainer writes the anonymised case |
| W6 | Usage numbers for B, F, J, K, L | Those phases are not built |
| W7 | Thumb icons | Not in Figma; drawn in the existing icon style for now |

## 2. Decisions (settled 27 Oct 2026)

| # | Question | Decided | Code to change |
|---|---|---|---|
| W-D1 | Should a lowercase first name count as a mention (W2)? | Yes, unless the name is also a common English word (Mark, Will, Grace, Pat, May, Hope): those still need their capital. A full name counts in any case | `namesPerson` (CQ9): a small list of names that are words |
| W-D2 | JA8: reword, or plan a transcript fix step (W1)? | Reword. The transcript is shown exactly as sent and never edited (A5.6); items from a low-confidence transcript are Medium and need the author's OK; corrections go in the items. Transcription belongs to the Atlas app | None: the plan's JA8 row changes |
| W-D3 | LF8: who sees counts from fewer than 5 people? | DPM maintainers see every count and rate (never words or names). Executives get the strict view: a whole row is hidden when fewer than 5 people are behind it | `usageNumbers` and `pnpm atlas:usage`: suppression only for the executive view (`--org`) |
| W-D4 | Should JA7 also apply to people's names in routing? | Yes, the W-D1 rule: a person's first name ties an item to a project when it is capitalised, or in any case when it is not a common word. Full names in any case | Check 14's tied_person basis uses the same matcher as `namesPerson` |

W2 is closed by W-D1 and W1 by W-D2.

## 3. Corrections for the plan and the machines doc

Found while building; fold in when this branch is merged.

- **CQ14 and CQ15, and `followUpMinutes`:** superseded by section 16. A follow-up reads the conversation's last question whatever the time or an update in between, so "And GQ?" an hour later is still the earlier topic. `followUpMinutes` was not added.
- **Follow-ups keep the words they follow:** a stored question carries `follows`, the asker's earlier questions on the same topic, so "When's the next milestone?" then "and on Store Insights?" keeps "milestone".
- **Updates (CQ5, CQ6):** a new BRAID entry is dated by when it went on the log (the audit move), not its first report; an entry the viewer put on the log is not news to them. The cursor counts only a previous updates answer whose scope covers the one asked now. Sources: notices to them, other people's applied items, status set or cleared, new entries. BRAID reports and resolutions are not listed. No quotes.
- **Small talk** is never sent to Atlas for wording, and does not open or close a follow-up. The server keeps a small_talk question only when the whole message is small talk (CQ13).
- **Rule order without a model:** small_talk, mentions, blocked, due, updates, my_work, project_status, needs_me. Updates does not take review phrasings ("What updates need my review?" stays needs_me).
- **CQ19:** the example dates are on other weekdays in 2026; the code says "forecast Fri 30 Oct, later than its target Wed 28".
- **JA7 in rules:** a message with no capitals at all counts a project name in any case (an older QA8 test); any message with a capital follows JA7. Routing (check 14) is always strict, so "mi done wid forager" goes to choose_project.
- **JA8 and E5:** the plan says "marked low (as today)"; today E5 caps at Medium. E5 is also not applied the same way in two places (`confidenceFloor` lowers only for a low transcript; `confidenceCap` also caps a medium one).
- **"unu", "wen", "weh", "anybody"** ask only with "?", because Patois yes or no questions are shaped like statements.
- **M36 (phase S):** add `logged --OPTED_OUT--> deleted` (same transaction as the setting) and `logged --WITHDRAWN--> deleted` (a thumbs down changed to up). ACCEPT and DISMISS recheck the OK; every final state drops the original words. Once only means one live candidate per cause per answer; a deleted one can be logged again. "What was wrong?" is stored only while the setting is on and cleared when it is turned off. The timer event is EXPIRE.
- **Setup for later waves:** a fresh worktree needs `pnpm exec next typegen` before `pnpm typecheck`.

## 4. Found by the model checks (M20 to M36)

Every machine was modelled as the plan draws it, with a planted bug for each property. 49 findings; each has a fixed variant that passes, in its model. Fold these into the plan before each phase is built.

| Machine | Problem as drawn | Fix that passes |
|---|---|---|
| M20 Chat command | A reply's referent is checked against the answer's old lines, so someone who left the project gets a card naming the record (P10) | Check the referent against their lines now; otherwise "That answer is out of date", naming nothing. CONFIRM checks the right before the version |
| M21 Clarification | A command-only capture has no review, so "handed to review" drops it | Add `asked --TIMER--> closed` ("Nothing was done; ask again") for a capture with no review card |
| M21 | Asked where the message came from (a group), options can name projects others cannot read | Always ask in the author's own chat |
| M21 | choose_project with 4 or more candidates breaks "at most three options" | Ask in the chat only with 2 or 3 candidates; more stay in review |
| M22 Commitment | DONE and DROP only from open, so a check-in still asks after it was done | DONE and DROP from open, due and checking; withdraw any check-in |
| M22 | The same promise said while due makes a second commitment | Match against any live commitment; a new date goes back to open |
| M22 | A promise about #208 saved after #208 is Done or cancelled never hears of it | Read the linked record at save: Done is "No change"; cancelled saves with CM11's question asked |
| M22 | Second check-in and CM11's question not drawn | Draw `checking --TIMER (fewer than the max)--> checking`; a new date restarts the count; CM11's question is a field with ways out |
| M23 Nudge | `sending` has no timer: a lost call waits forever | `sending --TIMER--> retry_wait`; a late SENT is dropped |
| M23 | A retry resends without the guards (left the project, on leave, turned off) | Retry goes back to composing |
| M23 | Two nudges composing at once both pass the daily cap | The cap counts every nudge handed to the app today; checked in the move to sending, with the version |
| M23 | A reply to a nudge still in sending or retry is lost | REPLY from composing, sending and retry_wait too |
| M23 | Once-only sends need the Atlas side to drop a repeated id | Add to the bot plan: outbound messages carry the nudge id (AQ5) |
| M25 Draft | `requested` has no timer | A model timeout counts as DRAFT_FAILED |
| M25 | POST and COPY never check the readers: a standup can post Store Insights work into the Forager group | POST and client COPY check every fact against the readers now; refuse and offer Refresh |
| M25 | DR5's Refresh is not drawn | Draw `ready --REFRESH--> requested` |
| M27 Group answer | A member who lost a right between compose and post still sees the facts | Filter the facts again when posting; fall back to DPM's words if any were dropped |
| M27 | "member list changed, compose again" can loop forever | Filter at post replaces the loop |
| M34 Attributed item | CONFIRM has no guard | The M20 guard and a refused state |
| M26 Group message | GR9 and GR12 branches are only in the table: "Kemar says #145 is done" saves as Alicia's | Draw both branches in M26 |
| M27 | People who join later may see earlier answers (Atlas app history) | Decide with the Atlas spec: history from join, or hide Atlas's answers from later joiners |
| M28 Standup | A skipped timer (leave, turned off) is not drawn: stuck in scheduled | `scheduled --TIMER (rules fail)--> skipped` |
| M28 | Skip and start can both fire after an update today | Skip guard first |
| M28 | STOP with nothing answered sends an empty capture | STOP or last SKIP with nothing answered is abandoned |
| M28 | Kemar's "Done" changes #208 after Alicia took it back (rule 10) | At save, recheck ownership; otherwise an Ask to the owner. This also affects free-form updates |
| M28 | START is not drawn; a skipped day cannot be started | Draw START from scheduled, skipped and none; one per day counts standups that asked |
| M29 Signal | Accepted or expired signals come back every night | Store the level and episode on every answer; raise only if new or worse |
| M29 | A dismissed condition that ends and comes back is never raised | "Worse" is compared within one episode |
| M29 | Stale work goes to the owner, then never reaches the PM | Draw the escalation timer (new `ownerAnswerDays`); start expiry only then |
| M30 Undo | `undoing` can get stuck when a record moves mid-undo | Draw `undoing --> refused`; recheck versions and right in the same transaction |
| M30 | The right is not rechecked when the UNDO arrows run | Same recheck |
| M30 | "Kemar undid this" and refusals name records to people who left | Tell only people who can still open the record |
| M31 Vocabulary | Two waiting proposals for the same alias can both be approved | Recheck the clash at APPROVE |
| M31 | A clash with a project the proposer is not in reveals it | Check clashes only against projects the person told can open; M14 sends real ties to choose_project |
| M32 Outbound ask | A reply after the reminder is dropped (CH3) | `reminded --REPLY--> replied`; a reply after the end is shown, nothing proposed |
| M32 | A resolved subject or a departed asker does not close a reminded chase | Close from sending and reminded too |
| M32 | Losing reach to the person (removed as a contact) leaves the chase stuck | Close from sending, waiting and reminded with "I can't reach Kyle any more" |
| M33 Meeting | A note whose attendees were not told is never read (MT4) | Draw `received --OWN_NOTES_ONLY--> transcribing`, nothing sent to others |
| M33 | Items go to others before unsure speakers are fixed (MT2) | A `held` state in the recorder's review until the speaker is fixed |
| M33 | Decisions reach deciders without the speaker confirming (two confirmations) | Decisions go through the recorder's review first |
| M34 | An attendee not in the project is sent its records; a left member's ask stays | Ask only members; withdraw on leaving |
| M34 | Leave after the ask arrives lets it expire unseen | The timer pauses during leave |
| M35 Cover request | `suggested` has no way out | Withdraw when the leave starts or is cancelled; DISMISS |
| M35 | A declined leave leaves the ask and the handover stuck | Declined counts as cancelled for M35 and M7 |
| M35 | Someone leaving the project leaves the ask open and tells about a project they can't open | Withdraw, nobody told |
| M35 | The same item can be in two open requests | Refuse PICK for an item already asked or covered |
| M36 Eval candidate | A candidate can hold another person's words without their OK | Guard on everyone whose words it holds |
| M36 | No arrow for opting out (LF2) | `logged --OPTED_OUT--> deleted`, same transaction (built) |
| M36 | Original words kept forever after accept or dismiss | Every final state drops them (built) |

## 5. Merging into main

- Main moved on while this ran (`ef1dc1d`, `14c1a05`, `04c9994`, `b2e72ff`). A trial merge conflicts in three files: `app/src/atlas/prompt.ts`, `app/src/queries/chat.ts`, `app/src/queries/review.ts`.
- **Migrations collide.** Phase S adds `0007` and `0008`; the other session has an uncommitted `0007_dependency_expected`. Whichever lands second regenerates its migrations after the other's.
- `research/state-machines/js/checks.mjs` and `results.md` are changed on both sides; re-run `node run-all.mjs` after the merge (several minutes, 361+ rows).
- Run the full eval set on the merged prompt before merging.
