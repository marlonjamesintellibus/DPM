# Atlas conversational plan: wave 4 (28 Oct 2026)

**Goes with:** `atlas-conversational-plan.md` (phases E, G, O and P, with CD49 and CD50) and `01-update-to-plan-machines.md`
**Branch:** `atlas-conv/wave-4`, from main at `7bda527`. Nothing pushed.
**Status:** built, checked and decided; merged into main.

## 1. What was built

| Track | What it is |
|---|---|
| E. Commitments | M22, built as the model check's fixed design. "I'll send Kyle the access request tomorrow" is a new item kind, `commitment`, private to its author (CD3) and shown under "You" in the review with its due day to correct (CM2, CD4). A promise to finish the author's own work item or milestone by a day becomes that record's forecast (CM3), and someone else's promise is refused (CD5). Both are also checked on the server. Save opens the promise, moves the live one it matches (CM5), or ends the one an update says is done (CM6). The linked work going Done ends the promise; cancelled work asks once whether it still stands (CM11). When its day ends the promise is due. From `commitmentCheckInTime` on a working day the owner is in (CM7, CM8), a check-in offers Done, New date and Drop. A second check-in follows, then it lapses; after 3 moves it asks whether to drop it (CD24). "What did I promise?" is topic `commitments`, with Done, New date and Drop on each card (CM12) |
| G. Drafts | M25, built as the fixed design plus two more fixes from the check. "Draft my standup", "Draft a client status for Forager" and "Draft the weekly summary for Forager" make an editable card with Copy, Refresh and Discard. The facts come from the asker's own reads (P10) and never include anyone's words (CD8). Atlas writes the draft in a separate call, and the facts check refuses any record, number, day, relative time, status word, name or quote that is not in the facts. After two refusals, or with no model, DPM's plain template is used (DR2, DR6). Copying a client status checks every fact against the client view at that moment (DR4) and checks the PM or Lead right again (rule 4). The status reason reaches a client only after the PM shares it (`status_reasons.client_shareable`, a "Share status with client" button). POST is drawn and tested, but nothing sends it (B8, B9). A standup draft lists the author's promises due today or earlier |
| CD49. Client view switch | A Switch machine (`client_view`) with a model. A Contacts card on the project's Dashboard shows every member each contact's tie and whether they can see the client view. Only the project's PM gets Turn on and Turn off. The command checks the right when it runs, writes only over the value it read, and refuses a repeat in plain words |
| CD50. Questions through M21 | M21 gains `about: "question"`. A question whose words fit 2 or 3 of the asker's projects or people asks "Which project do you mean?" or "Who do you mean?" with a button for each, and gives no answer until one is chosen. This covers EX5 (and "Where do I start?" for someone on 2 or 3 projects), PP2, WY8, and phase O's MT9 call brief. The choice is checked again when it is made (P10). The labels are built each time they are shown. A follow-up carries the chosen person or project by id, whether it was tapped or typed |
| P. Leave and handover | "I'm off next week" is now read as leave: the working days, marked relative, so the card asks for the author's OK. Under a leave message, "While you're away (Mon 26 Oct to Fri 30 Oct): …" lists the work, milestones and promises due then, by the approved dates. M35 is built as the fixed design. The person asks one teammate to cover one or more things on one project. The teammate gets Accept, I can't, or Can't do this one. Accepting proposes an M7 handover once the leave is approved, and the PM is told (CD19). A leave declined, withdrawn, undone or re-dated reaches every request. LV6: "I'm back early, back to work today" proposes a D6 change ending the leave the day before. LV10 moves a promise due during the leave to the first working day back. "Catch me up" (topic `catch_up`) reads from the start of the leave |
| O. Meetings | M33 extends M2, and M34 is built with the check's fixes. A chat message marked as a meeting note, with a project, waits until the recorder ticks who was there and confirms they knew it was recorded. If they weren't told, the note is read as the recorder's own notes only (MT4, CD17). The recorder's own items and every decision stay in the recorder's review. An attendee's promise, or an update to a record they own, becomes an M34 Ask. When they Confirm it, it is saved as theirs, run as them, and only if they still own the record. Unsure speakers are held (MT2). Non-members get nothing (MT1, MT3). Leaving the project withdraws the Ask. The 3-working-day timer pauses during leave (MT12). Two notes of the same meeting can be merged without asking anyone twice (MT7). "Prep me for the Sprouts call" is a client-safe call brief that any member can ask for. When 2 or 3 projects fit, it asks which through CD50 (MT9) |

