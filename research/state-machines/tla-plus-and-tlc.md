# TLA+ and TLC for DPM

**What this is:** a plan and a starter kit for checking the DPM state machines (knowledge base Part C) with TLA+ and its model checker, TLC.
**Built from:** `DPM-knowledge-base.md` (Parts A, C and F) and Leslie Lamport's "Learning TLA+" page (https://lamport.azurewebsites.net/tla/learning.html) and the video course it points to.
**Status:** first draft, 24 Oct 2026. The 5 specs below **have been model checked with a JavaScript port** (`js/`, section 10) and all 13 settings behave as expected (section 11). They **have not been run through TLC itself yet** (this machine has no Java runtime); do that once Java is installed, to confirm the TLA+ text and the JavaScript port agree.
**For:** Carl (state machines), Anubis (grid workflow states), Malik (Atlas), Ed Watal (decisions in Part F).

---

## Contents

1. Why TLA+ fits DPM
2. TLA+ and TLC in 1 page
3. Learning path, mapped to DPM
4. How we model DPM in TLA+ (conventions)
5. Spec 1: Tracked status, roll-up and reasons (C3, A4)
6. Spec 2: Capture and extraction (C1, A9.2)
7. Spec 3: Atlas suggestion and action (C5, P5)
8. Spec 4: Help request and its 60 minute target (C10)
9. Spec 5: Staged pipeline and refinement (C11, C14.10)
9a. Specs 6 to 10: BRAID entry, routing, matching, saving a capture, inbox items (use case 1, JavaScript first)
10. Running TLC
11. Expected results
12. Answering the C14 research questions with TLA+
13. Open decisions (Part F) as model constants
14. What TLA+ will not do for us
15. Next steps
16. The DPM machine map

---

## 1. Why TLA+ fits DPM

Part C of the knowledge base already describes DPM as state machines: lifecycles, events, guards and timers. TLA+ is a language for writing exactly that kind of description precisely, and TLC is a tool that walks every reachable state of a small version of it and reports any step that breaks a rule.

The rules in DPM that a quick design or a quick build is most likely to break (knowledge base, "How an agent should use this document", point 4) are the ones TLC is good at:

| DPM rule | Kind of property | Example of what TLC can catch |
|---|---|---|
| P5 AI proposes, people decide | Safety invariant | A path where Atlas executes an action nobody approved |
| P6 No AI in the numbers | Modelling rule | Status is an operator over the state, never a stored value Atlas writes |
| P9 A disagreement needs a reason | Safety invariant | A set status that differs from the calculated one with no reason and no inbox item |
| A4.2 Roll-up is worst child | Safety invariant | A parent that says Done while a child is still at risk |
| A9.2 Medium and Low confidence never auto-accept | Safety invariant | A new shortcut (for example "auto-save after 5 minutes") that applies an unreviewed update |
| C4 Inbox items auto-close | Liveness | An inbox item that stays open after its cause is gone |
| C10 First reply target | Liveness with fairness | A request that waits forever without ever being flagged |
| C14.5 Same event from 2 channels | Safety invariant | The same update applied twice because it arrived in Atlas and in the app |

The point is not proof for its own sake. Many of the **OPEN** items in Part F are choices between behaviours. TLC lets us write each option as a setting, run it, and see a concrete step by step trace of what goes wrong with each one before anything is built.

## 2. TLA+ and TLC in 1 page

- **A system is a state machine.** A spec gives the variables, the possible starting states (`Init`) and the possible steps (`Next`). Every behaviour of the system is a sequence of states that starts in `Init` and moves only by `Next` steps (or stutters).
- **Safety: nothing bad happens.** Written as an **invariant**, a formula that must be true in every reachable state. TLC checks every state and, if one fails, prints the shortest trace that reaches it.
- **Action properties.** Some rules are about steps, not states ("when an action starts executing, the approver must still hold the right"). These are written `[][P]_vars`, where `P` mentions both the current state and the next state (primed variables).
- **Liveness: something good eventually happens.** Written with `~>` ("leads to") or `<>` ("eventually"). Liveness needs **fairness** assumptions, which say which steps cannot be postponed forever (`WF` weak fairness, `SF` strong fairness). Deciding what is fair is a design decision: a timer firing is fair, a person answering is not.
- **Refinement.** One spec can implement another. A refinement mapping says how the detailed spec's state looks in the simpler spec's terms; TLC checks that every detailed behaviour is an allowed simple behaviour.
- **TLC** checks a **model**: the spec plus small values for the constants (2 people, 2 actions, 3 children). Most design bugs show up with very small models.
- **PlusCal** is a pseudocode-like language that translates to TLA+. It is easier for engineers who think in code. The specs below are in plain TLA+ because DPM is better described as states and events than as sequential code.

## 3. Learning path, mapped to DPM

Lamport's page recommends the video course as the best way for most beginners to learn TLA+. The resources it lists, and where each one helps on DPM:

| Resource (from the Learning TLA+ page) | Use it for | DPM link |
|---|---|---|
| TLA+ Video Course, https://lamport.azurewebsites.net/video/videos.html | Start here. Assumes basic programming only. Does not cover PlusCal. | Everyone working on Part C |
| "Not in the video" operators, https://lamport.azurewebsites.net/video/not-in-video.pdf | Operators the videos skip | Reference |
| PlusCal Tutorial (14 sessions) | If engineers want to write specs as algorithms | Atlas pipeline (C1) if written as a process |
| LearnTLA by Hillel Wayne, https://learntla.com/introduction/ | Beginner PlusCal course; covers most PlusCal, not all TLA+ operators | Engineers who prefer PlusCal |
| Practical TLA+ by Hillel Wayne | Full PlusCal course in book form (Lamport has comments on it) | Same |
| PlusCal Manual, C-syntax and P-syntax | Reference; the page notes most users prefer C-syntax | Same |
| *Specifying Systems* (book) | Complete reference for TLA+ and TLC as of 2002; later changes listed separately | Reference when writing specs |
| TLA+ cheat sheet (7 pages) | Language and standard modules on one sheet | Keep open while writing |
| *A Science of Concurrent Programs* (draft) | The logic under TLA+ and its design rationale | Advanced only |
| TLA+ Hyperbook (unfinished) | Another introduction, including the TLAPS proof system | Optional |

The 10 lectures, and the DPM spec each one prepares you for:

| Lecture | What it teaches | Practise it on |
|---|---|---|
| 1 Introduction | Why specs, and what a state machine is | C0 modelling notes |
| 2 State machines in TLA+ | A first spec | C6 work item (to_do, in_progress, blocked, done, cancelled) |
| 3 Resources and tools | Installing the Toolbox, running TLC | Section 10 |
| 4 Die Hard | Using an invariant violation as an answer | Spec 1 `DoneWins`: TLC's counterexample is the argument for a Part F decision |
| 5 Transaction Commit | Functions as variables | Spec 1 `child \in [Items -> Statuses]` |
| 6 Two-Phase Commit | Records, more TLC | Spec 2: SAVE is a commit that needs every update decided first |
| 7 Paxos Commit | A fault-tolerant protocol, sets | C14.5 and C14.6: the same event from 2 channels, GitHub and DPM disagreeing |
| 8 Implementation | Temporal formulas, one spec implementing another | C14.2: is roll-up one composed machine or independent machines plus a reducer? |
| 9 Alternating Bit Protocol | Liveness and fairness, lossy channels | Specs 2, 3 and 4 liveness; Atlas messages that arrive late, twice or not at all |
| 10 Refinement | Refinement mappings | Spec 5 and C14.10, the minimal set of machines |

## 4. How we model DPM in TLA+ (conventions)

These follow the modelling notes in C0.

1. **Lifecycle states are variables. Statuses are operators.** C0 says statuses are mostly derived. In the specs, a calculated status is a TLA+ definition over the state (for example `Calculated == Worst({child[i] : i \in Items})`), never a variable. This is P6 written into the model: nothing can write a calculated status, Atlas included. The only stored status is a set status (A4.3), and it always comes with its reason state.
2. **Keep the two vocabularies apart (A4.1).** Status values are only `"not_started"`, `"on_track"`, `"at_risk"`, `"off_track"`, `"done"`. Lifecycle values (`"open"`, `"mitigating"`, `"blocked"` and so on) live in separate variables.
3. **Actors are action parameters.** `Approve(p, a)` names who approved what. Guards check role and scope (C0, A7). Atlas is never in the set of people who approve.
4. **Atlas proposes.** Any step Atlas takes moves a record to a proposed or awaiting state. A separate person step moves it on (P5, A9.2).
5. **Time is abstract unless the number matters.** A timer ("60 minutes pass with no first reply", "14 quiet days") is an action that may happen at any moment before the thing it races. This keeps models small and still finds ordering bugs. When an exact duration matters (comparing 2 thresholds from F10), add a discrete clock variable with a TLC state constraint.
6. **Open decisions are constants.** Each Part F option becomes a model constant, so one spec can be run once per option (section 13).
7. **Tiny models.** 2 or 3 of everything. If a rule can break, it nearly always breaks with 2 people and 2 items.
8. **Style.** Names in specs follow the knowledge base (C-section names), and each spec cites the sections it covers.

