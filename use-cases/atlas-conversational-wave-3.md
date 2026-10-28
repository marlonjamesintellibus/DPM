# Atlas conversational plan: wave 3 (27 Oct 2026)

**Goes with:** `atlas-conversational-plan.md` (phases D, H, J, K, N and Q) and `01-update-to-plan-machines.md` sections 15 to 20
**Branch:** `atlas-conv/wave-3`, from main at `8ca0855`. Not merged into main. Nothing pushed.
**Status:** built and checked; decisions W3-D1 to W3-D12 wait for review.

## 1. What was built

| Phase | What it is |
|---|---|
| D. Ask when unsure | M21 Clarification, with the model check's fixes. It is asked only in the author's own chat (keyed on the conversation's `atlasChatId`, not the channel) and only with 2 or 3 options. Atlas asks about the first unsure thing in a message: a project with 2 or 3 candidates, a vague update whose words fit 2 or 3 records (Atlas now returns `targetOptions`), or a reply that fits 2 or 3 lines of the open answer. The last replaces phase B's interim AC6 and AC7 text. A typed answer ("the second one", "#212") is read by a DPM rule against the options shown, with no model call. Answering only chooses: the item still waits for its OK in review, where "Or did you mean …" does the same job. An item's question goes to the review after 2 hours (`clarifyExpiryHours`). A line's question closes then. A correction that withdraws the item, or a later reply that makes the card, also closes it |
| J. Standup (started by the person) | M28. "Start my standup" asks up to four questions from the person's open work, answered by tap (Done, Still going, Stuck) or in words, with a "What's it waiting on?" follow-up for Stuck. The answers become one update through the usual review. Each question remembers what it showed, so a change made since the question is a conflict at save (SU3). A question or command typed during a standup runs as normal (SU4). Work someone else owns now becomes an Ask to them at save (M37). Atlas starting a standup by itself is drawn and model-checked but waits on phase F |
| H. Ask about people | Topic `people` under CD9, one list in `queries/people.ts` (`personSeenBy`, `peopleSeenBy`, `ownedOn`). "What is Kemar working on?", "What did Kemar say about the feed?" and "Who owns the store feed?" all read it, and only for projects the asker shares. In a follow-up, the newest words decide. "What is Forager doing?" becomes `project_status` |
| N. Questions for leads | Topics `not_updated` (saved updates only), `my_decisions` (every inbox item that waits on the asker's decision), `at_risk_week` (K's signals included, through `signalsFor`), `portfolio` and `who_free` (through H's rule). Roles are checked per project. The weekly lead digest waits on phase F |
| K. Signals | M29 with the model check's memory, episode and escalation fixes. Six rules (repeated blocker, stale work, slipping forecast, decision left waiting, quiet project, milestone at risk). An "Atlas noticed" inbox item offers Accept as a risk (through M15), Add to a covering risk, or Dismiss with a reason. A signal comes back only if it gets worse. A PM can pause signals on a project (CD13) |
| Q. "What is Forager?" | Topic `explain_project`: what a project is for, its customer, dates, threads, milestones, decisions and where a newcomer starts. An outside contact gets a client view (name, customer, dates and releases) only when their contact row has `client_view` on and the group is still connected to DPM |

### Checked

- Each phase was built, checked by an agent that had not written it, and then fixed. The checks found 50 gaps, 17 of them must-fix: D 9 (2), J 7 (4), H 11 (4), N 11 (2), K 4 (1), Q 8 (4). Every must-fix gap is fixed with a test. So is every should-fix gap except those listed under "Not built yet".
- On `atlas-conv/wave-3`, rerun by me: typecheck and lint are clean, and 1,878 unit tests pass (1,421 before). The integrator's runs: the browser story passes 27 of 27, and all 401 model-check rows match.
- Full eval on `read-16`: 158 of 159. The only miss is `andre-decision` (D23, as before). Three cases passed with an extra item: `filler`, `ja-sen-it` and `ja-mi-a-go`.
- Migrations `0014_clarifications`, `0015_standups`, `0016_signals` and `0017_client_view` come after main's `0013_undo_and_vocabulary`.

### Fixed by the checks (the serious ones)

- **D:** a question could offer options that every tap would refuse. A "Resolve" reply over lines that only offer approve gave refused buttons; it now says "You can't resolve A or B here." A record option could also clash with another item in the same message, which made the update unsaveable. Typed ordinals counted over options the author could no longer see.
- **J:** a tap of Done could overwrite a teammate's Blocked set after the question was asked (SU3). The review kept showing a question's text after the person left that project (P10). Every message typed during a standup, "Undo that" included, was taken as an answer (SU4). The standup also asked only about work a same-day update had left out, which CD12 rules out.
- **H:** follow-ups ("and Andre?", "and the trend model?") repeated the earlier answer. "Who's working on #151?" missed the people rule entirely. "Who owns …" read its own list, which disagreed with CD9.
- **N:** "all my projects" took due, blocked and updates questions away from their topics. "Who hasn't updated so far today?" was refused as another day. A PM could learn from `not_updated` that someone had an unsaved draft (decision W3-D7).
- **K:** Accept added a signal to a risk that had been closed or declined since the card was shown (E83). A signal whose level was behind its facts could never be answered (SG6).
- **Q:** a follow-up naming a project the asker is not in got the project asked about before. Lowercase names ("what is gq") were explained as the asker's only project. The `explain_project` rule took "What's wrong?" and "I'm new here, what needs me?" away from their topics. An outside contact could read a project after its group was disconnected (P10).

### Integration

- J's and N's `standupTime` are now one config key. N's `at_risk_week` reads K's `signalsFor`, with a test for a signal raised to the asker and one raised to someone else. Q's browser step now waits for the new conversation before asking.
- PROMPT_VERSION is `read-16`, with a comment naming what D, J, H, N and Q each added (K adds nothing to the prompt).
- The three merges that needed conflicts resolved (`5574b24`, `fcef8d1`, `33630da`) have no Co-Authored-By line. Adding it would mean rewriting history, so it was left.

## 2. Decisions for review

Each row shows what was built. The recommended answer is in the last column.

| # | Question | Built | Recommended |
|---|---|---|---|
| W3-D1 | CL8: with no model connected, may Atlas still ask "which line?" when a reply fits two answer lines? | Yes: DPM's own rule reads the reply, and the options are the asker's own lines | Keep. CL8 then reads "no item clarification without a model" |
| W3-D2 | AC6 with only one line that offers the act | "I'm not sure which one you mean" | Keep. M21 needs 2 options, and a one-option question is a confirm card in disguise |
| W3-D3 | CD12: a standup the person starts after a same-day update | Asks about all their open work, as the model's Start does. Saved changes are no longer open, so they are not asked about | Keep |
| W3-D4 | A standup with typed answers when no model is connected | The composed read fails, and the tap answers are lost with it | Keep the tap proposals and leave the typed words for the review (rule 5: nothing lost). Not built yet; a small change |
| W3-D5 | PP7: should PMs and Leads see someone's upcoming leave ("away 26 to 30 Oct")? | Only leave that is on today | Yes, for PMs and Leads, who already see it in the leave-impact inbox item. Not built yet |
| W3-D6 | "Who owns #142?" when #142 is done or closed | "Nothing open on your projects matches" (CD9's open list) | Keep |
| W3-D7 | LD9: does an unsaved update count as "has updated"? | No: only saved updates count, and the words say "no update saved today". In the seed, Kemar's unsaved 8:58 note no longer counts | Keep (rule 9: the capture is its author's until saved) |
| W3-D8 | K: does Accept file an open risk or a proposal? | An open risk: only a PM or Lead can accept, and their report goes straight onto the log (M15) | Keep |
| W3-D9 | K: may Leads pause signals on a project? | PM only | Keep |
| W3-D10 | K: a browser clock override so the story can show SG2, SG8 and SG10 | Not built; DB tests cover all three | Don't build now |
| W3-D11 | Q: who turns a contact's client view on, and does a release show its target or its forecast? | Only the seed turns it on (Kyle on Forager). Releases show the target date | A PM turns it on from the project's contacts (a small command, wave 4). Keep the target date |
| W3-D12 | Questions that need a choice: EX5 (two projects fit "what is …"), PP2 (two people fit "Kemar") and the chat welcome | Plain "Say it again with its name" answers. The welcome lists Q's and J's additions but not H's or N's | Wave 4 extends M21 to questions with 2 or 3 options. The welcome shows the lead questions to PMs and Leads only |

## 3. Corrections for the plan

- **M21:** a line's question also ends when a later reply makes the M20 card for one of its options (ANSWER, `answeredBy` that reply). An item's question also ends when a CV10 correction withdraws the item (CLOSE, "corrected"). Words that fit no option are not an answer: they are read as a new message, and the question stays. Close matches leave out any field another item of the same message changes. A line question is asked even when the reply also holds an update.
- **CL4:** "the newest" means the newest open question in the same conversation.
- **M28:** a question carries `saw` (state and forecast as shown), and DPM's tap proposals carry it as `shownValue`. An Atlas change to a field a tap already proposes is dropped. Overdue work is not asked "still on for …?". SU9 (on leave) exists only as the scheduled arrow, so a person on leave who starts a standup still gets one. Commitments due wait for phase E.
- **M37 at save:** a record always has an owner (NOT NULL in the schema), so the "no owner" case cannot happen.
- **H:** a follow-up keeps the earlier person or thing only when it says nothing but where ("and on GQ?"). PP6 with two people answers one person and names the other as left out.
- **N:** `my_decisions` also lists `confirm_clear`, `dependency_due`, `follow_up` and the leave decisions the asker makes. "What needs my approval?" stays `needs_me`. An executive's whole-org view waits on KB F16 (lens tags).
- **M29:** the time rules' levels go up in steps (one step per further `staleWorkDays`, `quietProjectDays` or `decisionWaitDays`), not in days, so an answered signal does not come back the next night. On Accept, the covering risk is looked up again: if it is no longer the one offered, the tap is refused with what the risk is now. A risk that only moved from proposed to open still counts.
- **EX4:** `project_contacts.client_view`, off by default. The contact row counts as the outside person's link to the org. EX6 must not reuse `explainProject` in a group, because it reads the asker's own view.

## 4. Not built yet

- Atlas starting a standup, the weekly lead digest, and signals as nudges: all wait on phase F.
- EX6 (explaining a project in a group): waits on phase I.
- W3-D4, W3-D5, W3-D11 (the switch) and W3-D12, if accepted.
- Usage numbers for D, H, J, K, N and Q (W6).
- A "leave project" command (the SG9 test changes the membership row directly).