Until phase F, Atlas still cannot message first. So check-ins, the CM11 question, cover asks and their outcomes, M34 Asks and their outcomes each reach the person as a notice in their DPM chat and, where they need an answer, an inbox item.

### Checked

- Each track was built, checked by an agent that had not written it, and then fixed. The checks found 48 gaps, 13 of them must-fix: E 9 (5), G 7 (1), CD49 6 (0), CD50 8 (2), P 11 (3), O 7 (2). Every gap was fixed with a test, except where a fix needs one of the decisions below.
- I reran these on `atlas-conv/wave-4` after the decisions:
  - typecheck and lint are clean;
  - 2,364 unit tests pass (1,883 before wave 4);
  - all 423 model rows match;
  - the browser story passes 36 of 36;
  - the full eval on `read-17` passes 186 of 187, and 5 of 5 drafting cases pass the facts check. The only miss is `andre-decision` (D23).
- Before the decisions, the integrator's run (the figures below) and mine both had 2,357 unit tests and 418 model rows.
- The integrator's run:
  - The model check matches all 418 rows (401 before). New and changed models: `clientView` (new), `draft` (CopyRight, Rounds), `coverRequest` (LiveCoverOnlyForReaders, awayShown), `meeting` (ownerAtConfirm, transcribing to failed) and `clarification` (question rows).
  - The browser story passes 36 of 36.
  - Full eval on `read-17`: 185 of 187, and 5 of 5 drafting cases pass the facts check. The misses are `andre-decision` (D23, as before) and `kemar-note`, which passed 3 of 6 runs (see W4-D18). Three cases passed with an extra item: `filler`, `inject-close-tag` and `ja-sen-it`.
- Migrations come after main's `0017_client_view`: `0018_commitments`, `0019_cover_requests`, `0020_drafts`, `0021_meetings` and `0022_question_clarify`. The client view switch needs none.

### Fixed by the checks (the serious ones)

- **E:**
  - A typed "Done" meant for a standup question answered an unrelated check-in instead. Now a typed reply answers a promise only when its question is the newest one in that chat.
  - A bare "yes" to CM11's "Does your promise still stand?" marked the promise done.
  - A matched promise whose new day passed while its review waited refused the whole save.
  - A promise linked to work on a project the author had left was saved as "Already done", which told them that record had changed (P10).
  - An open promise could not be dropped until it was checked in on.
- **G:** the facts check let through made-up relative dates ("tomorrow", "next week") and status words ("on track", "done"). That included a status the client view does not show in a client draft (DR4, rule 8).
- **CD50:**
  - A follow-up after a typed answer ("the second one") forgot who was chosen.
  - A who-question's button kept naming a project the asker had since left (P10).
- **P:**
  - Approving leave started a handover to a teammate who had left the project, and told them about it.
  - A decline told the asker about an item on a project they had left.
  - LV6 (back early) was not built.
- **O:**
  - An attendee could confirm an update to a record that had since been given to someone else. That changed the new owner's record on the recorder's word (rules 4 and 10).
  - A no-change or guessed-record update was sent as an Ask instead of staying in the recorder's review.

### Integration

- The integrator merged the tracks in this order: P (which carries E), O (which carries E and G), the client view switch, then the questions.
- Phase O's own M21 "prep" subject is joined into CD50. A call brief is now a CD50 question about projects.
- E's due promises now feed G's standup draft (`commitmentsDue`), which had returned nothing.
- The integrator fixed three browser steps that no track had run against the whole story:
  - CD49's second tab.
  - O's Confirm waiting for the item to leave the inbox.
  - O's MT9 brief, which rightly includes the status reason the PM shared earlier in the story. See W4-D7.
- PROMPT_VERSION is `read-17`, with one comment naming what E, G, O and P added. CD49 and CD50 add nothing to the prompt.
- The e2e data (`pnpm db:reset --e2e`) adds a second Kemar, Kemar Lee, to GQ & Academy for PP2. The only other answer this changes is the GQ sentence of Phase N's "Who hasn't updated today?".

## 2. Decisions (settled 28 Oct 2026, the recommended answers)

Each row shows what was built first and what was decided. The plan records W4-Dn as CD(50 + n), CD51 to CD69.