---

## 5. Spec 1: Tracked status, roll-up and reasons (C3, A4)

Covers: the 5 statuses (A4.1), worst-child roll-up (A4.2), set vs calculated and the override sub-machine (A4.3, C3), the "Status set with no reason" inbox item (C4, A10.1), and the open question of set status expiry (A4.3 **OPEN**, F3).

The model is 1 parent (a project) with a few children (threads). Rules move children's statuses. The owner may set a different status for the project.

`TrackedStatus.tla`

```tla
--------------------------- MODULE TrackedStatus ---------------------------
(***************************************************************************)
(* DPM knowledge base A4.1, A4.2, A4.3, C3, P6, P9.                        *)
(* One parent with a few children. Rules change the children. The parent's *)
(* calculated status is the worst child. The owner may set a different     *)
(* status, which needs a reason.                                           *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets, TLC

CONSTANTS Items,         \* the children, for example {t1, t2}
          ExpiryPolicy,  \* F3: "when_agree", "on_any_change", "when_done", "after_days"
          ReasonStale    \* use case 1, M9: flag a reason when the plan moves under it

VARIABLES child,      \* child[i]: calculated status of child i, set by rules
          setStatus,  \* the owner's set status for the parent, or "none"
          hasReason,  \* has the owner given a reason?
          override,   \* the C3 override sub-machine
          inbox       \* open inbox items for the owner (C4)

vars == <<child, setStatus, hasReason, override, inbox>>

Statuses == {"not_started", "on_track", "at_risk", "off_track", "done"}

\* A4.2 order: Off track > At risk > On track > Not started > Done
Rank(s) == CASE s = "done"        -> 0
             [] s = "not_started" -> 1
             [] s = "on_track"    -> 2
             [] s = "at_risk"     -> 3
             [] s = "off_track"   -> 4

Worst(S) == CHOOSE s \in S : \A t \in S : Rank(t) <= Rank(s)

\* P6: the calculated status is a definition, never a stored variable
Calculated == Worst({child[i] : i \in Items})

\* A4.3: once a reason is given, the set status wins for display (a stale reason still shows it)
HasExplanation == override \in {"explained", "reason_stale"}
Displayed == IF HasExplanation THEN setStatus ELSE Calculated

\* C3 transitions for a child
CanMove(a, b) ==
  \/ a = "not_started" /\ b = "on_track"
  \/ {a, b} = {"on_track", "at_risk"}
  \/ {a, b} = {"at_risk", "off_track"}
  \/ a \in {"on_track", "at_risk", "off_track"} /\ b = "done"

TypeOK ==
  /\ child \in [Items -> Statuses]
  /\ setStatus \in Statuses \cup {"none"}
  /\ hasReason \in BOOLEAN
  /\ override \in {"calculated_only", "reason_required", "explained", "reason_stale"}
  /\ inbox \subseteq {"status_set_with_no_reason", "keep_set_status"}

Init ==
  /\ child = [i \in Items |-> "not_started"]
  /\ setStatus = "none"
  /\ hasReason = FALSE
  /\ override = "calculated_only"
  /\ inbox = {}

\* Back to calculated only. The inbox item auto-closes because its cause is gone (C4).
ClearOverride ==
  /\ setStatus' = "none"
  /\ hasReason' = FALSE
  /\ override' = "calculated_only"
  /\ inbox' = {}

\* Does the set status end when the calculated status moves to newCalc?
\* Every policy ends it when they agree, so "when_done" means "when they agree or the work is Done".
Expires(newCalc) ==
  \/ newCalc = setStatus                                       \* they agree again (C3)
  \/ ExpiryPolicy = "on_any_change" /\ newCalc # Calculated
  \/ ExpiryPolicy = "when_done" /\ newCalc = "done"

\* A rule recalculates one child (a date passes, an issue closes, a forecast moves)
RuleUpdatesChild(i, s) ==
  /\ CanMove(child[i], s)
  /\ child' = [child EXCEPT ![i] = s]
  /\ LET newCalc == Worst({child'[j] : j \in Items}) IN
       IF setStatus # "none" /\ Expires(newCalc)
         THEN ClearOverride
       ELSE IF ReasonStale /\ override = "explained" /\ newCalc # Calculated
         THEN /\ override' = "reason_stale"           \* the plan moved under the reason
              /\ inbox' = inbox \cup {"keep_set_status"}
              /\ UNCHANGED <<setStatus, hasReason>>
         ELSE UNCHANGED <<setStatus, hasReason, override, inbox>>

\* The owner sets a status (C3 set_differs, then reason_required).
\* Guards are proposals: no override on finished work, and an owner cannot set Done.
OwnerSets(s) ==
  /\ Calculated # "done"
  /\ s \in {"on_track", "at_risk", "off_track"}
  /\ s # setStatus
  /\ IF s = Calculated
       THEN ClearOverride
       ELSE /\ setStatus' = s
            /\ hasReason' = FALSE
            /\ override' = "reason_required"
            /\ inbox' = {"status_set_with_no_reason"}
  /\ UNCHANGED child

\* C3 explained: reason saved and linked to the risk log
OwnerGivesReason ==
  /\ override = "reason_required"
  /\ hasReason' = TRUE
  /\ override' = "explained"
  /\ inbox' = inbox \ {"status_set_with_no_reason"}
  /\ UNCHANGED <<child, setStatus>>

\* "Keep Off track?": the owner confirms the set status still holds for the new plan
OwnerKeeps ==
  /\ override = "reason_stale"
  /\ override' = "explained"
  /\ inbox' = inbox \ {"keep_set_status"}
  /\ UNCHANGED <<child, setStatus, hasReason>>

\* Time based expiry, for example 7 days (A4.3 OPEN). Abstract: it may fire at any time.
SetStatusExpires ==
  /\ ExpiryPolicy = "after_days"
  /\ setStatus # "none"
  /\ ClearOverride
  /\ UNCHANGED child

Next ==
  \/ \E i \in Items, s \in Statuses : RuleUpdatesChild(i, s)
  \/ \E s \in Statuses : OwnerSets(s)
  \/ OwnerGivesReason
  \/ OwnerKeeps
  \/ SetStatusExpires

Spec == Init /\ [][Next]_vars

----------------------------------------------------------------------------
(* Properties *)

\* P9: a disagreement is explained, or it is waiting in the owner's inbox
ReasonRule ==
  (setStatus # "none" /\ setStatus # Calculated) =>
     (hasReason \/ "status_set_with_no_reason" \in inbox)

OverrideConsistent ==
  /\ (override = "calculated_only") <=> (setStatus = "none")
  /\ HasExplanation <=> hasReason

\* A4.3: the screen never shows a status nobody explained
NoSilentDisagreement == Displayed # Calculated => hasReason

\* A4.2: the parent is Done exactly when every child is Done
DoneMeansAllDone == (Calculated = "done") <=> (\A i \in Items : child[i] = "done")

\* Proposed rule (not in the KB yet): when all the work is done, the screen says Done
DoneWins == Calculated = "done" => Displayed = "done"

\* Use case 1: a stale reason is always waiting in the owner's inbox
StaleReasonAsked == override = "reason_stale" => "keep_set_status" \in inbox

\* C4: every inbox item still has its cause
NoOrphanItems ==
  /\ "status_set_with_no_reason" \in inbox => override = "reason_required"
  /\ "keep_set_status" \in inbox => override = "reason_stale"

\* Use case 1: a rule clears a set status only when the plan agrees or the work is Done
SetStatusRespected ==
  [][ (child' # child /\ setStatus # "none" /\ setStatus' = "none")
        => (Worst({child'[j] : j \in Items}) \in {setStatus, "done"}) ]_vars

\* Use case 1: a reason never silently explains a plan that has since moved
StaleReasonFlagged ==
  [][ (override = "explained" /\ setStatus' # "none"
         /\ Worst({child'[j] : j \in Items}) # Calculated)
        => override' = "reason_stale" ]_vars

Symm == Permutations(Items)
=============================================================================
```

`TrackedStatus.cfg`

```
SPECIFICATION Spec
CONSTANTS
    Items = {t1, t2, t3}
    ExpiryPolicy = "when_agree"
    ReasonStale = FALSE
INVARIANTS
    TypeOK
    ReasonRule
    OverrideConsistent
    NoSilentDisagreement
    DoneMeansAllDone
    DoneWins
    StaleReasonAsked
    NoOrphanItems
PROPERTIES
    SetStatusRespected
    StaleReasonFlagged
SYMMETRY Symm
CHECK_DEADLOCK FALSE
```

