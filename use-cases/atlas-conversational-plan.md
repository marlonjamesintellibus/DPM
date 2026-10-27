# Atlas conversational plan

**Goes with:** `01-update-to-plan-machines.md` sections 15 (questions in the chat), 16 (conversations), 17 (the message flow) and 18 (talking to Atlas about your work); `atlas-bot-plan.md` (the DPM bot in Atlas)
**Vocabulary:** the shapes in `research/state-machines/js/map-data.mjs` (Thing, Job, Ask, Switch, Stage, Status rule)
**Status:** plan, written 27 Oct 2026 to come back to; phases I to S added the same day. **Phases A, R and S are built** (wave 1, merged 27 Oct 2026; `atlas-conversational-wave-1.md` is the build report), and **B, C and L** (wave 2; `atlas-conversational-wave-2.md`). Every other phase is plan, and its section ends with what the model check of its machines found: fix those before building it. Items marked DECIDE were settled on 27 Oct 2026 (section 24): each takes its default unless section 24 says otherwise. New machines continue the numbering after M19 (M18 Conversation and M19 Atlas account link are taken), so they are M20 to M36 and are model checked in `research/state-machines/js` before any code.

Atlas today reads updates, answers questions in conversations, follows up ("and on Store Insights?"), words its answers over DPM's facts, and shows cards with Accept (sections 15 to 17). This plan goes from "a search box you type into" to a teammate: Atlas answers, lets you act on the answer, explains why, speaks first when something needs you, keeps track of what you promised, drafts what you would otherwise write, and asks when it is unsure. Then it moves from one person to the team: it works in the project group, runs the standup with you, spots trouble before anyone reports it, chases people for you, handles meetings and leave, and learns from how it is used.

## 1. Rules every phase keeps

From section 1 of the machines doc, and the ones that matter most here:

1. **Atlas asks, people answer.** Nothing Atlas says in the chat changes a record. A change is always a proposal or a one-tap confirm by a person with the right.
2. **Facts come from DPM.** Atlas says what was asked, or phrases facts DPM gives it. It never writes a number, date, name or status of its own; drafts are checked against the facts they were given.
3. **You see only what is yours (P10).** Every answer, nudge and draft is built through the per-viewer queries. Something you cannot open is never named, counted or hinted at, not even "there is something you can't see".
4. **Permission is checked when it runs,** not when the answer or button was shown. Answers are snapshots ("as of 9:41am"); acting on one rechecks rights and versions.
5. **Nothing gets stuck.** Every waiting state (a confirm, a clarification, a check-in) has a timer or a named way out.
6. **Once only.** Every button, nudge and command carries an id. A repeat changes nothing.
7. **Quiet by default.** Atlas speaking first is rationed (a daily cap, quiet hours, leave) and every kind of nudge can be turned off.
8. **Every reader may see every fact.** An answer, draft or summary goes only where everyone who will read it may see each fact in it. In a group that is what every member can see; in a client draft it is what the client view shows.
9. **Outward is confirmed.** A message to someone else (a chase, a post, a request to cover) is sent only after the person it comes from confirms it.
10. **Your word changes only your records.** Something said about another person (in a meeting, in a group) changes nothing of theirs until they confirm it.

## 2. Phases at a glance

| Phase | What it gives | New machines | Waits on |
|---|---|---|---|
| A | Answers about your work: my work, due, updates, mentions, small talk (follow-ups are built, section 16) | none | none |
| B | Act from an answer: more actions on cards (Accept is built, section 17), and "approve the Kyle risk" as a reply | M20 Chat command | A |
| C | Ask why: why a status, what holds something up, when something was decided | none (reads only) | A; status rules must explain themselves |
| D | Ask when unsure: Atlas asks "#208 or #212?" in the chat instead of a review card | M21 Clarification | A |
| E | Commitments: "I'll send Kyle the request tomorrow" is tracked and checked on | M22 Commitment | D for check-ins in the chat; F for check-ins in the Atlas app |
| F | Atlas speaks first: morning brief, mention alerts, due-date checks, missing-update reminders | M23 Nudge, M24 Nudge settings | the DPM bot in Atlas (`atlas-bot-plan.md`; AQ5: can the bot send first?) |
| G | Drafts: my standup, a client status, a weekly summary | M25 Draft | A; posting waits on B8, B9 (copying does not) |
| H | Ask about people: "What is Kemar working on?" | none (reads only) | a decision on what a viewer may see of someone else |
| I | Atlas in the project group: group messages become updates, "@Atlas what's blocked?" answered for the whole group | M26 Group message, M27 Group answer | the DPM bot in Atlas, in group chats |
| J | Standup with Atlas: two to four short questions from your open work | M28 Standup | F (to start it); in the DPM chat it works without |
| K | Signals: Atlas spots trouble nobody reported and proposes a risk | M29 Signal | A |
| L | Undo, "why did you file that?", and corrections that teach Atlas | M30 Undo, M31 Vocabulary change | A |
| M | Chasing people for you: "Ask Kyle if the feed access is sorted" | M32 Outbound ask | the DPM bot in Atlas |
| N | Questions for leads and executives: who hasn't updated, what needs my decision, what's at risk this week | none (reads only) | A; "who's free" waits on H |
| O | Meetings: a meeting note becomes everyone's updates, each confirmed by its owner; "Prep me for the Sprouts call" | M33 Meeting capture, M34 Attributed item | E, G |
| P | Leave and handover in the chat: "I'm off next week", cover, "Catch me up" | M35 Cover request | A, E; suggestions wait on H |
| Q | "What is Forager?" for new joiners | none (reads only) | A |
| R | Jamaican English and Patois, in reading, rules, transcription and evals | none | runs alongside every phase |
| S | Learning from use: feedback, "can't answer" log, eval candidates, usage numbers | M36 Eval candidate | starts with A |

Suggested order:

1. **A** with the `due` topic, and **S** (logging and numbers) and **R** (eval cases) from the first day.
2. **B**, **C** and **L** together: act, explain, undo. These make Atlas trusted.
3. **D**, **J** (in the DPM chat), **K**, **N**, **Q**.
4. **E**, **G**, **O**, **P**.
5. Once the DPM bot in Atlas is built (`atlas-bot-plan.md`): **F**, **I**, **M**, and **J** started by Atlas.
6. Once phase H's rule is decided: **H**, then "who's free" (N) and cover suggestions (P).

## 3. Phase A. Answers about your work

Planned in section 18 of the machines doc (topics my_work, updates, mentions, small_talk; richer project_status; edge cases CQ1 to CQ16). Already built before it: answers as cards with "as of" and Accept, Atlas's wording over DPM's facts, and suggested follow-ups (section 17); conversations, whose earlier messages are how follow-ups and later phases know what "the second one" or "that risk" means (section 16).

### Built (wave 1)

Built with the `due` topic below; see section 18 of the machines doc (Built, G51 to G55). Follow-ups are section 16's, so CQ15 and `followUpMinutes` are superseded.

### Added: the `due` topic

"What's due this week?", "When's the next milestone?", "Anything due tomorrow?"

- Answer: their work items due in the window that are not Done, and the next milestones (by forecast) on their projects, each with its status. Window: the words say it ("today", "tomorrow", "this week", "next week"); default this week, Monday to Sunday in the org time zone.
- Named project: that project's milestones and due work, all owners, still only what they can read.

| # | Case | Expected |
|---|---|---|
| CQ17 | "What's due this week?" on a Friday | Today to Sunday, and anything already past due and not Done, marked "late" |
| CQ18 | "When's the next milestone?" with none left | "No milestones left on Forager"; never a milestone from another project |
| CQ19 | A milestone whose forecast and target differ | Gives the forecast and says it is later than the target ("Thu 30 Oct, target Tue 28") |

## 4. Phase B. Act from an answer

### What changes