| # | Question | Built first | Decided |
|---|---|---|---|
| W4-D1 | E: what time do check-ins go out? | `commitmentCheckInTime` "09:00", the same as `standupTime`. Section 23 named no time | Keep |
| W4-D2 | E: a linked work item going Done ends a promise that is only about it ("I'll walk Andre through #208") | It ends, as M22 draws it, and the owner is told it was marked done | Change it. A link going Done ends only a promise to deliver that work (finish, ship, submit, fix and so on). Any other linked promise is asked CM11's "Does your promise still stand?" Built, with a model change |
| W4-D3 | E with J: a check-in and a standup question are both waiting | The newest question takes a typed reply. Buttons always answer their own question | Keep |
| W4-D4 | E with L: undoing a save that moved a promise (CM5) or marked it done (CM6) | Not reversed, because M22 has no arrow out of done. The undo reply names what stays | Keep |
| W4-D5 | G: should a standup draft list promises due tomorrow too? | Only those due today or earlier | Keep |
| W4-D6 | G: who may share the status reason with a client, and does Q's client view show it? | The PM only. "What is Forager?" for an outside contact does not show it | The PM only, as CD49. Yes, Q's client view shows a shared reason too. Built |
| W4-D7 | G: may a reason shared with the client name internal records? In the story, Forager's shared reason names #151 and Trend model, so the Sprouts brief shows them | Yes: the reason is the PM's own words, shared on purpose | No. "Share status with client" refuses a reason that names a record the client view does not show ("It names #151, which Sprouts can't see. Reword it first"). Built |
| W4-D8 | G: CD30 for record names | A name made only of everyday words ("Trend model") counts only with its capital, so "the trend model" passes the client copy check. A name with a digit, # or inner capital counts in any case | Keep |
| W4-D9 | CD49: who sees the Contacts card, and is the map's open question F8 closed? | Every member sees it, as CD9 already shows contacts. F8 left open | Keep the card for every member. F8 is closed as settled by CD49, CD56 and CD57 |
| W4-D10 | CD50 with CD23: a message with an unsure item and a two-fit question | The item always takes the message's one question, and the question gets the old "say it with its name" text | Keep |
| W4-D11 | CD50: someone asks again in their own words while a which-question is open | The new message is answered, but the old question stays until its 2-hour timer, then says "Nothing was chosen; ask me again" | Close the old question quietly when a later message answers the same question, as a line's question does (`answeredByCards`). Built |
| W4-D12 | P with LV2: a member asks a teammate who is away | Asked: a member is not shown the teammate's leave (P10), so it cannot refuse. The ask times out after 24 hours and Atlas offers again | Keep |
| W4-D13 | P with LV4: M8 cannot cancel approved leave, so a proposed handover is never cancelled through the app | Built and tested by writing the leave state directly | Add an M8 arrow to cancel approved leave before it starts, model-checked, in wave 5 |
| W4-D14 | P10: a chat notice stays visible after its reader leaves the notice's project | O hides its own Ask notices. E's and P's notices stay | Filter every notice by its project when it is read. Built |
| W4-D15 | O: an Ask whose record changed owner, and a sure promise by someone named but not listed (MT3) | The Ask is withdrawn, not passed to the new owner. The promise becomes a dependency in the recorder's review and cannot be sent to that person | Keep both. An ADD_ATTENDEE arrow waits until it is asked for |
| W4-D16 | O with L: undoing the recorder's save | It does not touch M34 Asks, which were sent at read time | Keep |
| W4-D17 | O with MT7 and CD18: when are two notes the same meeting? | Same project, within `meetingMatchMinutes` (120), and each recorder listed the other as there. A merge sends nothing twice | Keep, and add `meetingMatchMinutes`, `commitmentDropAfterMoves` and `commitmentCheckInTime` to section 23 |
| W4-D18 | Eval: `kemar-note` passes 3 of 6 on `read-17`; it passed on `read-16`. Atlas sometimes puts "the trend model will slip to the 26th" on #147 instead of the Trend model milestone | Left as it is. E's CM3 prompt lines are the likely cause, but this is not confirmed | Fix the prompt before main moves, then rerun `kemar-note` 6 times and the full eval. Built: 6 of 6 |
| W4-D19 | CD50 with WY8: "Why is Kemar behind?", choose Kemar Smith, then "and on GQ?" | Answered about GQ's status, the why topic's existing reading of a follow-up that names a project | Keep |

### Built for the decisions

- **W4-D2 (CD52):**
  - `deliversLinkedWork` in `domain/machines/commitment.ts` reads whether a promise's words deliver its linked work.
  - The rule's DONE needs it. M22's WORK_CANCELLED becomes WORK_ENDED, which asks the question for cancelled work, or for Done work under a promise only about it.
  - Save does the same: such a promise saves with the question asked instead of No change.
  - The notice and inbox item say "is Done" or "was cancelled".
  - The model gains the fix askWhenAbout, the invariants DoneWorkAsksAbout and AboutNotLost, and the property WorkEndsOnlyDelivery. It also gets three rows and two planted bugs.