**What to look for.** With `ExpiryPolicy = "when_agree"` (the rule as written in C3 today), `DoneWins` fails. The shortest trace the checker found (9 steps, `js/results.md`): 2 children finish, the third is On track, the owner sets At risk, the third child finishes, and **then** the owner gives the reason. The calculated status is Done, but the explained At risk now wins for display, forever, because the two never agree again and the owner can no longer set a status on finished work.

That trace raises 2 decisions, not 1:
1. F3, when a set status expires. `"on_any_change"` and `"when_done"` both fix it; `"after_days"` does not (there is a window between Done and expiry).
2. New: should `OwnerGivesReason` still be allowed once the work is Done? Today the pending "Status set with no reason" inbox item survives the work finishing. Either auto-close it when the item reaches Done (C4 "cause cleared"), or keep it and accept the trace.

**Added 26 Oct 2026 for use case 1** (`use-cases/01-update-to-plan-machines.md`, M9). Two properties say what that story needs, and one new state meets them:
- `SetStatusRespected`: a rule may clear a set status only when the plan agrees or the work is Done. `"on_any_change"` fails it in 3 steps: Alicia sets At risk, one thread moves, her status is gone. In the story, Kemar's save would wipe Alicia's Off track and the L6 inbox item would never appear. Its earlier "all pass" only held because no property said this.
- `StaleReasonFlagged`: a reason must not silently explain a plan that has since moved. `"when_agree"`, `"when_done"` and `"after_days"` fail it in 4 steps: set, give a reason, a thread moves, the old reason still stands.
- `ReasonStale = TRUE` adds the state `reason_stale` and the inbox item "Keep Off track?" (`OwnerKeeps`, or set another status). With `ExpiryPolicy = "when_done"` every property passes. This is the proposal for F3.
- Note on names: every policy also clears when the plan agrees again, so `"when_done"` already means "when they agree or the work is Done". No new policy was needed.

---

## 6. Spec 2: Capture and extraction (C1, A9.2)

Covers: the capture lifecycle (C1), per update review (accepted, edited, rejected), "Medium or Low cannot auto-accept", "SAVE only when no update needs your OK", Atlas asks at most 1 question (A3 step 3), and the same message arriving on 2 channels (C14.5).

The model is 1 message that may arrive on each channel (for example Atlas and the app) and that Atlas extracts into a few updates. Confidence is chosen in `Init`, so TLC tries every mix of High, Medium and Low.

`Capture.tla`

```tla
------------------------------ MODULE Capture ------------------------------
(***************************************************************************)
(* DPM knowledge base A3, A9.2, C1, C14.5.                                 *)
(* One message, possibly arriving on more than one channel. Atlas parses   *)
(* it into updates. A person reviews them. SAVE applies them.              *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANTS Channels,  \* the same message arriving on, for example, {atlas, app}
          Updates,   \* the updates Atlas extracts, for example {u1, u2}
          Dedup      \* C14.5: is applying an update idempotent across channels?

VARIABLES cap,      \* cap[c]: capture lifecycle on channel c (C1)
          upd,      \* upd[c][u]: review state of update u on channel c
          conf,     \* conf[u]: Atlas's confidence (fixed once chosen)
          touched,  \* touched[c]: updates a person acted on (history, for checking)
          asked,    \* asked[c]: has Atlas asked its 1 question?
          applied   \* applied[u]: how many times u reached the records

vars == <<cap, upd, conf, touched, asked, applied>>

CapStates  == {"waiting", "received", "parsing", "needs_clarification",
               "proposed", "partially_confirmed", "applied", "rejected"}
UpdStates  == {"proposed", "accepted", "edited", "rejected"}
Confidence == {"high", "medium", "low"}

TypeOK ==
  /\ cap \in [Channels -> CapStates]
  /\ upd \in [Channels -> [Updates -> UpdStates]]
  /\ conf \in [Updates -> Confidence]
  /\ touched \in [Channels -> SUBSET Updates]
  /\ asked \in [Channels -> BOOLEAN]
  /\ applied \in [Updates -> 0..Cardinality(Channels)]

Init ==
  /\ cap = [c \in Channels |-> "waiting"]
  /\ upd = [c \in Channels |-> [u \in Updates |-> "proposed"]]
  /\ conf \in [Updates -> Confidence]
  /\ touched = [c \in Channels |-> {}]
  /\ asked = [c \in Channels |-> FALSE]
  /\ applied = [u \in Updates |-> 0]

\* MESSAGE_RECEIVED
Arrive(c) ==
  /\ cap[c] = "waiting"
  /\ cap' = [cap EXCEPT ![c] = "received"]
  /\ UNCHANGED <<upd, conf, touched, asked, applied>>

\* Atlas starts parsing (TRANSCRIBED is folded in here)
Parse(c) ==
  /\ cap[c] = "received"
  /\ cap' = [cap EXCEPT ![c] = "parsing"]
  /\ UNCHANGED <<upd, conf, touched, asked, applied>>

\* FIELD_UNCLEAR: Atlas asks 1 question, once (A3)
FieldUnclear(c) ==
  /\ cap[c] = "parsing"
  /\ ~asked[c]
  /\ cap' = [cap EXCEPT ![c] = "needs_clarification"]
  /\ asked' = [asked EXCEPT ![c] = TRUE]
  /\ UNCHANGED <<upd, conf, touched, applied>>

\* ANSWERED (a person step)
Answered(c) ==
  /\ cap[c] = "needs_clarification"
  /\ cap' = [cap EXCEPT ![c] = "parsing"]
  /\ UNCHANGED <<upd, conf, touched, asked, applied>>

\* PARSED: Atlas proposes. High confidence is pre-accepted but still shown (A3).
Propose(c) ==
  /\ cap[c] = "parsing"
  /\ cap' = [cap EXCEPT ![c] = "proposed"]
  /\ upd' = [upd EXCEPT ![c] =
               [u \in Updates |-> IF conf[u] = "high" THEN "accepted" ELSE "proposed"]]
  /\ UNCHANGED <<conf, touched, asked, applied>>

Reviewing(c) == cap[c] \in {"proposed", "partially_confirmed"}

\* ACCEPT, EDIT, REJECT on one update (a person step)
PersonMarks(c, u, s) ==
  /\ Reviewing(c)
  /\ s \in {"accepted", "edited", "rejected"}
  /\ upd[c][u] # s
  /\ upd' = [upd EXCEPT ![c][u] = s]
  /\ touched' = [touched EXCEPT ![c] = @ \cup {u}]
  /\ cap' = [cap EXCEPT ![c] = "partially_confirmed"]
  /\ UNCHANGED <<conf, asked, applied>>

NeedsOK(c) == {u \in Updates : upd[c][u] = "proposed"}

\* SAVE (a person step): only when nothing needs an OK. Confirmed and applied are 1 step here.
Save(c) ==
  /\ Reviewing(c)
  /\ NeedsOK(c) = {}
  /\ cap' = [cap EXCEPT ![c] = "applied"]
  /\ applied' = [u \in Updates |->
                   IF upd[c][u] \in {"accepted", "edited"} /\ ~(Dedup /\ applied[u] > 0)
                     THEN applied[u] + 1
                     ELSE applied[u]]
  /\ UNCHANGED <<upd, conf, touched, asked>>

RejectAll(c) ==
  /\ cap[c] = "proposed"
  /\ cap' = [cap EXCEPT ![c] = "rejected"]
  /\ UNCHANGED <<upd, conf, touched, asked, applied>>

Next ==
  \E c \in Channels :
    \/ Arrive(c) \/ Parse(c) \/ FieldUnclear(c) \/ Answered(c) \/ Propose(c)
    \/ Save(c) \/ RejectAll(c)
    \/ \E u \in Updates, s \in UpdStates : PersonMarks(c, u, s)

\* Only Atlas's own steps are fair. A person may never answer, and that is allowed.
Fairness == \A c \in Channels : WF_vars(Parse(c)) /\ WF_vars(Propose(c))

Spec == Init /\ [][Next]_vars /\ Fairness

----------------------------------------------------------------------------
(* Properties *)

\* A9.2: nothing reaches the records until a person confirms
NothingAppliedWithoutConfirm ==
  \A u \in Updates : applied[u] > 0 =>
    \E c \in Channels : cap[c] = "applied" /\ upd[c][u] \in {"accepted", "edited"}

\* A3, C1: Medium or Low confidence is only ever accepted by a person
NoAutoAcceptBelowHigh ==
  \A c \in Channels, u \in Updates :
    (upd[c][u] \in {"accepted", "edited"} /\ conf[u] # "high") => u \in touched[c]

\* C14.5: the same update never lands twice
AppliedAtMostOnce == \A u \in Updates : applied[u] <= 1

\* Liveness: Atlas never leaves a message stuck; it reaches a question or a proposal
AtlasReachesPerson ==
  \A c \in Channels : cap[c] = "received" ~> cap[c] \in {"needs_clarification", "proposed"}
=============================================================================
```