- **Buttons on answer lines.** A line about something you can act on carries the same action its screen offers: Approve or Decline (a BRAID proposal you decide), Mark done or Unblock (your work item), Give a reason (a status set with no reason), Open review (an update waiting). The button runs the screen's own server action.
- **Acting in words.** A reply that refers to the open answer ("Approve the Kyle risk", "Mark the second one done", "Push the trend model to Friday") is read like any update, with the open answer's lines given to Atlas as the things it may refer to.
  - Changes to records (state, forecast, due date) become normal proposals and go through review.
  - Decisions that belong to a person with a right (approve, decline, resolve, give a reason) cannot be proposals that someone else reviews; they become a **chat command**: a one-tap confirm card ("Approve risk 'Store sales feed access' on Forager?" [Approve] [Cancel]).

### M20. Chat command (Ask). NEW

```
proposed ──CONFIRM (guard: right held now, record version unchanged)──▶ done        final
proposed ──CONFIRM (guard fails)──▶ refused                                          final, says why
proposed ──CANCEL──▶ cancelled                                                       final
proposed ──TIMER command_expiry (DECIDE: 30 minutes)──▶ expired                      final
```

- The command stores the action, the subject, the version seen, and the answer it came from.
- `done` runs the same command the screen runs, in its transaction, and audits with `captureId` so the trail shows it came from the chat.
- A button on an answer line is a command that is confirmed in the same tap (no card), with the same guard.

### Edge cases (AC1 to AC10)

| # | Case | Expected |
|---|---|---|
| AC1 | They lost the right between the answer and the tap (role changed, left the project) | Refused: "You can no longer approve this." Nothing changes |
| AC2 | Someone else approved it first | Refused: "Alicia approved this at 9:52am." A fresh answer is offered |
| AC3 | The record changed since the answer (version moved) | Refused with what changed; never acts on the old picture |
| AC4 | Double tap, or the same command sent twice | Once only: the second does nothing |
| AC5 | A button on an answer from three days ago | Same guard; works if nothing changed, refused otherwise. The answer still says "as of" its time |
| AC6 | "Approve the second one" when the open answer has one line, or none | Not a command; Atlas asks which (phase D), or says there is no open answer |
| AC7 | "Approve the Kyle risk" matches two lines | Clarification (phase D) with both as options |
| AC8 | "Approve all of them" | DECIDE: one card per line (default), never one tap for many decisions |
| AC9 | A command on a project they cannot read (the injection case) | The referent is checked like `checkQuestion`: not in their lines, not a command |
| AC10 | The card expires unanswered | Expired, nothing changes, the answer stays as it was |

### Model check (27 Oct 2026): fix before building

- M20: check a reply's referent against the asker's lines **now** (the per-viewer query again), not the answer's old lines; if it is no longer theirs to read, it is not a command ("That answer is out of date. Ask again."), naming nothing.
- M20: CONFIRM checks the right before the version (AC1 before AC2 and AC3), so someone who left is never told who decided.

### Built (wave 2)

See `atlas-conversational-wave-2.md`. Card actions run each screen's own command (Mark done and Unblock through the new `commands/work.ts`); typed replies become M20 confirm cards; AC6 and AC7 answer "Say it again with its name" until phase D. Open: W2-D2 and W2-D3.

## 5. Phase C. Ask why

### What changes

A new topic `why`, with a subject: a project, work item, milestone, BRAID entry or decision. Atlas says the subject (an id from the lists it is given, checked like `projectId`); DPM walks the links it already keeps.

| Asked | Answer, from |
|---|---|
| "Why is Forager at risk?" | The displayed status and where it comes from. A set status: who set it, when, the reason, the BRAID entries linked to it, and whether the plan has moved since (stale). A calculated status: the facts that made it (the milestone and how far past target its forecast is, the blocked work) |
| "What's holding up the trend model?" | Its blocked work, the blocked notes and links, open blockers and dependencies linked to it, and who owns each |
| "When did we decide to drop the TikTok scrape?" | The decision entry: who approved it and when, and the words it came from when the quote is visible to them (rule 9) |
| "Why was #145 moved to Friday?" | The audit trail for that field: who changed it, when, and the update it came from (quote only if visible) |

### Needed first

- **Status rules explain themselves.** The calculated status (M12) returns its contributing facts, not only the status. This is a change to the rule functions, checked by the existing status tests.

### Edge cases (WY1 to WY8)

| # | Case | Expected |
|---|---|---|
| WY1 | The subject is in a project they cannot read | Treated as no subject; answered as "I can't find that in your projects" without saying whether it exists |
| WY2 | The status is On track and they ask why it is at risk | Says what it is and why ("Forager is On track: every milestone is within 3 days of target") |
| WY3 | The reason is stale | Gives the reason and says the plan has moved since ("given when the plan said At risk") |
| WY4 | A decision search matches several entries | Lists up to three, newest first, each linked |
| WY5 | The decision came from someone's update routed to another project | Decision shown, quote not shown (rule 9) |
| WY6 | A field changed by a rule, not a person (target passed) | Says the rule did it and when |
| WY7 | Nothing links to the subject | Says so plainly ("Nothing is recorded as holding it up") rather than guessing |
| WY8 | "Why" about a person ("Why is Kemar late?") | Not a why question about a record; answered as phase H or "I can tell you about records, not people" |

### Built (wave 2)

See `atlas-conversational-wave-2.md`. M12 returns its facts; topic `why` with a checked subject; work item forecasts (U6) are among the facts. WY2's example and WY5 are corrected there.

## 6. Phase D. Ask when unsure

### What changes

When Atlas is unsure which project or record a message means, it asks in the chat ("Do you mean #208 Store sales feed or #212 Feed monitoring?") with the options as buttons, instead of only leaving a "choose a project" card in review. Today's review card stays as the fallback.

### M21. Clarification (Ask). NEW

```
(none) ──CHECKS_DONE (guard: an item is choose_project or has 2 or 3 close matches)──▶ asked
asked ──ANSWERED(option)──▶ resolved            the item is routed or matched; review shows it as chosen
asked ──ANSWERED(not an option)──▶ asked        the reply is read as a new message; the question stays
asked ──REVIEW_OPENED──▶ handed_to_review       the review card holds the choice
asked ──TIMER clarify_expiry (DECIDE: 2 hours)──▶ handed_to_review
asked ──capture expires or is rejected──▶ closed
```

- At most one clarification per capture; the item with the most at stake is asked about (DECIDE default: the first in the message).
- At most three options, each a record or project the author can see. Never an option the checks would refuse.
- Lives inside the capture's review (M2 `proposed`), so it adds no new way for a capture to get stuck.

### Edge cases (CL1 to CL8)

| # | Case | Expected |
|---|---|---|
| CL1 | They reply with a new update instead of answering | Read as a new capture; the question stays open until its timer |
| CL2 | They type the answer ("the monitoring one") | Read against the options only; no match, the question stays |
| CL3 | They opened the review first | Handed to review; the chat question shows "Chosen in review" |
| CL4 | Two captures each have a question open | Buttons carry the capture id; a typed answer goes to the newest |
| CL5 | One of the options was cancelled or they left its project before they answered | That option is refused at answer time (rule 4); the others still work |
| CL6 | The capture expires (7 days) | Closed with it |
| CL7 | Voice message | Same: the question is asked in text after the transcript |
| CL8 | No model connected | No clarification (the rule path makes no proposals) |

### Model check (27 Oct 2026): fix before building

- M21: a capture that holds only a command has no review card, so add `asked --TIMER clarify_expiry--> closed` ("Nothing was done; ask again") for it, and let CHECKS_DONE cover a command that matches 2 or 3 answer lines.
- M21: the question is always asked in the author's own chat, never in a group (rules 3 and 8).
- M21: ask in the chat only when choose_project has 2 or 3 candidates; with more, only the review card asks.

## 7. Phase E. Commitments

### What changes

