# Atlas conversational plan: wave 2 (27 Oct 2026)

**Goes with:** `atlas-conversational-plan.md` (phases B, C and L) and `01-update-to-plan-machines.md` sections 15 to 20
**Branch:** `atlas-conv/wave-2`, from main at `4719833` (section 20's U5 to U8 included). Not merged into main. Nothing pushed.
**Status:** built and checked, waiting for review.

## 1. What was built

| Phase | What it is |
|---|---|
| B. Act from an answer | Answer lines carry their screen's actions: Approve and Decline (a proposal, a U3 proposed outcome, or "it's cleared"), Resolve, Mark done and Unblock (your own work; new command `commands/work.ts`), Give a reason, Open review. A typed reply ("Approve the Kyle risk") is read against the open answer's lines and becomes one confirm card per line. M20 Chat command with its model-check fixes: the referent is checked against the asker's lines now; CONFIRM checks the right, then the version; cards expire after 30 minutes. Each command runs the screen's own command in a savepoint, so U3 and U4 behave as on the screen |
| C. Ask why | M12 explains itself (contributing facts, no status changed). Topic `why` with a checked subject and four answers: why a status (set or calculated), what holds something up, when something was decided (up to three, quotes only under rule 9), why a field changed (from the audit trail). Work item forecasts (U6) are part of the facts |
| L. Undo and corrections | "Undo that" and an Undo button within 15 minutes: M30 with UNDO arrows on work item, milestone, handover, BRAID report, set status and leave; a save writes an UNDO_RECEIPT to the audit log; all or nothing in one command. Topic `why_filed` for the asker's own items. Corrections ("Kyle is Store Insights, not Forager", "GQ also means the Academy", or the same word moved twice in review) propose an M31 Vocabulary change to a PM or Lead, with the clash checked again at APPROVE and only against projects the person told can open |

### Checked

- Each phase was built, checked by an agent that had not written it, and fixed: B 8 gaps (1 must fix), C 11 (5 must fix), L 14 (1 must fix). All must-fix gaps are fixed with tests.
- On `atlas-conv/wave-2`: typecheck and lint clean, 1,418 unit tests pass (1,099 before), the browser story passes 16 of 16, all 400 model-check rows match (a new `undoArrows.mjs` checks every UNDO table against every move one save can make).
- Full eval on `read-14`: 125 of 127. Misses: `andre-decision` (D23, as before) and `alicia-approve-by-message` (decision W2-D2 below).
- Migrations `0012_chat_commands` and `0013_undo_and_vocabulary`, after main's `0010_owner_asks` and `0011_work_item_forecast`.

### Fixed by the checks (the serious ones)

- B: the open answer's lines went to the model without checking the asker could still read each one (P10). Lines on a project they left are now taken out before the read.
- C: a cancelled work item the asker can read was answered as if it did not exist (WY1); "Who approved …" and declined decisions found nothing (WY4); "Why was #145 moved to Friday?" answered about any field, not the one asked (WY6); the WY5 test tested nothing.
- L: a refused correction was shared by everyone, so its clash could name a project the asker cannot read (UN9, P10). Refusals now belong to the asker.

## 2. Decisions needed

| # | Question | Recommended | What the code does now |
|---|---|---|---|
| W2-D1 | Undoing a save that created Asks to the owner (section 20, M37): do they stay? | Withdraw the save's live Asks with a new M37 arrow, so the owner is not left deciding something taken back | They stay asked; a save made only of Asks reads as nothing to undo |
| W2-D2 | "I approve Kemar's risk" with no answer open: should Atlas make a command at all? | No: commands only when an answer is open (tighten the prompt); the eval case stays as it is | The model makes one; the checks turn it into "There's no answer here to act on yet", so nothing is approved, but the eval counts it as a miss |
| W2-D3 | A reminder (S18) bumps an entry's version, which refuses a chat command made before it. Should it? | No: reminders and other bookkeeping do not count as a change for AC3 | Any version bump refuses: "This changed at …, after your answer." |
| W2-D4 | May a PM or Lead approve a correction they proposed for their own project? | Yes, as built (they hold the right, checked when they approve) | Allowed; they are told it waits in their own inbox |
| W2-D5 | M31's third kind, "a person tied to a record" | Drop it for now: DPM ties people to projects, not records | Not built (alias and contact are) |

## 3. Corrections for the plan

- **AC6 and AC7** wait for phase D. Until then: "Did you mean "A" or "B"? Say it again with its name." or "I'm not sure which one you mean."
- **Open review** is navigation, not an M20 command. **Resolve** joins the card actions. A typed decline with no reason keeps its card open with a reason box. Button taps are once only per (answer, line, act); "Ask again" resends the question.
- **A reply that is only a command** ends M2 in `answered` (PROPOSALS_READY counts "a reply decided something" as asked).
- **WY2's example** does not match M12 (any forecast past target is At risk; the tolerance separates At risk from Off track). The On track answer says every open milestone is forecast on or before its target.
- **WY5 cannot happen** with properly saved data: a decision lives in the project its update was routed to. Someone outside it gets WY1.
- **WY6:** DPM has no command that moves a work item's due date or a target; the answer says so and gives the current date.
- **Which why answer** is decided from the words and the subject type (`whyAsks`); Atlas gives only a subject id, and the server works out its type.
- **M30:** an entry the save created goes back to `none`; leave joins the UNDO list (a requested leave is withdrawn); handover steps go back by a versioned write (no machine of their own); undo is one command, so `undoing` never lasts. One undo per save.
- **M31:** refusals belong to the asker (the clash depends on who asks); drafts carry `routedBy` so CD14 knows the deciding word; applying an alias does not bump the project's version.
- **Not built yet:** in-chat buttons for owner asks and vocabulary changes (they show as linked cards); "Add to the BRAID log" in the chat's reason form; Mark done and Unblock on the project screen; a banner on the review of an undone save; usage numbers for B and L (W6).