`Capture.cfg`

```
SPECIFICATION Spec
CONSTANTS
    Channels = {atlas, app}
    Updates = {u1, u2}
    Dedup = FALSE
INVARIANTS
    TypeOK
    NothingAppliedWithoutConfirm
    NoAutoAcceptBelowHigh
    AppliedAtMostOnce
PROPERTIES
    AtlasReachesPerson
CHECK_DEADLOCK FALSE
```

**What to look for.** With `Dedup = FALSE`, `AppliedAtMostOnce` is expected to fail: the message arrives on both channels, the person saves both reviews, and an update is applied twice (for example "out from Monday the 26th" creating 2 leave records). That is the case for C14.5: either merge captures before review, or make apply idempotent. Set `Dedup = TRUE` to model the second option.

The other invariants hold by construction today. Their value is later: if someone adds "auto-save after 5 minutes" or "Atlas saves when everything is High", TLC fails `NoAutoAcceptBelowHigh` or `NothingAppliedWithoutConfirm` immediately and shows the path.

---

## 7. Spec 3: Atlas suggestion and action (C5, P5)

Covers: the action lifecycle (C5), "approver must hold the role and scope for the target records" (C5 guard, A7), undo, and a question the KB does not answer yet: **is permission checked when someone approves, or again when Atlas executes?**

`AtlasAction.tla`

```tla
---------------------------- MODULE AtlasAction ----------------------------
(***************************************************************************)
(* DPM knowledge base A9.3, C5, P5.                                        *)
(* Atlas requests actions. A person with the right scope approves. Then    *)
(* Atlas executes. Roles can be removed at any time.                       *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANTS People,            \* people who might approve, for example {alicia, kemar}
          Actions,           \* actions Atlas wants to take, for example {a1, a2}
          Undoable,          \* the actions that can be undone, a subset of Actions
          NoOne,             \* a model value meaning "nobody yet"
          RecheckOnExecute   \* check the approver still has the right when it runs?

VARIABLES act,       \* act[a]: lifecycle of action a (C5)
          approver,  \* approver[a]: who approved it, or NoOne
          scope      \* scope[a]: who may approve a right now (A7 role and scope)

vars == <<act, approver, scope>>

ActStates == {"requested", "awaiting_approval", "approved", "executing",
              "succeeded", "failed", "undone"}

TypeOK ==
  /\ act \in [Actions -> ActStates]
  /\ approver \in [Actions -> People \cup {NoOne}]
  /\ scope \in [Actions -> SUBSET People]

Init ==
  /\ act = [a \in Actions |-> "requested"]
  /\ approver = [a \in Actions |-> NoOne]
  /\ scope \in [Actions -> SUBSET People]   \* TLC tries every permission setup

AskForApproval(a) ==
  /\ act[a] = "requested"
  /\ act' = [act EXCEPT ![a] = "awaiting_approval"]
  /\ UNCHANGED <<approver, scope>>

Approve(p, a) ==
  /\ act[a] = "awaiting_approval"
  /\ p \in scope[a]
  /\ act' = [act EXCEPT ![a] = "approved"]
  /\ approver' = [approver EXCEPT ![a] = p]
  /\ UNCHANGED scope

\* A role or scope is taken away (person moves team, leaves a project)
RoleRemoved(p, a) ==
  /\ p \in scope[a]
  /\ scope' = [scope EXCEPT ![a] = @ \ {p}]
  /\ UNCHANGED <<act, approver>>

Execute(a) ==
  /\ act[a] = "approved"
  /\ RecheckOnExecute => approver[a] \in scope[a]
  /\ act' = [act EXCEPT ![a] = "executing"]
  /\ UNCHANGED <<approver, scope>>

\* Proposed fix: an approval that lost its authority goes back for approval
ApprovalLapses(a) ==
  /\ act[a] = "approved"
  /\ approver[a] \notin scope[a]
  /\ act' = [act EXCEPT ![a] = "awaiting_approval"]
  /\ approver' = [approver EXCEPT ![a] = NoOne]
  /\ UNCHANGED scope

Finish(a) ==
  /\ act[a] = "executing"
  /\ \E r \in {"succeeded", "failed"} : act' = [act EXCEPT ![a] = r]
  /\ UNCHANGED <<approver, scope>>

Undo(a) ==
  /\ act[a] = "succeeded"
  /\ a \in Undoable
  /\ act' = [act EXCEPT ![a] = "undone"]
  /\ UNCHANGED <<approver, scope>>

Next ==
  \E a \in Actions :
    \/ AskForApproval(a) \/ Execute(a) \/ ApprovalLapses(a) \/ Finish(a) \/ Undo(a)
    \/ \E p \in People : Approve(p, a) \/ RoleRemoved(p, a)

\* System steps are fair. Approving is a person step, so it is not.
Fairness ==
  \A a \in Actions :
    WF_vars(Execute(a)) /\ WF_vars(ApprovalLapses(a)) /\ WF_vars(Finish(a))

Spec == Init /\ [][Next]_vars /\ Fairness

----------------------------------------------------------------------------
(* Properties *)

\* P5: nothing runs unless a person approved it
NothingRunsWithoutApproval ==
  \A a \in Actions :
    act[a] \in {"executing", "succeeded", "failed", "undone"} => approver[a] \in People

\* C5 guard, checked at the moment of execution (an action property)
ApproverHadAuthority ==
  [][\A a \in Actions :
       (act[a] = "approved" /\ act'[a] = "executing") => approver[a] \in scope[a]]_vars

\* Liveness: an approved action never hangs
ApprovedActionsSettle ==
  \A a \in Actions :
    act[a] = "approved" ~> act[a] \in {"succeeded", "failed", "undone", "awaiting_approval"}
=============================================================================
```

`AtlasAction.cfg`

```
SPECIFICATION Spec
CONSTANTS
    People = {alicia, kemar}
    Actions = {a1, a2}
    Undoable = {a1}
    NoOne = NoOne
    RecheckOnExecute = FALSE
INVARIANTS
    TypeOK
    NothingRunsWithoutApproval
PROPERTIES
    ApproverHadAuthority
    ApprovedActionsSettle
CHECK_DEADLOCK FALSE
```

**What to look for.**
- `RecheckOnExecute = FALSE`: `ApproverHadAuthority` is expected to fail. Trace: Atlas asks, Alicia approves, Alicia is taken off the project, Atlas executes anyway. Decide whether that is acceptable (it often is for "send a reply", rarely for "approve staffing").
- `RecheckOnExecute = TRUE`: the safety property holds. Now delete `ApprovalLapses` from `Next` and run again: `ApprovedActionsSettle` is expected to fail, because the approved action can never run and never goes back to anyone. This is how TLC pushes the design toward the `ApprovalLapses` step, which is not in C5 yet and should be considered.

---

## 8. Spec 4: Help request and its 60 minute target (C10)

Covers: the care request lifecycle (C10), the first reply target (A10.2, 60 minutes), the care area status it drives, escalation levels, and the "counts only" leader view (A7.3).

Time is abstract: `SlaTimerFires` may happen at any moment while the request has no first reply. That is enough to check ordering ("could a breach be missed?") without modelling minutes.

`HelpRequest.tla`