"I'll send Kyle the access request tomorrow" is a promise, not a status change. Atlas proposes it as a **commitment** (a new item kind, reviewed like any other). Once saved, DPM checks on it when it is due: "Did you send Kyle the access request?" A later update that says it was done ("Sent Kyle the request") is proposed as done.

### M22. Commitment (Ask, then Stage). NEW

```
proposed (an item in the capture's review, M3) ──SAVE──▶ open
open ──DONE (the owner says so, or a linked work item is Done)──▶ done            final
open ──DROP (the owner)──▶ dropped                                                 final
open ──TIMER due (end of the due day, their time zone)──▶ due
due ──CHECK_IN_SENT──▶ checking
checking ──REPLY done──▶ done
checking ──REPLY new date──▶ open (due date moved, moves counted)
checking ──REPLY drop──▶ dropped
checking ──TIMER no reply after config.commitmentCheckIns check-ins──▶ lapsed       final, shown to the owner only
```

- Private to its owner by default, like a capture (DECIDE: private only, or shown on the project when it names a record there).
- Linked to a record or BRAID entry when the words name one ("the access request for #208"), so the project can show "Kemar said he'd send it by Tuesday" if DECIDE above allows.
- Check-ins go through phase F when it exists; until then they are notices in the chat plus an inbox item.

### Edge cases (CM1 to CM12)

| # | Case | Expected |
|---|---|---|
| CM1 | No date ("I'll look into it") | DECIDE: due next working day (default), or not a commitment |
| CM2 | Vague date ("next week", "end of month") | Resolved by `domain/dates` against when it was said; shown on the card to correct in review |
| CM3 | A promise about a record's dates ("I'll finish #151 tomorrow") | A forecast or due date update, not a commitment |
| CM4 | A promise for someone else ("Jodian will send it") | Not a commitment for the speaker; DECIDE: nothing (default) or proposed to Jodian as an Ask |
| CM5 | The same promise twice | Matched to the open one, like a BRAID same-as; the date is updated, not duplicated |
| CM6 | Done in a later update | Proposed as done in that update's review |
| CM7 | Due during their leave | The check-in waits until the first working day back |
| CM8 | Due on a weekend | Checked on the next working day |
| CM9 | They leave the project it is linked to | Kept as their own; the link to the project's record is dropped |
| CM10 | Moved many times | Counted; after 3 moves the check-in asks whether to drop it (DECIDE) |
| CM11 | The linked work item is cancelled | The commitment asks once whether it still stands |
| CM12 | "What did I promise?" | A new topic `commitments`: their open and due commitments |

### Model check (27 Oct 2026): fix before building