- **W4-D6 (CD56):** `clientViews` reads the set status and the latest reason. "What is Forager?" for Kyle ends "Its status is off track: …" only while that reason is shared.
- **W4-D7 (CD57):**
  - `shareReasonWithClient` refuses a reason that names a record the client view hides (`hiddenNamedIn` in `queries/drafts.ts`, CD30 for records).
  - In the browser story, the reason from step 6 names the blocker and the risk, so phase G now shows the refusal. The MT9 brief holds no status.
- **W4-D9 (CD59):** F8 is removed from the map's open questions in `map-data.mjs`.
- **W4-D11 (CD61):** `closeAskedAgain` in `commands/clarification.ts` runs when a later message on the same topic names one of the open question's options. The new message is answered, and the old question closes with `endedBy: "asked_again"` ("You asked again."). CL4's test now opens its second question on another topic.
- **W4-D14 (CD64):** `noticesFor` hides every notice whose project the viewer can no longer read. A promise's notices that name its linked record now carry that record's project.
- **W4-D17 (CD67):** `commitmentDropAfterMoves`, `commitmentCheckInTime` and `meetingMatchMinutes` are in the plan's section 23.
- **W4-D18 (CD68):** in the prompt, CM3's example no longer names #147, a real record, and a slip said of a milestone is that milestone's forecast. PROMPT_VERSION stays `read-17`, since it was never on main. `kemar-note` passes 6 of 6, and the full eval 186 of 187 (only `andre-decision`, as before).

## 3. Corrections for the plan

- **M2 with M33:** START is refused while a meeting note waits for its attendees, and `received --EXPIRE--> expired` when the meeting expires.
- **M22:**
  - The same promise said again with the same day is No change, and no move is counted.
  - A promise whose day passed while its review waited goes back to its card.
  - CM3 and CD5 are also checked on the server. CD5's check is a word list, so it is only a floor.
  - A typed reply is read by DPM's rule with no model, and only in the chat where the promise was made.
  - Repeats carry a command id (rule 6).
- **M25:**
  - COPY checks the right when it runs (CopyRight).
  - A try's number only goes up across Refresh (Rounds), so a late reply changes nothing.
  - A standup asked for with no project closes once its owner can no longer read one of its projects.
  - Section 9's facts check also covers relative times and status words.
- **M21 with MT9:** a call brief that fits 2 or 3 projects is a CD50 question. The message has no answer until a project is chosen, and the timer says "Nothing was chosen; ask me again".
- **M35:**
  - Approval, Decline and Can't do this one all check again that both people still read every item.
  - A cover's live handover is cancelled when either person leaves the project (LiveCoverOnlyForReaders).
  - Only declined or withdrawn leave cancels handovers. Leave that simply ends does not.
  - LV2's refusal applies only when the asker is shown the teammate's leave (awayShown).
- **LV1:** "next week" is its working days, Mon to Fri, marked relative.
- **LV6:** the last day of leave is the day before the day back.
- **M34:**
  - CONFIRM needs the person to still own the record (`waiting|proposed --REASSIGNED--> withdrawn`).
  - FIX_SPEAKER may name anyone on the project or one of its contacts.
  - Section 17's model check now lists seven fixes (ownerAtConfirm).
- **Section 21:** AnswerNumbers gains `unchosenRate`: Atlas asked which one was meant and nothing was chosen.
- **Section 23:** add `commitmentDropAfterMoves` (3), `commitmentCheckInTime` ("09:00") and `meetingMatchMinutes` (120).

## 4. Not built yet

- Phase F: every check-in, cover ask, M34 Ask, and lapse or outcome message is a notice in the person's DPM chat plus an inbox item until Atlas can message first.
- Posting a draft (B8, B9). Copy is the only way out.
- Phase J's standup with Atlas asking about due commitments (section 12). Only the drafted standup lists them.
- The map page (`dpm-machine-map.html`) is not rebuilt with `build-map.mjs` since wave 4's model changes.
- A typed "drop it" for an open promise with no check-in out. The cards' buttons do it.
- A "leave project" command. `withdrawOnLeave` (O) is exported for it, and the timers act as the backstop.
- An M8 arrow that cancels approved leave (W4-D13, wave 5), and M34's ADD_ATTENDEE (W4-D15).
- who_free's "N things match … ask again with its number" through M21 (it would need a work-item fits kind).
- The call brief's chases waiting on the client (phase M).
- Usage numbers for E, G, O and P (W6).
- A cover for a requested leave that was never decided, and whose dates have passed, stays `waiting`.