```tla
---------------------------- MODULE HelpRequest ----------------------------
(***************************************************************************)
(* DPM knowledge base A7.3, A10.2, C10.                                    *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANTS Requests   \* for example {r1, r2}

VARIABLES req,       \* req[r]: lifecycle (C10)
          level,     \* level[r]: 0 with the care team, 1 HR, 2 security, 3 executive
          breached   \* breached[r]: did 60 minutes pass with no first reply?

vars == <<req, level, breached>>

States == {"none", "new", "acknowledged", "in_progress", "escalated", "resolved"}

TypeOK ==
  /\ req \in [Requests -> States]
  /\ level \in [Requests -> 0..3]
  /\ breached \in [Requests -> BOOLEAN]

Init ==
  /\ req = [r \in Requests |-> "none"]
  /\ level = [r \in Requests |-> 0]
  /\ breached = [r \in Requests |-> FALSE]

Open(r) ==
  /\ req[r] = "none"
  /\ req' = [req EXCEPT ![r] = "new"]
  /\ UNCHANGED <<level, breached>>

FirstReply(r) ==
  /\ req[r] = "new"
  /\ req' = [req EXCEPT ![r] = "acknowledged"]
  /\ UNCHANGED <<level, breached>>

\* The 60 minutes may run out at any point before the first reply
SlaTimerFires(r) ==
  /\ req[r] = "new"
  /\ ~breached[r]
  /\ breached' = [breached EXCEPT ![r] = TRUE]
  /\ UNCHANGED <<req, level>>

Start(r) ==
  /\ req[r] = "acknowledged"
  /\ req' = [req EXCEPT ![r] = "in_progress"]
  /\ UNCHANGED <<level, breached>>

\* Escalation moves 1 level at a time (proposal; C10 does not say)
Escalate(r) ==
  /\ req[r] \in {"in_progress", "escalated"}
  /\ level[r] < 3
  /\ req' = [req EXCEPT ![r] = "escalated"]
  /\ level' = [level EXCEPT ![r] = @ + 1]
  /\ UNCHANGED breached

Resolve(r) ==
  /\ req[r] \in {"in_progress", "escalated"}
  /\ req' = [req EXCEPT ![r] = "resolved"]
  /\ UNCHANGED <<level, breached>>

Next ==
  \E r \in Requests :
    \/ Open(r) \/ FirstReply(r) \/ SlaTimerFires(r)
    \/ Start(r) \/ Escalate(r) \/ Resolve(r)

\* The clock is fair. People replying is not assumed.
Fairness == \A r \in Requests : WF_vars(SlaTimerFires(r))

Spec == Init /\ [][Next]_vars /\ Fairness

----------------------------------------------------------------------------
(* Derived values (P6: rules, not stored) *)

\* C10: the care area is At risk while any request waits past its target.
\* OPEN: should a breach keep the area At risk after the reply arrives?
CareStatus ==
  IF \E r \in Requests : req[r] = "new" /\ breached[r] THEN "at_risk" ELSE "on_track"

\* A7.3 counts only: what leaders get is numbers, never request ids
LeaderView ==
  [escalated |-> Cardinality({r \in Requests : req[r] = "escalated"}),
   waiting   |-> Cardinality({r \in Requests : req[r] = "new"})]

(* Properties *)

LeaderViewIsCountsOnly == LeaderView \in [escalated : Nat, waiting : Nat]

BreachNeedsARequest == \A r \in Requests : breached[r] => req[r] # "none"

\* Escalation never goes back down (action property)
EscalationOnlyRises == [][\A r \in Requests : level'[r] >= level[r]]_vars

\* Liveness: a waiting request is either answered or flagged, never silently forgotten
NoSilentWait ==
  \A r \in Requests : req[r] = "new" ~> (req[r] # "new" \/ breached[r])
=============================================================================
```

`HelpRequest.cfg`

```
SPECIFICATION Spec
CONSTANTS
    Requests = {r1, r2}
INVARIANTS
    TypeOK
    LeaderViewIsCountsOnly
    BreachNeedsARequest
PROPERTIES
    EscalationOnlyRises
    NoSilentWait
CHECK_DEADLOCK FALSE
```

**What to look for.** All properties are expected to hold. Remove `Fairness` from `Spec` and `NoSilentWait` should fail: without a fair clock, nothing forces the breach flag. This is the TLA+ way of saying "the SLA timer is a real requirement on the build, not a nice to have".

**Exact durations.** If we need to compare thresholds (F10: 60 minute reply target, 14 quiet days, 90 day renewal window), add a `now` variable that a `Tick` step increases, store `createdAt[r]`, and bound `now` with a TLC state constraint. Keep that out of the first models; it multiplies the state space.

---

## 9. Spec 5: Staged pipeline and refinement (C11, C14.10)

C14.10 asks for the minimal set of machines that covers all 5 domains, with the hypothesis that opportunities, seats and briefings are all a generic "staged pipeline". TLA+ answers this with refinement (lectures 8 and 10): write the generic machine once, then check that each specific machine implements it.

`StagedPipeline.tla` (the generic machine)

```tla
--------------------------- MODULE StagedPipeline ---------------------------
(* C14.10 hypothesis: a generic staged pipeline *)
EXTENDS Naturals

CONSTANTS NStages
VARIABLES stage,    \* 1..NStages
          outcome   \* "open", "won", "lost"

Init    == stage = 1 /\ outcome = "open"
Advance == outcome = "open" /\ stage < NStages /\ stage' = stage + 1 /\ UNCHANGED outcome
Win     == outcome = "open" /\ stage = NStages /\ outcome' = "won" /\ UNCHANGED stage
Lose    == outcome = "open" /\ outcome' = "lost" /\ UNCHANGED stage

Next == Advance \/ Win \/ Lose
Spec == Init /\ [][Next]_<<stage, outcome>>
=============================================================================
```

`Opportunity.tla` (C11, checked against the generic machine)

```tla
----------------------------- MODULE Opportunity -----------------------------
(* C11: pitch -> proposal -> pricing -> with_legal -> signed | lost; any -> stalled *)
EXTENDS Naturals

VARIABLES oppStage, result, stalled
vars == <<oppStage, result, stalled>>

Stages == <<"pitch", "proposal", "pricing", "with_legal">>
IndexOf(s) == CHOOSE i \in 1..4 : Stages[i] = s

Init == oppStage = "pitch" /\ result = "open" /\ stalled = FALSE

Move ==
  /\ result = "open" /\ ~stalled
  /\ \E i \in 1..3 : oppStage = Stages[i] /\ oppStage' = Stages[i + 1]
  /\ UNCHANGED <<result, stalled>>

Sign ==
  /\ result = "open" /\ ~stalled /\ oppStage = "with_legal"
  /\ result' = "signed"
  /\ UNCHANGED <<oppStage, stalled>>

Lose ==
  /\ result = "open"
  /\ result' = "lost" /\ stalled' = FALSE
  /\ UNCHANGED oppStage

\* No movement in N days (C11 OPEN). Invisible to the generic machine.
Stall  == result = "open" /\ ~stalled /\ stalled' = TRUE /\ UNCHANGED <<oppStage, result>>
Resume == stalled /\ stalled' = FALSE /\ UNCHANGED <<oppStage, result>>

Next == Move \/ Sign \/ Lose \/ Stall \/ Resume
Spec == Init /\ [][Next]_vars

\* Refinement mapping: how an opportunity looks as a generic pipeline
Pipeline == INSTANCE StagedPipeline WITH
              NStages <- 4,
              stage   <- IndexOf(oppStage),
              outcome <- CASE result = "open"   -> "open"
                           [] result = "signed" -> "won"
                           [] result = "lost"   -> "lost"

Refines == Pipeline!Spec
=============================================================================
```

`Opportunity.cfg`

```
SPECIFICATION Spec
PROPERTIES
    Refines
CHECK_DEADLOCK FALSE
```

**Design finding already visible.** The refinement mapping only works because `oppStage` keeps the last stage after the opportunity is lost. The C11 diagram has `signed | lost` as states, which forgets where it was lost. Keeping a separate `result` means reports can say "lost at pricing", and it makes the generic machine possible. Recommend splitting stage and result in C11.

**Next to try.** Write `Seat.tla` (open, proposed, approved, filled, released) and `Briefing.tla` (scheduled, drafted, edited, approved, sent) and check each against `StagedPipeline`. Where a mapping cannot be written (for example a seat that goes from filled back to open when someone leaves), the hypothesis in C14.10 needs a new generic step, and we learn that before building a shared engine.

---

## 9a. Specs 6 to 10: BRAID entry, routing, matching, saving a capture, inbox items (use case 1, JavaScript first)

Added 26 Oct 2026 for use case 1 (`use-cases/01-update-to-plan-machines.md`, M13 to M16) and the briefing in `meetings/2026-10-26-silver-slipper-plaza-3.md`. These three exist only as JavaScript models (`js/models/braidEntry.mjs`, `js/models/routing.mjs`, `js/models/match.mjs`). The TLA+ text is still to write; it should follow the same conventions as specs 1 to 5, with the JS port as the reference.

### Spec 6: BraidEntry (who reports, who decides)

One project with a risk (e1) and two decisions that conflict (e2, e3). Kemar and Alicia can report; Alicia starts as PM and Andre as Lead, and either can lose the role and get it back. A report can carry words that claim approval ("Andre and I agreed").

| Property | Kind | Says |
|---|---|---|
| `OnLogOnlyWithRight` | action | A risk or decision goes on the log only by a person who holds PM or Lead at that moment |
| `DecisionNeverApprovedByText` | invariant | Words in a message never approve a decision |
| `NothingDecidesItself` | invariant | No timer approves or declines anything; reminders only remind |
| `ConflictsNeverSilent` | invariant | Two decisions linked as conflicting are never both approved: approving one supersedes the other |
| `SomeoneIsAsked` | invariant | A proposal is always in someone's inbox who can decide it, or the owner gets "no one can approve" (E91) |
| `NoOrphanItems` | invariant | Every inbox item still has its cause |

`CheckRightWhen` is the design choice: is the approver's right checked when they press Approve, or when the item was put in their inbox? Checking at report time fails `OnLogOnlyWithRight` in 3 steps: Kemar reports a risk, Alicia stops being PM, Alicia approves it anyway. This is the same lesson as `RecheckOnExecute` in spec 3, now for the BRAID log.