- Section 20 of the machines doc already sets the author's own promise aside as "a promise; commitments come later" and turns someone else's promise into a dependency with a date (U2). Phase E picks up those set-aside promises.
- M22: DONE and DROP (the owner's word, a done item in an update, the linked work item going Done) from open, due and checking; withdraw any check-in that is out.
- M22: match the same promise against any live commitment (open, due or checking); a new date moves it back to open, counted as a move.
- M22: read the linked record at save: a promise about a Done work item saves as No change; one about a cancelled work item saves with CM11's question already asked.
- M22: draw `checking --TIMER (fewer than commitmentCheckIns sent)--> checking`; a new date restarts the count; CM11's question is a field that any reply answers.

## 8. Phase F. Atlas speaks first

### What changes

Atlas sends messages to people without being asked, in the Atlas app (and in the DPM chat):

| Kind | When | Says |
|---|---|---|
| Morning brief | Each working day at their start time (DECIDE: 8:30am their time) | What needs you, what changed since yesterday, what is due this week. Skipped if empty |
| Mention alert | When a report that names them is saved and its quote is visible to them | "Alicia mentioned you on Forager: 'waiting on Kemar for the store feed'" |
| Due-date check | A work item of theirs is past due with no change that day | "Is #151 still on for today?" A reply is an update about #151 |
| Missing update | Late on a working day (DECIDE: 4pm) with no update from them and open work | "What did you get done today?" |
| Commitment check-in | Phase E | "Did you send Kyle the access request?" |

### M23. Nudge (Job). NEW

```
scheduled ──TIMER send_at──▶ composing
composing ──(guard: still true, not on leave, within working hours, under the daily cap, kind turned on)──▶ sending
composing ──(guard fails)──▶ skipped                                         final, reason logged
sending ──SENT──▶ sent
sending ──SEND_FAILED──▶ retry_wait ──TIMER──▶ sending   (config.nudgeMaxTries, then failed, final)
sent ──REPLY (a capture within config.nudgeReplyHours)──▶ replied            final; the reply is read with the nudge as context
sent ──TIMER nudgeReplyHours──▶ unanswered                                   final
```

- One nudge per (person, kind, subject, day): a repeat event changes nothing.
- The facts are read again at `composing`, so a nudge about something already fixed is skipped, not sent.
- A reply is read with the nudge as its context, so "yes, still on" after a due-date check is an update about that work item.

### M24. Nudge settings (Switch, per person per kind). NEW

On or off per kind, plus their start time. Defaults (DECIDE): brief on, mention alerts on, due-date checks on, missing-update reminders off, commitment check-ins on. Leads cannot change other people's settings.

### Edge cases (PN1 to PN12)

| # | Case | Expected |
|---|---|---|
| PN1 | On leave | Skipped; the first brief back covers the time away (up to 7 days) |
| PN2 | Weekend or public holiday | Skipped (DECIDE: org calendar, default weekends only) |
| PN3 | The work item was updated between scheduling and sending | Skipped at composing |
| PN4 | Five things happen in an hour | The daily cap holds (DECIDE: 4 a day); mention alerts after the cap roll into the next brief |
| PN5 | The Atlas app is down | Retried, then failed; the DPM chat still shows it |
| PN6 | They reply to an older nudge after a newer one | The reply goes to the nudge it quotes (Atlas message id); otherwise the newest unanswered nudge |
| PN7 | A mention in words routed to a project they are not in | No alert (CQ8) |
| PN8 | They turned a kind off | Skipped; the setting is read at composing, not scheduling |
| PN9 | They left the project the nudge is about | Skipped |
| PN10 | Their time zone differs from the org's | Times are in theirs (DECIDE: org zone until people have one) |
| PN11 | The brief would be empty | Not sent |
| PN12 | A reply to a nudge that is also an update about something else | Read as a normal update; the nudge context is only a hint |

### Model check (27 Oct 2026): fix before building

- M23: `sending --TIMER (send timeout)--> retry_wait`; a late SENT for an attempt that timed out is dropped.
- M23: a retry goes back to composing, so the guards and the facts are read again (leave, left the project, kind turned off).
- M23: the daily cap counts every nudge handed to the app today, whatever its state, and is checked in the same transaction as the move to sending, with the version.
- M23: a reply that quotes a nudge answers it from composing, sending and retry_wait as well as sent.
- M23: once-only sends need the bot to send the nudge id and drop a repeat; add it to `atlas-bot-plan.md` (AQ5).

## 9. Phase G. Drafts

### What changes

Atlas drafts text from DPM's facts; the person edits it and copies or posts it.

| Draft | For | Facts given to Atlas |
|---|---|---|
| My standup | Anyone | What they saved since their last standup, what is in progress, what is blocked, their due commitments |
| Client status | PM or Lead | Client-visible milestones only, the displayed status and its reason when the PM marks it shareable. Never BRAID internals |
| Weekly summary | PM or Lead | The project's week: work done, milestones moved, BRAID entries opened and closed, status changes |

### M25. Draft (Ask). NEW, the M11 shape

```
requested ──DRAFTED (guard: passes the facts check)──▶ ready
requested ──DRAFTED (guard fails) or DRAFT_FAILED──▶ retry, then plain (a template from the facts, no model)
ready ──EDIT──▶ ready (edited)
ready ──COPY──▶ copied                     final
ready ──POST (confirm, the right to post there)──▶ posted     final; posting waits on B8, B9
ready ──DISCARD──▶ discarded               final
ready ──TIMER config.draftExpiryHours──▶ expired
```

- **Facts check:** every record, date, number and name in the draft must be one of the facts it was given. A draft that adds one is refused and retried; after the tries, the plain template is used.
- Posting is outward: always a confirm, never automatic.

### Edge cases (DR1 to DR8)

| # | Case | Expected |
|---|---|---|
| DR1 | Nothing happened since the last standup | "No changes since yesterday" plus what is in progress |
| DR2 | The model invents a date or record | Refused by the facts check |
| DR3 | A member asks for a client status | Refused: PM or Lead only (checked when it runs) |
| DR4 | A milestone is not client-visible | Never in the client draft, even if asked by name |
| DR5 | The facts change while they edit | The draft says "as of"; a Refresh redrafts, their edits kept aside |
| DR6 | No model connected | The plain template |
| DR7 | Quotes from other people's updates | Never in a draft, even when visible to the asker (DECIDE) |
| DR8 | Posted twice | Once only by draft id |

### Model check (27 Oct 2026): fix before building

- M25: a timer on requested (`draftModelSeconds`) counts as DRAFT_FAILED, so a draft always reaches ready.
- M25: POST, and COPY of a client status, check every fact against the readers there **now** (the group's members, or the client view); refuse and offer Refresh.
- M25: draw `ready --REFRESH (the right, checked now)--> requested` for DR5.

## 10. Phase H. Ask about people

### What changes

"What is Kemar working on?", "What's on Jodian's plate?", "Who owns the store feed?". Needed by leads for planning and for covering leave.

### The rule to decide first (DECIDE)

Default proposed: a viewer sees another person's **work items, milestones and BRAID entries they own**, only **on projects the two share**. Never their captures, commitments, inbox, nudges or settings. Leave shows only as "on leave until 3 Nov" and only where the project already shows leave impact. A person with no shared project is answered exactly like a person who does not exist.

### Edge cases (PP1 to PP8)

| # | Case | Expected |
|---|---|---|
| PP1 | A person with no shared project | "I can't tell you about them": the same words as for a name nobody has (P10) |
| PP2 | Two people share the first name | Asks which (phase D), listing only people they share a project with |
| PP3 | An outside contact (Kyle) | The entries and records Kyle is tied to on shared projects |
| PP4 | Asking about yourself by name | my_work |
| PP5 | "Who owns the store feed?" | The owner of the matching record or entry, on readable projects |
| PP6 | "Is Kemar overloaded?" | Facts only (count of open items, how many past due); no judgement |
| PP7 | The person is on leave | Their work, and "on leave until" where the project shows it |
| PP8 | Asking about someone's updates or messages | Never: captures are their author's (M1) |

## 11. Phase I. Atlas in the project group

### What changes

Teams already talk in project groups in the Atlas app (`groups`, `group_members`). Atlas joins the groups that are connected to DPM:

- **Group messages are updates.** Each message is a capture of the person who sent it (M1, M2), private to them. Their review comes to them directly, never in the group. Atlas says nothing in the group about it.
- **"@Atlas" questions are answered in the group,** for everyone in it: only facts every member may see (rule 8).
- **Personal questions are answered directly.** "@Atlas what needs me?" in the group gets "Sent you that directly" in the group and the answer in their one-to-one chat. That reply is the same whatever the answer, so it reveals nothing.

### M26. Group message (Job). NEW

```
received ──(guard: the group is connected to DPM and the sender is a DPM person in it)──▶ captured
received ──(guard fails)──▶ ignored                                    final, logged
captured: a capture of the sender (M1), channel "atlas", with the group as context
  ├─ it @mentions Atlas and asks something ──▶ M27 for the question part
  └─ the rest goes through M2 as any update; nothing_to_update is silent in groups
```

- DECIDE: Atlas reads every message in a connected group (default), or only messages that @mention it or reply to it.
- The group's project is a routing hint (like "On Store Insights"), not a rule: an update about GQ sent in the Forager group still goes to GQ.
- A reply to someone else's message ("same here", "+1") is read with the message it replies to as context, so it can be another report of the same blocker (M16 same-as), credited to the person replying.

### M27. Group answer (Job). NEW

```
asked ──(guard: a personal topic: needs_me, my_work, mentions, updates, commitments)──▶ sent_directly     final
asked ──AUDIENCE(the members now)──▶ composing
composing: each fact is kept only if every current member may read it (the intersection of their reads)
composing ──(guard: the member list has not changed since AUDIENCE)──▶ answered                         final
composing ──(member list changed)──▶ composing again with the new list
composing ──(nothing is left)──▶ answered with "Nothing I can share with everyone here." and no hint of more
```

- An outside contact in the group (Kyle, `orgRole` null) can read only the client view, so a group with one in it gets client-view facts only.
- The answer never says that facts were left out (P10).

### Edge cases (GR1 to GR12)

| # | Case | Expected |
|---|---|---|
| GR1 | A message from someone not in DPM | Ignored; nothing is stored about them |
| GR2 | A group not connected to DPM (UWI Mona study group) | Ignored |
| GR3 | A team group with no project (Data guild) | Messages are read; items with no project are not filed (E81) |
| GR4 | "@Atlas what's blocked?" with Kyle in the group | Only blockers the client view shows; usually "Nothing I can share with everyone here." |
| GR5 | Someone joins between the question and the answer | Recomputed for the new list |
| GR6 | "@Atlas what needs me?" | "Sent you that directly"; the answer in their own chat |
| GR7 | "+1, same for me" replying to Andre's blocker | A report of the same blocker by the replier, in their own review |
| GR8 | Banter, lunch plans | nothing_to_update, silent |
| GR9 | Someone posts another person's update for them ("Kemar says #145 is done") | Rule 10: proposed to Kemar to confirm (M34), not saved as the sender's |
| GR10 | The same message delivered twice by the Atlas app | Once only by Atlas message id |
| GR11 | An edited or deleted message | DECIDE: an edit before review is a new read; after save, nothing changes (default). A deleted message withdraws its unsaved capture |
| GR12 | Someone asks Atlas in the group to approve something | A chat command (M20), confirmed by the person directly, never in the group |

### Model check (27 Oct 2026): fix before building

- M27: filter the facts again in the posting transaction, against the members and their reads now; if any fact was dropped, use DPM's own words. This replaces "composing again", which could loop forever.
- M26: draw GR9 (about another person: M34 to them) and GR12 (a decision: an M20 command in the sender's own chat) as branches, not only edge cases.
- M34 CONFIRM gets the M20 guard and a refused state.
- Decide with the Atlas spec whether someone who joins a group sees earlier messages; if so, Atlas's answers are hidden from later joiners.

## 12. Phase J. Standup with Atlas

### What changes

Instead of waiting for a free-form update, Atlas asks two to four short questions built from the person's open work, with tap answers where it can:

- "#208 Store sales feed was In progress yesterday. Done, still going, or stuck?" [Done] [Still going] [Stuck]
- "Is the Trend model still on for Thursday?" [Yes] [No, it moves]
- "Anything new blocking you?"

The answers become one capture, reviewed as usual. A free-form update is still always welcome; the standup only fills the gaps.

A vague free-form update also gets one follow-up question ("Worked on the feed" → "Which one, #208 or #212?"), through M21.

### M28. Standup (Job). NEW

```
scheduled ──TIMER standup time (M23 rules: working day, not on leave, turned on, under the cap)──▶ asking(1 of n)
scheduled ──(guard: they already sent an update today, or have no open work)──▶ skipped        final
asking(k) ──ANSWER──▶ asking(k+1), or composed when k = n
asking(k) ──SKIP──▶ asking(k+1), or composed when k = n
asking(k) ──STOP ("that's all")──▶ composed
asking(k) ──TIMER standupIdleMinutes──▶ composed if anything was answered, else abandoned       abandoned is final
composed ──▶ one capture (M1, M2) from the answers, each read with its question as context      final
```

- Questions, in order, at most `standupMaxQuestions`: blocked items (still stuck?), items In progress, items due today or tomorrow, commitments due (phase E), then "Anything new blocking you?".
- A tap answer becomes a proposal at high confidence with the question as its quote ("Done" on #208 → #208 In progress to Done). "Stuck" asks one more question: "What's it waiting on?", which becomes the blocked note and, if it names something, a blocker report.
- In the DPM chat a standup can be started by the person ("Start my standup"); Atlas starting it on its own waits on phase F.

### Edge cases (SU1 to SU10)

| # | Case | Expected |
|---|---|---|
| SU1 | No open work | Skipped; or only "Anything blocking you?" if they ask for a standup |
| SU2 | They already sent an update today | Skipped; questions about items that update did not mention may be asked as follow-ups (DECIDE: no, default) |
| SU3 | Someone else changed #208 while they answer | The save compares versions as usual (M4); the card shows the conflict |
| SU4 | An answer that is about a different item ("Not that, but #212 is done") | Read as a free-form update with the question as context |
| SU5 | They answer by voice | Transcribed, then the same path |
| SU6 | They stop half-way | What was answered is composed; the rest is not asked again today |
| SU7 | They stop answering | Timer composes what was answered, or abandons |
| SU8 | They lost ownership of an item before the question | Not asked; the question list is rebuilt at each step |
| SU9 | On leave | Never scheduled |
| SU10 | Two standups in a day (they started one, Atlas starts another) | One per person per day |

### Model check (27 Oct 2026): fix before building

- M28: `scheduled --TIMER (rules fail)--> skipped`, with the skip guard (an update today, or no open work) written first.
- M28: STOP, or the last SKIP, with nothing answered is abandoned, not an empty capture.
- M28: at save, recheck ownership as well as membership: an answer about a record someone else now owns becomes an Ask to the owner (section 20's M37), never an edit. This also holds for free-form updates.
- M28: draw START from none, scheduled and skipped; one per day counts standups that asked. Draw the "Stuck" follow-up as `asking(k) --ANSWER Stuck--> asking(k, "What's it waiting on?")`.

## 13. Phase K. Signals

### What changes

Atlas notices patterns in the data and raises them as signals to the people who can act. A signal is never a BRAID entry by itself; a PM or Lead accepts it into a risk proposal (M15) or dismisses it.

| Signal | Rule | Raised to |
|---|---|---|
| Repeated blocker | The same open blocker reported by three or more people, or reported again after it was resolved | PM and Leads |
| Stale work | A work item In progress for `staleWorkDays` with no change and no mention in any update | Its owner first (a due-date style check), then PM and Leads if no answer |
| Slipping forecast | A milestone's forecast moved later `slipCount` times | PM and Leads |
| Waiting decision | A BRAID proposal or kind request waiting longer than `decisionWaitDays` | The deciders (after the S18 reminders) |
| Milestone at risk from its work | Most of a milestone's work is Blocked or past due while the milestone still shows On track | PM and Leads |
| Quiet project | No update from any member for `quietProjectDays` working days | PM |

### M29. Signal (Ask). NEW

```
(none) ──DETECTED (rule; nightly and on save)──▶ raised
raised ──ACCEPT (PM or Lead, right checked now)──▶ accepted: a risk proposal with the signal's facts as its source       final
raised ──DISMISS(reason)──▶ dismissed ──TIMER signalSnoozeDays──▶ (none); raised again only if worse
raised ──CONDITION_GONE (checked on read and nightly)──▶ cleared                                                          final
raised ──TIMER signalExpiryDays──▶ expired                                                                               final
```

- One live signal per (project, rule, subject). "Worse" is per rule: another report, another slip, more days.
- The text is a template from the facts ("Forecast for Trend model moved 3 times: 23 Oct, 28 Oct, 4 Nov"), never written by the model.
- Signals appear in the inbox (M10) and, with phase F, as a nudge.

### Edge cases (SG1 to SG10)

| # | Case | Expected |
|---|---|---|
| SG1 | The condition clears before anyone answers | Cleared; the inbox item closes as cause gone |
| SG2 | Dismissed, then it gets worse | Raised again, with the dismissal reason shown |
| SG3 | Dismissed, and it stays the same | Not raised again within the snooze |
| SG4 | Stale work owned by someone on leave | Not raised while they are away |
| SG5 | Accepted, and an open risk already covers it | The proposal is matched as same-as that entry (M16) |
| SG6 | Two PMs answer at once | Optimistic version: the first wins, the second is told |
| SG7 | A quiet project that is paused or between phases | DECIDE: a project can be marked paused; no quiet signal then |
| SG8 | The stale item's owner answers "still going" | The item's clock restarts; no signal to the PM |
| SG9 | A signal on a project the PM has since left | Their copy closes; others still see it |
| SG10 | Many signals at once on one project | Grouped into one inbox item per project per day |

### Model check (27 Oct 2026): fix before building

- M29: on ACCEPT, DISMISS and expiry store the level and the condition's episode (when it started); DETECTED raises only when there is no memory, the episode is new, or it is worse. Otherwise an accepted signal comes back every night.
- M29: "worse" is compared within one episode, so a condition that ends and comes back is raised again.
- M29: draw the stale-work escalation, `raised(owner) --TIMER ownerAnswerDays--> raised(PM and Leads)`; the expiry clock starts there.

## 14. Phase L. Undo, "why did you file that?", and corrections

### What changes

- **Undo.** "Undo that" (or the Undo button on the saved message) reverses their last save, within `undoMinutes`, if nobody has changed those records since.
- **Why did you file that?** For any of their items: the routing reason and the deciding words (`routingReason`, evidence), and the match for BRAID items. A read only.
- **Corrections teach Atlas.** "Kyle is Sprouts, not Forager", "GQ also means the Academy", or moving an item to another project in review, proposes a change to the project's vocabulary (aliases, contacts, tied people) for a PM or Lead to approve. Next time Atlas reads it right.

### M30. Undo (Job). NEW

```
requested ──(guard: their own save, within undoMinutes, every record still at the version that save wrote, the right held now)──▶ undoing
requested ──(guard fails)──▶ refused: says which record moved and who moved it                         final
undoing ──▶ each record goes back through its own machine's UNDO arrow (all or nothing, like S3) ──▶ undone   final
```

- Each machine an undo touches gets one drawn `UNDO` arrow back to the state the save moved it from (M5, M6, M7, M15 reports, M9 set status); model checked like any arrow.
- BRAID sources the save added are withdrawn (D11). An entry the save created goes back to `none`.
- Notices sent by the save are followed by one more: "Kemar undid this."
- Cannot be undone: anything someone else has acted on since (an approved decision, a resolved blocker).

### M31. Vocabulary change (Ask). NEW

```
proposed ──APPROVE (PM or Lead of the project, checked now)──▶ applied                                 final
proposed ──DECLINE──▶ declined                                                                       final
proposed ──TIMER reminders (S18 rhythm), then vocabExpiryDays──▶ expired                             final
```

- Kinds: a project alias ("Academy" for GQ), a contact on the project (Kyle for Store Insights), a person tied to a record.
- An alias already used by another project the org can see is refused (it would make routing ambiguous).

### Edge cases (UN1 to UN10)

| # | Case | Expected |
|---|---|---|
| UN1 | "Undo that" after the window | Refused: "You can change these from the project now." with links |
| UN2 | Someone changed one of the records since | Refused, naming the record and who changed it; nothing is undone |
| UN3 | The save created a BRAID proposal that is still waiting | Withdrawn; the deciders' inbox items close as cause gone |
| UN4 | "Undo that" with no recent save | "There's nothing of yours to undo." |
| UN5 | Undo twice | Once only |
| UN6 | Their save was the second report on a shared blocker | Only their source is withdrawn; the entry stays for the others |
| UN7 | "Why did you file that?" about another person's item | Not theirs: "I can only tell you about your own updates." |
| UN8 | A correction that is wrong ("Kyle is on GQ") | It is only a proposal; the PM declines |
| UN9 | An alias that clashes with another project | Refused before it is proposed |
| UN10 | They move items in review often for one word | DECIDE: after 2 moves of the same word, propose it as a correction (default) |

### Model check (27 Oct 2026): fix before building

- M30: draw `undoing --> refused`; versions and the right are checked again in the transaction that runs the UNDO arrows.
- M30: "Kemar undid this" goes only to people who can still open the record; a refusal names and links only records the asker can open now.
- M31: check the alias clash again at APPROVE.
- M31: check a clash only against projects the person told can open; where one person is in both projects, M14 sends their item to choose_project.

### Built (wave 2)

See `atlas-conversational-wave-2.md`. M30 with UNDO arrows (leave included) and a receipt per save; `why_filed`; M31 for aliases and contacts, refusals kept per asker. Open: W2-D1, W2-D4, W2-D5.

## 15. Phase M. Chasing people for you

### What changes

"Ask Kyle if the feed access is sorted." Atlas drafts the message, sends it after the asker confirms (rule 9), tracks the reply, and turns the reply into an update for the asker to review. No reply in `chaseReminderWorkingDays`: one reminder; still none, the asker is told and the dependency shows "Asked Kyle on Mon, no reply".

### M32. Outbound ask (Ask to someone else). NEW

```
drafted ──CONFIRM (the asker)──▶ sending
drafted ──CANCEL, or TIMER commandExpiryMinutes──▶ cancelled                                   final
sending ──SENT──▶ waiting
sending ──SEND_FAILED──▶ retry (nudgeMaxTries), then failed; the asker is told                final
waiting ──REPLY (from the person asked)──▶ replied: a proposal in the asker's review (an update to the linked record or entry)     final
waiting ──TIMER chaseReminderWorkingDays──▶ reminded ──TIMER──▶ unanswered; the asker is told                                     final
waiting ──CANCEL, or the subject was resolved elsewhere──▶ closed                                                                 final
```

- Who can be asked: people on a project the asker shares with them, and the project's contacts (`project_contacts`). Anyone else: "I can't reach them."
- Reached through the Atlas app. A contact not on Atlas: the draft is offered to copy instead.
- The reply belongs to the asker's review; it changes nothing until the asker saves it (rule 1). The person asked sees only the message, never the project's data.

### Edge cases (CH1 to CH10)

| # | Case | Expected |
|---|---|---|
| CH1 | Asking someone outside every shared project | "I can't reach them," the same words as for an unknown name |
| CH2 | The reply does not answer ("Who is this?") | Shown to the asker as is; nothing proposed |
| CH3 | The reply comes after the reminder | Still filed as a reply |
| CH4 | The dependency is resolved by someone else while waiting | Closed; the asker is told, no reminder sent |
| CH5 | Two people chase Kyle about the same thing | The second asker is told "Andre asked Kyle about this on Mon" and may still send |
| CH6 | The person asked is on leave | The asker is told before sending (only when the project already shows that leave) |
| CH7 | The draft includes internal facts | The draft uses only the asker's words and the record's title; DECIDE: titles of internal records are allowed in a chase (default yes, the asker confirms) |
| CH8 | Asked to chase many people at once | One draft each, one confirm each |
| CH9 | The reply contains an update about something else | Read as a capture of the asker's review with the reply as context; nothing is saved as the replier's |
| CH10 | The asker leaves the project | Open chases are closed |

### Model check (27 Oct 2026): fix before building

- M32: `reminded --REPLY--> replied` (CH3); a reply after the chase ended is shown to the asker as is, nothing proposed.
- M32: close from sending and reminded too when the subject is resolved or the asker leaves, and when the asker can no longer reach the person ("I can't reach Kyle any more").

## 16. Phase N. Questions for leads and executives

### What changes

New topics, answered only where the asker holds the role:

| Topic | Said like | Answer | Who may ask |
|---|---|---|---|
| **not_updated** | "Who hasn't updated today?" | Members of the projects where they are PM or Lead with no update today, not on leave. Names only, never the content of anyone's updates | PM, Lead |
| **my_decisions** | "What needs a decision from me?" | BRAID proposals, kind requests and set statuses waiting on them, oldest first | Anyone (their own) |
| **at_risk_week** | "What's at risk this week?" | Across their projects: milestones forecast past target or due this week with blocked work, live blockers, open signals (K) | Anyone; scope is their projects |
| **portfolio** | "Which projects are off track?" | Every project in their org lens (A7.2) with its displayed status and reason | Executives, delivery leads |
| **who_free** | "Who can pick up #151?" | Waits on phase H's rule | — |

- A weekly digest of at_risk_week and my_decisions for leads, sent by phase F (DECIDE: Monday 8:30am, default).
- The role is checked per project when the question is answered: a PM on Forager and a member on GQ gets not_updated for Forager only.

### Edge cases (LD1 to LD10)

| # | Case | Expected |
|---|---|---|
| LD1 | A member asks "Who hasn't updated today?" | "Only PMs and Leads can see that." Nothing about anyone |
| LD2 | Someone on leave | Not listed as missing |
| LD3 | Weekend or before the standup time | "It's early: updates usually come in by 10am" (DECIDE: answer from the missing-update time) |
| LD4 | An executive with no lens tags | Their own projects only |
| LD5 | Outside contacts | Never listed in not_updated |
| LD6 | A project they lead with no members besides them | "Only you on Forager" |
| LD7 | "Which projects are off track?" from an employee | Their own projects only |
| LD8 | A decision waiting on several approvers | Listed for each until one decides (S11) |
| LD9 | Someone who updated in a group (phase I) | Counts as updated |
| LD10 | Asked as a follow-up ("And last week?") | DECIDE: not_updated is today only (default); no history of who missed which day |

## 17. Phase O. Meetings

### What changes

- **A meeting note** (a voice note or a pasted transcript, marked as a meeting, with a project) is read for everyone in it. The recorder's own items go to their review. Items about other attendees (their work, their promises) go to each of them to confirm (rule 10). Decisions go to the deciders as proposals.
- **"Prep me for the Sprouts call"**: a brief for a meeting, client-safe by default: client-visible milestones, the displayed status, open dependencies on the client's contacts, chases waiting on them (phase M), recent decisions the client view shows.

### M33. Meeting capture (Job). NEW, extends M2

```
received (marked meeting, project, attendees) ──ATTENDEES_CONFIRMED (the recorder confirms who was there, and that they knew it was recorded)──▶ transcribing
transcribing ──▶ reading (as M2)
reading ──PROPOSALS_READY──▶ split
split: own items ──▶ the recorder's review (M3)
       items about attendee X ──▶ M34 to X
       decisions ──▶ proposed BRAID decisions (M15) to the deciders
split ──every part saved, confirmed, declined or expired──▶ done                       final
received ──TIMER (attendees never confirmed, reviewExpiryDays)──▶ expired              final
```

### M34. Attributed item (Ask to the person it is about). NEW

```
proposed ──CONFIRM──▶ confirmed: saved as theirs (an update, a commitment)                         final
proposed ──EDIT then CONFIRM──▶ confirmed with their wording
proposed ──DECLINE──▶ declined; the recorder is told "Kemar says that's not right"                final
proposed ──TIMER attributedExpiryDays──▶ expired; not filed                                        final
```

### Edge cases (MT1 to MT12)

| # | Case | Expected |
|---|---|---|
| MT1 | An attendee not in DPM (Kyle) | Their items are not filed; promises Kyle made become dependencies proposed to the recorder |
| MT2 | The transcript cannot tell who said what | Atlas proposes speakers; low confidence; the recorder fixes them in review before anything goes to others |
| MT3 | Someone not listed as an attendee is named | Treated as named, not present: nothing sent to them unless the recorder adds them |
| MT4 | Attendees not told it was recorded | The recorder must confirm they were; otherwise it is read as the recorder's own notes only (DECIDE) |
| MT5 | An attendee declines an item | Not filed; the recorder is told |
| MT6 | A decision made by someone without the right | Proposed to the deciders like any decision |
| MT7 | Two people record the same meeting | Matched by project and time; DECIDE: the second is offered to merge (default) |
| MT8 | A meeting across two projects | Items routed per project (M14), as with any update |
| MT9 | Prep for a call with a client contact who is in two projects | Only the project named, or asks which (M21) |
| MT10 | Prep asked by a member who cannot see the client view | Their own projects' facts; client-safe still applies |
| MT11 | A long meeting | Over `maxProposalsPerCapture`: more found, as E-cases for long updates |
| MT12 | An attendee is on leave by the time it arrives | Their item waits until they are back, then the timer starts |

### Model check (27 Oct 2026): fix before building

- M33: draw `received --OWN_NOTES_ONLY--> transcribing` for a note whose attendees were not told (MT4, CD17).
- M33: items whose speaker is unsure wait in a `held` state in the recorder's review until the speaker is fixed (MT2).
- M33: decisions go through the recorder's review first, then to the deciders (two confirmations).
- M34: ask only members of the item's project (anyone else's item goes to the recorder, as MT1); withdraw when they leave; the timer pauses during leave.

## 18. Phase P. Leave and handover in the chat

### What changes

- "I'm off next week" proposes the leave (D6, as today) and adds: "While you're away: #151 is due Tue, Trend model is forecast Wed." For each, a cover can be asked.
- **Cover requests** go to a teammate on that project to accept; an accepted cover proposes a handover (M7).
- **"Catch me up"** after leave: the updates topic with "since" set to the start of their leave, plus what was handed over and where each item stands.

### M35. Cover request (Ask to a teammate). NEW

```
suggested ──PICK (the person going on leave picks who)──▶ asked
asked ──ACCEPT (the teammate)──▶ accepted: a handover (M7) proposed; DECIDE: needs the PM's OK (default no)      final
asked ──DECLINE──▶ declined; the asker picks someone else                                                         final
asked ──TIMER coverAskHours──▶ unanswered; the asker is told                                                     final
asked ──the leave is cancelled──▶ withdrawn                                                                       final
```

- Suggestions (who has capacity) wait on phase H. Until then the asker names the person.

### Edge cases (LV1 to LV10)

| # | Case | Expected |
|---|---|---|
| LV1 | Leave with no work due while away | "Nothing of yours is due while you're away." |
| LV2 | The teammate asked is also on leave then | Refused before asking (when the project shows that leave) |
| LV3 | The leave dates change | Items due are recomputed; open cover requests for dates no longer covered are withdrawn |
| LV4 | Cover accepted, then the leave is cancelled | The handover is cancelled through M7 |
| LV5 | "Catch me up" with no leave on record | Updates since their last update, at most 7 days |
| LV6 | Back early | The leave ends today (D6 change); catch-up covers the days they were away |
| LV7 | Work on a project they left during leave | Not shown |
| LV8 | One cover for several items | One request listing them; accepted together or each declined |
| LV9 | Leave not yet approved | Cover can be asked; the handover waits on the approval |
| LV10 | A commitment due during leave | Moved to the first working day back, with their OK in the review |

### Model check (27 Oct 2026): fix before building

- M35: `suggested` is withdrawn when the leave starts or is cancelled, or on DISMISS.
- M35 and M7: a declined leave counts as cancelled.
- M35: withdraw, telling nobody, when the asker or the teammate leaves the project.
- M35: refuse PICK for an item already in an asked request or a live cover.

## 19. Phase Q. "What is Forager?"

### What changes

A new topic `explain_project`: "What is Forager?", "Explain Store Insights", "I'm new on GQ, where do I start?"

- Answer, all from the project view: who it is for and when it runs, the owner; its threads and what each is for; the next milestones; the five most recent approved decisions; who owns what (thread and milestone owners); how it stands (project_status). A "Where to start" line links their own work on it, if any.
- Members only. Optionally phrased by the drafter (M25) with the facts check.

### Edge cases (EX1 to EX6)

| # | Case | Expected |
|---|---|---|
| EX1 | A project they are not in | "I can't find that in your projects." (P10) |
| EX2 | A project with no threads or milestones | Says so, and how they get filled (P11) |
| EX3 | Decisions from updates routed elsewhere | The decision shows; its quote does not (rule 9) |
| EX4 | An outside contact asks | The client view only |
| EX5 | Ambiguous name ("Insights") | Matched by alias; if two fit, asks (M21) |
| EX6 | Asked in a group (phase I) | Answered with the group's shared facts only |

## 20. Phase R. Jamaican English and Patois

### What changes

The team writes and speaks the way it talks: "mi done wid di feed", "di access still nuh come through", "Kyle seh him a go send it likkle more". Reading this right matters more than any feature above.

- **Prompt:** Atlas reads Jamaican English and Patois as written, never corrects or translates the quoted words, and keeps quotes exactly as said.
- **Rules (no model):** the question and small talk patterns learn common forms ("wah", "weh", "mi", "unu", "nuh", "a weh", "wha gwaan").
- **Transcription:** DPM does not transcribe; the Atlas app sends the transcript (`atlas/transcriber.ts`). Vocabulary hints belong to whatever transcribes there. Items from a low-confidence transcript are Medium (E5) and need the author's OK.
- **Evals:** a set of cases written in how the team actually talks, kept alongside the existing ones, with negation and tense cases first.
- **Replies:** DECIDE: Atlas replies in standard English (default), or mirrors the person.

### Edge cases (JA1 to JA8)

| # | Case | Expected |
|---|---|---|
| JA1 | "Di access nuh come yet" | Negation: the blocker is still open; not a resolve |
| JA2 | "Mi done wid #208" vs "mi soon done wid #208" | Done vs still In progress; "soon" is not done |
| JA3 | "Him a go send it" (future) | A dependency or commitment, not done |
| JA4 | Code-switching inside one sentence | Read as one message; spans still map to the exact words |
| JA5 | "Wha gwaan?" | small_talk |
| JA6 | "Weh mi fi do today?" | needs_me / my_work |
| JA7 | A name that is also a word | Matched only in the shape of a reference (capitalised, or next to a record) |
| JA8 | A voice note in heavy Patois with low transcript confidence | Items are Medium and need the author's OK; the transcript is shown exactly as sent and never edited (A5.6); corrections go in the items (W-D2) |

### Built (wave 1)

- Prompt (`read-11` with section 20): Patois read as written, quotes exact, replies in standard English (CD20). Check 4 treats Patois hedges ("mi tink", "mebbe", "nuh sure") as hedges; "soon done" and "a go finish" drop a done value to Medium (JA2).
- JA7 in code: `namesProject` counts a project name or alias only with its capital or next to one of its record numbers; routing is always strict, so "mi done wid forager" goes to choose_project. A message with no capitals at all still counts a name in any case (QA8). People's names follow W-D1 and W-D4.
- Rules: greetings are stripped with or without a comma (CQ13); "unu", "wen", "weh" and "anybody" ask only with "?", because Patois yes or no questions are shaped like statements.
- 19 `ja-` eval cases.

## 21. Phase S. Learning from use

### What changes

- **Feedback on answers:** a thumbs up or down on every answer and draft, with an optional "What was wrong?"
- **"Can't answer" log:** every `other` answer, thumbs down, undo (L), correction (L) and item moved in review is logged as a candidate for the eval set.
- **Numbers for the team building DPM:** answer rate, "I can't answer that yet" rate, acted-from-answer rate (B), correction and undo rate, standup completion (J), nudge reply rate (F), signal accept rate (K). Weekly, per topic. This decides which phase to build next.

### M36. Eval candidate (Ask, for a DPM maintainer). NEW

```
(none) ──LOGGED (guard: the person allows "Help improve Atlas")──▶ logged
logged ──ACCEPT (a maintainer, with the expected result; text anonymised to seed names and ids)──▶ in_eval_set   final
logged ──DISMISS──▶ dismissed                                                                                   final
logged ──TIMER evalCandidateDays──▶ deleted                                                                     final
logged ──OPTED_OUT (the person turns "Help improve Atlas" off; same transaction)──▶ deleted                       final
logged ──WITHDRAWN (the person changes a thumbs down to up)──▶ deleted                                         final
```

- The person's words are theirs (M1). Without their OK, only the counts are kept, never the text.
- Anonymising replaces names, record numbers and project names with seed equivalents before a case enters the eval set.

### Edge cases (LF1 to LF8)

| # | Case | Expected |
|---|---|---|
| LF1 | "Help improve Atlas" is off | Counts only; no text stored as a candidate, and "What was wrong?" is not stored at all |
| LF2 | They turn it off later | Their logged candidates are deleted and their "What was wrong?" notes cleared, in the same transaction; accepted cases were already anonymised and stay |
| LF3 | A candidate contains a client's name or data | Anonymised before acceptance; a maintainer can dismiss it outright |
| LF4 | Thumbs down on a correct answer | Logged; dismissed by the maintainer with a note |
| LF5 | Many of the same question can't be answered | Grouped; the count is the signal for what to build |
| LF6 | Feedback on an answer from days ago | Accepted; tied to that answer's "as of" |
| LF7 | Who sees the numbers | DECIDE: DPM maintainers only (default); org executives see their org's counts, never text |
| LF8 | A metric would identify one person (a team of two) | Shown only above a minimum count (DECIDE: 5) |

### Built (wave 1)

- Thumbs up or down with "What was wrong?" under every answer; "Help improve Atlas" on `people`, off by default, in the sidebar account menu and offered after a thumbs down. Migration `0009_learning_from_use`.
- M36 as drawn above, in `domain/machines/eval-candidate.ts`: ACCEPT and DISMISS recheck the OK, every final state drops the original words, and the timer event is EXPIRE. Once only means one live candidate per cause per answer; a deleted one can be logged again. ACCEPT refuses text that matches the stored words or holds a real (non-seed) name; the maintainer writes the anonymised case.
- Numbers: `pnpm atlas:usage`. There is no maintainer role or screen yet, so whoever runs it is the maintainer (`--as`). Maintainers see every count (W-D3); `--org` is an org's executive view, which hides any number from fewer than 5 people and any it would give by subtraction. Numbers for B, F, J, K and L wait on those phases.
- Model check: a candidate can hold another person's words (a thumbs down on a group answer, phase I); guard LOGGED on everyone whose words it holds before phase I is built.

## 22. Parked ideas

Not planned yet; written down so they are not lost.

- **Atlas speaks back** in voice notes in the Atlas app.
- **What if:** "If #151 slips a week, what moves?" A dry run of the status rules on a changed plan.
- **Search your own history:** "When did I last mention the store feed?" Over the asker's own captures only.
- **Longer memory:** context beyond the 30-minute follow-up window, for example "the thing we talked about yesterday".
- **@mentions from the Atlas app** as structured data, instead of finding names in words (waits on B8, B9).

## 23. Config to add

| Key | Default | Phase |
|---|---|---|
| ~~followUpMinutes~~ | not added | A: superseded by section 16 |
| updatesMaxDays | 7 | A |
| mentionsDays | 14 | A |
| commandExpiryMinutes | 30 | B |
| clarifyExpiryHours | 2 | D |
| commitmentCheckIns | 2 | E |
| nudgeDailyCap | 4 | F |
| nudgeMaxTries | 3 | F |
| nudgeReplyHours | 24 | F |
| briefTime | "08:30" | F |
| missingUpdateTime | "16:00" | F |
| draftExpiryHours | 24 | G |
| draftModelSeconds | 30 | G (model check) |
| standupMaxQuestions | 4 | J |
| standupIdleMinutes | 60 | J |
| standupTime | "09:00" | J |
| staleWorkDays | 5 working days | K |
| slipCount | 3 | K |
| decisionWaitDays | 5 working days | K |
| quietProjectDays | 3 working days | K |
| signalSnoozeDays | 7 | K |
| signalExpiryDays | 14 | K |
| ownerAnswerDays | 2 working days | K (model check) |
| undoMinutes | 15 | L |
| vocabExpiryDays | 14 | L |
| chaseReminderWorkingDays | 2 | M |
| attributedExpiryDays | 3 working days | O |
| coverAskHours | 24 | P |
| evalCandidateDays | 30 | S |
| metricMinimumCount | 5 | S |

## 24. Decisions (settled 27 Oct 2026)

Marlon asked for the best defaults to be chosen. Every DECIDE in this plan takes the answer below; where the answer differs from the default first written, the row says why.

| # | Question | Decided |
|---|---|---|
| CD1 | "Approve all of them": one card per decision, or one tap for many? | One card each |
| CD2 | How long a confirm card and a clarification stay open | 30 minutes; 2 hours |
| CD3 | Is a commitment private, or shown on the project when it names a record there? | Private |
| CD4 | A commitment with no date | Due next working day |
| CD5 | A promise made for someone else | Not proposed |
| CD6 | Which nudges are on by default, and the daily cap | Brief, mentions, due-date checks, check-ins on; missing update off; 4 a day |
| CD7 | Holidays for nudges | Weekends only, until there is an org calendar |
| CD8 | Quotes in drafts | Never |
| CD9 | What a viewer may see of another person (phase H) | Section 10 above |
| CD10 | In a connected group, does Atlas read every message, or only ones that @mention or reply to it? | Every message |
| CD11 | An edited group message after its update was saved | Nothing changes |
| CD12 | During a standup, ask about items a same-day update did not mention? | No |
| CD13 | Can a project be marked paused, to stop quiet-project signals? | Yes |
| CD14 | Propose a vocabulary correction after the same word is moved in review twice? | Yes |
| CD15 | May a chase include the titles of internal records? | Yes, the asker confirms the text |
| CD16 | "Who hasn't updated" for any day but today? | Today only; no history |
| CD17 | A meeting note where attendees were not told it was recorded | Read as the recorder's own notes only |
| CD18 | A second recording of the same meeting | Offered to merge |
| CD19 | Does an accepted cover need the PM's OK before the handover? | No, but the PM gets a notice (changed: a change of owner should never surprise the PM) |
| CD20 | Atlas's reply language | Standard English |
| CD21 | Who sees the usage numbers | DPM maintainers; org executives see counts only for their org |
| CD22 | When the lead digest is sent | Monday 8:30am |
| CD23 | Which item a clarification asks about when several are unsure | The first in the message |
| CD24 | When a moved commitment asks whether to drop it | After 3 moves |
| CD25 | Morning brief and missing-update times | 8:30am and 4pm, in the org time zone until people have their own |
| CD26 | Daily cap on nudges | 4 |
| CD27 | "Who hasn't updated" asked early | Before the standup time (9am) it says "It's early" (changed: the 4pm reminder time would hide the whole morning) |
| CD28 | Smallest group a usage number is shown for | 5 |
| CD29 | Mention matching on a shared first name | As CQ9: first name only where no other member of that project shares it |
| CD30 | Does a lowercase first name count as a mention? (W-D1) | Yes, unless the name is also an everyday word (Mark, Will, May): those need their capital. A full name counts in any case |
| CD31 | JA8: fix a transcript before review? (W-D2) | No: shown exactly as sent, items Medium, corrections go in the items |
| CD32 | Who sees usage counts from fewer than 5 people? (W-D3) | DPM maintainers see every count; executives get the strict view |
| CD33 | Does routing by a person need the name to look like a name? (W-D4) | Yes, the CD30 rule (`domain/names.ts`) |