Not modelled: Blockers and Issues (they need no approval), matching and merging (M16), and whether Atlas notices a conflict. The model checks what DPM does once a conflict link exists.

### Spec 7: Routing (one update, several projects)

Kemar's update has 2 items. Atlas guesses any project, "ambiguous" or "none"; the guess is untrusted. His projects: Forager 2.0 and Store Insights (member, connected), Sante Group (not a member), a study group (not connected to DPM) and a partner project tagged to another company. Before saving he can move items, pick a project, keep items private, leave a project, or have a group disconnected. After saving, three readers look at their org's dashboard.

| Property | Kind | Says |
|---|---|---|
| `RoutedOnlyToCandidates` | action | An item is only routed, by Atlas or by Kemar, to a project he is in and that is connected to DPM (server check 9) |
| `OnlyMemberProjects` | action | At the moment of saving, every filed item goes to such a project |
| `NothingFiledWhileChoosing` | invariant | Nothing is saved while an item still needs a project |
| `NoCrossProjectQuote` | invariant | A reader sees an item's quote only if it was filed into a project they are a member of |
| `NoCrossOrg` | invariant | An org's dashboard never shows an item filed into another org's project |

`RecheckAtSave` is the design choice. Without it, `OnlyMemberProjects` fails in 4 steps: two items routed to Forager, Kemar leaves Forager, Save files them anyway.

**A finding from the planted bugs.** The bug "trust the project Atlas names" first went uncaught: the save recheck withdrew the bad item, so nothing was filed wrongly. But the review page would still have shown Kemar a project he is not in (Sante Group). `RoutedOnlyToCandidates` was added to check the routing step itself; it now fails on that bug in 1 step. So the design has two layers: check 9 when Atlas routes, and the membership recheck at save. Either alone is not enough.

Both specs have a story on the machine map: "Who decides on the BRAID log" (BraidEntry; planted bug: "Andre and I agreed" counts as the approval, caught at step 1) and "Kemar's update splits across projects" (Routing; planted bug: a project member sees the whole capture, caught at step 3).

### Spec 8: Match (duplicate reports, merging, resolving blockers)

One project's BRAID log: an open blocker "Store sales feed access" (b1, 1 source from Alicia), an older blocker that is resolved (b2), and a risk (r1). Two reports arrive from different captures (Kemar, Jodian). Atlas suggests any entry or "new"; the suggestion is untrusted. The speaker confirms it, picks another entry, or says "this is different". Between review and save, anyone may resolve or merge the matched entry. After save, the PM can merge and unmerge. Blockers follow S13: resolved by the owner of the blocked work or a PM or Lead; anyone else's "it's cleared" is a proposal to them.

| Property | Kind | Says |
|---|---|---|
| `SourceOnlyAfterConfirm` | action | A report joins an existing entry only after the speaker confirmed that match |
| `NeverAcrossKinds` | invariant | A source sits only on an entry of its own kind, and merges stay within a kind |
| `EveryReportOnce` | invariant | Every saved report and every earlier source is held by exactly one entry, through merges and unmerges; unsaved reports by none |
| `UnmergeRestores` | action | Unmerge gives the entry back exactly the sources it had and takes them off the other entry |
| `ChangedMatchIsAConflict` | action | A match to an entry that changed since review (resolved, merged) becomes a conflict for the speaker, never an attach. A resolved blocker reopens only if the speaker saw it resolved and confirmed |
| `OneAlertPerNewEntry` | invariant | The PM is alerted once per new entry, never for a source added to an existing one |
| `BlockerResolvedByOwnerOrLead` | action | A blocker is resolved only by the owner of the blocked work or a PM or Lead (S13) |
| `NoOrphanItems` | invariant | Every inbox item ("new blocker", "it's cleared, confirm?") still has its cause |

The design as given passes all 9 properties (20,615 states). Every planted bug was caught by the property it targets on the first run. Two plants run on a smaller log (1 report, 2 entries): "unmerge leaves the sources" ran out of memory on the full log, because repeated merges and unmerges reshuffle sources into very many combinations; "merge a blocker into a risk" was 156,619 states and 11 seconds.

A design rule the model needed: **unmerge in reverse order**. If x was merged into y and y later into z, x's sources now sit on z; unmerging x first would take them from the wrong entry. The model only lets the PM unmerge an entry whose target is not itself merged away, and with that rule `EveryReportOnce` and `UnmergeRestores` hold.

Story on the map: "Three reports, one blocker" (Match; planted bug: every report pings the PM, caught at step 3).

### Spec 9: CaptureSave (machines doc M2 to M4; added for phase 1a, 26 Oct 2026)

Two updates from one capture, each on its own record. Each update saw a value ("a") and wants to write "b". Before Kemar saves, another writer (GitHub, a lead) may set a record to "b" (got there first) or "c" (something else). Kemar can accept, reject, and accept again after a conflict (which means "I have seen the new value"). Timers remind and then expire a review nobody finishes.

| Property | Kind | Says |
|---|---|---|
| `NeverOverwriteUnseen` | action | Save writes a record only over the value the update saw |
| `AllOrNothing` | invariant | No update is applied while the capture is still in review |
| `AppliedAtMostOnce` | invariant | Each update writes its record at most once |
| `NothingAfterExpiry` | invariant | An expired capture changed nothing |
| `ExpiryIsFinal` | action | Nothing about an expired capture changes again |
| `ReminderBeforeExpiry` | invariant | Kemar is reminded before his review expires |
| `ReviewEnds` | liveness | A review is saved or expires; it never waits forever (timers are fair) |

`ApplyMode` is decision S3. "Apply what can" fails `AllOrNothing` and `NothingAfterExpiry`: a half-saved capture can expire with some records already changed. All or nothing passes everything.

**Findings from the planted bugs.** "A second Save runs again" breaks three properties, not one. The second save can arrive after GitHub legitimately changed the record, and then writes Kemar's old value over GitHub's newer one. Once per update ID is what prevents that. "Save an expired capture" was not caught at first: the save moved the capture out of expired, so `NothingAfterExpiry` never saw it. `ExpiryIsFinal` was added and now catches it in 3 steps.

### Spec 10: InboxItem (machines doc M10; added for phase 1a, 26 Oct 2026)

One cause (for example "status set with no reason") that appears and clears. A rule (`Evaluate`, fair) keeps the owner's inbox in step. The owner can act (which removes the cause), snooze, or wait; a snooze can wake. Episodes are bounded to 3.

| Property | Kind | Says |
|---|---|---|
| `OneLiveItemPerCause` | invariant | At most one open or snoozed item per cause |
| `InboxMatchesCause` | invariant | Once the rule has run, there is a live item exactly when the cause holds (a snoozed item whose cause is gone closes) |
| `ClosedNeverReopens` | action | An acted or auto-closed item never changes again; a returning cause gets a new item |
| `InboxCatchesUp` | liveness | Every change is evaluated |

Finding: if the cause clears and comes back before the rule runs in between, the original item stays open. The rule never saw it clear, so this is correct, and E61 ("comes back later, new item") applies only when the rule ran in the gap.

Stories on the map: "Someone changed it first" (CaptureSave; planted bug: Save writes without checking what the update saw, caught at step 4) and "Alicia's reason item" (InboxItem; planted bug: a closed item is reopened, caught at step 4).

---

## 9b. Specs 11 to 13: the capture job, leave, BRAID follow ups (decisions D1 to D22, JavaScript only)

Written 26 Oct to check the decisions in `use-cases/01-update-to-plan-machines.md`, section 11, before any code. Each is a JavaScript model in `js/models`; there is no TLA+ text yet.

| Spec | Model | What it holds | Planted bugs it catches |
|---|---|---|---|
| 11 CaptureJob | `captureJob.mjs` | Transcribe and read retries, the 5 minute timer, attempt numbers on reads, save retries with a lost reply. ReadEnds and SaveEnds (nothing stuck), ItemsStoredOnce, StoredFromCurrentAttempt, AppliedAtMostOnce, GivingUpIsTold, VoiceFailureAsksForNewNote | No timer on transcribing (the check found this gap in the first draft), no timer at all, "try again" for a voice note, a late answer stored, a retry that applies again, a silent give up |
| 12 Leave | `leave.mjs` | Matching any live leave, changes to leave, impact items per lead. NoOverlappingLeave, ApprovedDatesKept, LeadsSeeImpact, ImpactOnlyOwnProject, ImpactsCloseWhenDecided, NeverApprovedByCapture | Approved leave only (the old default), no impact, impact across projects, impact left open, a capture that approves |
| 13 BraidFollowUps | `braidFollowUps.mjs` | Resolving from a message (S13, E93), reports on finished entries, merging into a resolved entry, withdrawing one's own report. BlockerResolvedByOwnerOrLead, ClosedRiskStaysClosed, ReportsGoToLiveEntry, MergeChoiceRecorded, WithdrawKeepsOthers | Anyone's message resolves, unblocking resolves by itself, a closed risk reopens, reports pile on a realised risk, a silent merge, withdrawing removes others' reports |

## 10. Running the checks

### 10.1 In JavaScript (works today)

There is no JavaScript build of TLC, so `js/` holds a small checker written for these models plus a hand port of each spec. It does what TLC does for them: breadth-first search of every reachable state, invariants (shortest counterexample), action properties (`[][P]_vars`), leads-to (`~>`) under weak fairness, and refinement against a simpler spec. Needs Node 18 or later (this Mac has Node 24).

```bash
cd research/state-machines/js && node run-all.mjs
```

| File | What it is |
|---|---|
| `js/checker.mjs` | The checker. Stuttering steps are ignored as in TLA+. Liveness: a `P ~> Q` fails if, from a P state, a behaviour can stay out of Q forever, either by stuttering where no fair action is enabled, or in a cycle where every fair action is taken or disabled somewhere |
| `js/lib.mjs` | Helpers: `SUBSET`, `[D -> R]`, products, canonical state keys |
| `js/models/*.mjs` | 1 file per spec, same names, guards and properties as the TLA+ above |
| `js/checks.mjs` | The 13 settings and 5 planted-bug rows from section 11 |
| `js/run-all.mjs` | Runs them, compares with expectations, exits non-zero on a mismatch |
| `js/stories.mjs` | 6 DPM stories, each replayed move by move, each with a planted bug that must make it fail |
| `js/map-data.mjs`, `js/build-map.mjs` | Content and builder for `dpm-machine-map.html` (section 16) |
| `js/results.md` | Generated: the table and every counterexample trace |

**Limits of the port, compared with TLC**
- It is a translation. If a `.tla` block and its `.mjs` file disagree, the model checked is the `.mjs`. Change both together, and run TLC once Java is available to confirm they match.
- Weak fairness only (no `SF`), no symmetry reduction, no TLA+ parser, everything in memory. Fine for models of a few hundred thousand states; for bigger models use TLC.
- `run-all.mjs` can run in CI as a regression check on the design: if someone changes a guard and an invariant breaks, the run fails with the trace.

### 10.2 With TLC (once Java is installed)

**Tools** (lecture 3 of the video course walks through the Toolbox):
- **TLA+ Toolbox**, the IDE described in the course.
- **VS Code TLA+ extension** (publisher `tlaplus`), a lighter option used by many teams now.
- **Command line:** `tla2tools.jar` from the tlaplus GitHub releases. Needs Java 11 or later. **This Mac has no Java runtime installed yet** (checked 24 Oct 2026).

**Files.** Each spec is a `.tla` file plus a `.cfg` file with the same name. Copy the blocks above into `research/state-machines/tla/`.

**Run one model:**

```bash
java -XX:+UseParallelGC -cp tla2tools.jar tlc2.TLC -config TrackedStatus.cfg TrackedStatus.tla
```

**Notes**
- `CHECK_DEADLOCK FALSE` is in every config because DPM machines have real end states (all done, all resolved). Without it TLC reports those as deadlocks. On older TLC versions use the `-deadlock` flag instead.
- `SYMMETRY` is used only in Spec 1, which has no liveness properties. Do not combine symmetry with liveness checking.
- `Opportunity.tla` needs `StagedPipeline.tla` in the same folder.
- To explore a random long behaviour instead of all of them (useful for C14.8, "replay a day"), add `-simulate -depth 100`.
- To translate PlusCal, if a spec is written that way: `java -cp tla2tools.jar pcal.trans MySpec.tla`.

## 11. Expected results

Run with the JavaScript checker on 24 Oct 2026 and again on 26 Oct 2026 after the use case 1 additions (`node run-all.mjs`). All 24 settings matched expectations, and so did 33 planted-bug rows (below the table). Full traces are in `js/results.md`. The TLC column stays empty until TLC is run.

| Spec | Setting | States | Expected | JavaScript result | TLC |
|---|---|---|---|---|---|
| TrackedStatus | `ExpiryPolicy = "when_agree"` | 641 | `DoneWins`, `StaleReasonFlagged` fail | Both fail; `DoneWins` 9 step trace (section 5) | |
| TrackedStatus | `"on_any_change"` | 635 | `SetStatusRespected` fails | Fails in 3 steps: a set status disappears the moment any child moves | |
| TrackedStatus | `"when_done"` | 635 | `StaleReasonFlagged` fails | Fails in 4 steps: the reason outlives the plan it explained | |
| TrackedStatus | `"after_days"` | 641 | `DoneWins`, `StaleReasonFlagged` fail | Both fail | |
| TrackedStatus | `"when_done"`, `ReasonStale` (proposed) | 826 | All pass | All 10 pass | |
| TrackedStatus | `"when_agree"`, `ReasonStale` | 835 | `DoneWins` fails | `DoneWins` fails: a stale reason does not fix Done | |
| TrackedStatus | `"on_any_change"`, `ReasonStale` | 635 | `SetStatusRespected` fails | Fails: the set status is gone before it can go stale | |
| Capture | `Dedup = FALSE` | 33,913 | `AppliedAtMostOnce` fails | Fails: both channels saved, each update applied twice (9 steps) | |
| Capture | `Dedup = TRUE` | 33,913 | All pass | All 5 pass | |
| AtlasAction | `RecheckOnExecute = FALSE` | 1,920 | `ApproverHadAuthority` fails | Fails: approve, role removed, executed anyway (5 steps) | |
| AtlasAction | `TRUE` | 1,920 | All pass | All 4 pass | |
| AtlasAction | `TRUE`, `ApprovalLapses` removed | 1,920 | `ApprovedActionsSettle` fails | Fails: approved, role removed, stuck forever | |
| HelpRequest | as given | 441 | All pass | All 5 pass | |
| HelpRequest | `Fairness` removed | 441 | `NoSilentWait` fails | Fails: request opened, waits forever unflagged | |
| Opportunity | as given (stage kept when lost) | 13 | `Refines` passes | Passes | |
| Opportunity | C11 as drawn (lost replaces stage) | 10 | `Refines` fails | Fails: pitch, proposal, lost; the generic machine cannot tell where it was lost | |
| BraidEntry | as given (right checked when approving) | 104,980 | All pass | All 7 pass | |
| BraidEntry | right checked when reported (1 risk) | 220 | `OnLogOnlyWithRight` fails | Fails in 3 steps: reported, PM loses the role, approves anyway | |
| Routing | as given (membership checked at save) | 955 | All pass | All 6 pass | |
| Routing | `RecheckAtSave = FALSE` | 832 | `OnlyMemberProjects` fails | Fails in 4 steps: routed to Forager, Kemar leaves, saved anyway | |
| Match | as given | 20,615 | All pass | All 9 pass | |
| CaptureSave | as given (all or nothing, compare and set) | 396 | All pass | All 8 pass | |
| CaptureSave | S3 alternative: apply what can | 416 | `AllOrNothing`, `NothingAfterExpiry` fail | Both fail: a half-saved capture | |
| InboxItem | as given | 63 | All pass | All 5 pass | |

**Planted bugs.** As on the Atlas machine map, each check must fail on a bug planted for it, so a pass means something:

| Planted bug | Must fail | Result |
|---|---|---|
| Capture: Medium confidence is pre-accepted | `NoAutoAcceptBelowHigh` | Fails, as it must |
| TrackedStatus: no inbox item asks for a reason | `ReasonRule` | Fails, as it must |
| TrackedStatus: a reason goes stale and nobody is asked | `StaleReasonAsked` | Fails, as it must |
| AtlasAction: Atlas treats its own request as approved, recheck off | `NothingRunsWithoutApproval`, `ApproverHadAuthority` | Both fail, as they must |
| AtlasAction: the same bug, recheck on | nothing | All pass: the recheck refuses to run it and sends it back for approval |
| HelpRequest: the 60 minute timer never fires | `NoSilentWait` | Fails, as it must |
| BraidEntry: "Andre and I agreed" counts as the approval | `DecisionNeverApprovedByText`, `OnLogOnlyWithRight` | Both fail, as they must |
| BraidEntry: a proposal approves itself after the reminders | `NothingDecidesItself`, `OnLogOnlyWithRight` | Both fail, as they must |
| BraidEntry: approving a decision does not supersede the one it conflicts with | `ConflictsNeverSilent` | Fails, as it must |
| BraidEntry: nobody is told when no one can approve | `SomeoneIsAsked` | Fails, as it must |
| Routing: the project Atlas names is trusted | `RoutedOnlyToCandidates` | Fails; nothing is filed wrongly because the save recheck withdraws it (section 9a) |
| Routing: the same bug, save recheck off | `RoutedOnlyToCandidates`, `OnlyMemberProjects` | Both fail, as they must |
| Routing: a project member sees the whole capture | `NoCrossProjectQuote` | Fails, as it must |
| Routing: the org tag is ignored on dashboards | `NoCrossOrg` | Fails, as it must |
| Routing: Save allowed while an item needs a project | `NothingFiledWhileChoosing` | Fails, as it must |
| Match: Atlas's match is saved without the speaker confirming it | `SourceOnlyAfterConfirm`, `ChangedMatchIsAConflict` | Both fail, as they must |
| Match: a match to an entry of another kind is kept | `NeverAcrossKinds` | Fails, as it must |
| Match: the PM can merge a blocker into a risk (small log) | `NeverAcrossKinds` | Fails, as it must |
| Match: merge copies sources instead of moving them | `EveryReportOnce` | Fails, as it must |
| Match: merge loses the sources it should carry over | `EveryReportOnce` | Fails, as it must |
| Match: unmerge leaves the sources on the other entry (small log) | `UnmergeRestores` | Fails in 2 steps: merge, unmerge |
| Match: an entry that changed since review is matched anyway | `ChangedMatchIsAConflict` | Fails in 4 steps: Kemar confirms the open blocker, Alicia resolves it, Kemar's save reopens it unseen |
| Match: every report pings the PM, not only new entries | `OneAlertPerNewEntry` | Fails, as it must |
| Match: anyone can resolve a blocker | `BlockerResolvedByOwnerOrLead` | Fails in 1 step: Jodian resolves it |
| CaptureSave: Save writes without checking what the update saw | `NeverOverwriteUnseen` | Fails in 4 steps: accept both, GitHub changes #145, Save overwrites it |
| CaptureSave: a second Save runs again (no dedup) | `AllOrNothing`, `AppliedAtMostOnce`, `NothingAfterExpiry` | All fail: the repeat overwrites a later change (section 9a) |
| CaptureSave: an expired capture can still be saved | `ExpiryIsFinal` | Fails, as it must |
| CaptureSave: expires without a reminder first | `ReminderBeforeExpiry` | Fails in 1 step |
| CaptureSave: the expiry timer never fires | `ReviewEnds` | Fails: reminded, then waits forever |
| InboxItem: evaluate adds an item even when one is live | `OneLiveItemPerCause`, `InboxMatchesCause` | Both fail: the cause flaps before the rule runs |
| InboxItem: a closed item is reopened when the cause returns | `ClosedNeverReopens` | Fails in 5 steps |
| InboxItem: items do not close when the cause goes | `InboxMatchesCause` | Fails in 4 steps |
| InboxItem: the rule never runs after a change | `InboxCatchesUp` | Fails: waits forever |

The 4th row is a finding in itself: checking permission when an action runs (rule 8 on the map) also protects against Atlas skipping approval.

The checker was also tested on a 3 state toy model: it passes a loop when the exit is fair, and fails it both when the exit is unfair and when nothing is fair.

## 12. Answering the C14 research questions with TLA+

| C14 question | How TLA+ helps | Where |
|---|---|---|
| 1 Which statuses are stored, which derived? Can derived ones be cached? | Derived = a definition, stored = a variable. To test a cache, add a variable `cached` and the invariant `cached = Calculated`; TLC finds any event that forgets to refresh it. | Spec 1 |
| 2 Roll-up as 1 composed statechart or independent machines plus a reducer? | Write both and check that the reducer version refines the composed one (lecture 8). If it does, build the simpler one. | Next step |
| 3 How long does a set status last? | `ExpiryPolicy` constant; run each option | Spec 1 |
| 4 Which transitions may Atlas propose, and which only a person? | Give every action an actor parameter; invariant that person-only actions never have Atlas as actor | Specs 2, 3 |
| 5 Same event from 2 channels | `Dedup` constant | Spec 2 |
| 6 External systems (GitHub, CRM) and conflicts | Model GitHub as a second writer of the work item state (C6) with its own steps; invariant about who wins. Close to lecture 7 territory. | Next step |
| 7 Which timers are org config? | Timers that only need ordering stay abstract actions; timers whose values interact become constants with a bounded clock | Spec 4 notes |
| 8 Replay or simulate a day | TLC `-simulate` produces random valid behaviours; traces can be turned into test cases for the real rule engine (model-based testing) | Section 10 |
| 9 Reuse the Anubis grid state machine? | Write the grid machine as a spec, then check whether C6 work items refine it | Next step |
| 10 Minimal set of machines | Refinement against generic machines | Spec 5 |

## 13. Open decisions (Part F) as model constants

| Part F item | Model constant | Spec |
|---|---|---|
| F3 Set status expiry and who may override | `ExpiryPolicy`, `ReasonStale`; the owner guard in `OwnerSets`. Proposed: `"when_done"` with `ReasonStale` | TrackedStatus |
| F6 GitHub as backbone for work items | Second writer for C6 (to write) | WorkItem (planned) |
| F7 Reuse the Anubis grid machine | Refinement check (to write) | Grid (planned) |
| F10 Thresholds as org config | Constants for cutoff, quiet days, tolerance, SLA, minimum group size, with a bounded clock | HelpRequest variant (planned) |
| New: permission check at approval or at execution | `RecheckOnExecute` | AtlasAction |
| New: when a breach stops counting against the care area | `CareStatus` definition | HelpRequest |
| New: keep the stage when an opportunity is lost | Split `oppStage` and `result` | Opportunity |

| New: can a reason be given after the work is Done? | Guard on `OwnerGivesReason` | TrackedStatus |
| F14 Who decides each BRAID kind; when the approver's right is checked | `CheckRightWhen`; rights table | BraidEntry |
| F16, F17, F19 Visibility by group membership and org tag; routing | `RecheckAtSave`; readers and org tags | Routing |
| F18 Consolidation: dedupe and merge; S13 who resolves blockers | Speaker-confirmed match, conflict at save, merge and unmerge rules | Match |

The last 4 rows are questions the specs raised that are not in Part F yet. Suggest adding them as F13 to F16.

## 14. What TLA+ will not do for us

- **It checks the design, not the code.** A passing spec says the rules are consistent; the build still needs tests. Spec traces can seed those tests.
- **It does not judge Atlas.** Whether Atlas extracts the right update with the right confidence is a quality question for evaluation, not model checking. TLA+ only checks what the system does with whatever Atlas proposes.
- **Privacy is only partly covered.** TLA+ can check that the leader view has the shape "counts only", but "a leader cannot work out who is unwell" is an information flow property across behaviours, which TLC does not check. P10 still has to be enforced and tested in the data layer.
- **Small models.** TLC checks 2 or 3 of everything, not 50 people. That is usually enough to find design bugs, but it is not a proof for all sizes. TLAPS (the proof system covered in the Hyperbook) can prove properties for all sizes if a rule ever needs that.
- **UI.** Views (A8) are projections of the same records (P7) and are out of scope.

## 15. Next steps

1. Done: all 13 settings checked with the JavaScript port (section 11).
2. Install Java and the TLA+ tools, split the blocks above into `research/state-machines/tla/*.tla` and `*.cfg`, run TLC, and fill in the TLC column. Any difference from the JavaScript column means the port and the spec have drifted.
3. Take the failing traces for F3, the reason-after-Done question, and the approval question to Ed as decision inputs.
4. Add specs for C6 work item with GitHub as a second writer (F6), C4 inbox item with auto-close liveness, and C9 leave and cover.
5. Check `Seat` and `Briefing` against `StagedPipeline` (C14.10).
6. Meet Anubis and write the grid machine as a spec for the F7 refinement check.
7. Everyone touching Part C: watch lectures 1 to 6 of the video course before step 4; lectures 8 to 10 before the refinement work.

## 16. The DPM machine map

`dpm-machine-map.html` applies the Atlas machine map (https://atlas-machine-map.fly.dev) to DPM. Build it with:

```bash
cd research/state-machines/js && node build-map.mjs
```

The builder runs every check and replays every story first, so every result on the page comes from a real run. It fails (non-zero exit) if a check, a story or a planted bug does not behave as expected.

What it adds to this document:
- **Shapes.** Every DPM machine (46, from Parts A and C) is one of the Atlas map's 7 shapes (Switch, Thing, Membership, Ask, Job, Presence, Allowance) or 1 new shape, Stage, for things that move through named stages (C14.10). Statuses are not machines; they are rules over machines (P6).
- **Stories.** 6 stories from the Part B snapshot (Kemar's update, the same message twice, Alicia sets Off track, staffing NEPA, the approver moves on, a care request waits). The checker takes only each story's moves, in order, and every machine row must match as written.
- **8 rules**, the ownership map, every machine by area with its KB reference and whether a model covers it (16 of 46 today), and the decisions raised by the mapping and the checker.
