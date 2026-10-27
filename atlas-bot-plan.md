# DPM in Atlas: the bot plan

**Status:** draft, 27 Oct 2026. Written from the three Atlas bot documents Marlon shared (`create-atlas-bot`: the skill, identity, chat formatting). More is coming; this plan changes when it does. Nothing here is built.

**What it changes:** build plan B8 assumed Atlas would push captures to one DPM endpoint. The documents describe a different shape: DPM has its own **Atlas bot**, which lives in ordinary Atlas chats and calls a **DPM API** for every fact and every change. The core of DPM (captures, the 14 checks, review, rules, the BRAID log, conversations) does not change; the bot is a new way in.

## 1. What it is for

People use DPM from their phone, in Atlas, without opening the web app:

- **Kemar** sends his update to the DPM bot (text, and voice if the bot can receive it), sees what DPM made of it, accepts the items that need his OK, and saves.
- **Kemar** asks "What needs me today?" or "What's blocked on Forager?" and gets the answer from his own data.
- **Alicia** is told a risk waits for her, and approves or declines it there.
- **Anyone** hears what happened to what they reported ("Alicia approved your risk").

The web app stays the place for the plan, the BRAID table, the dashboard and anything long.

## 2. How it maps onto what is built

| In DPM today | In the Atlas bot |
|---|---|
| The chat (sections 15 to 17) | A direct chat with the DPM bot |
| A conversation with channel `atlas` (section 16) | One per Atlas chat; the chat id is the Matrix room id |
| `createCapture` then the read (M2), the checks, the review | The bot sends the message; DPM runs the same pipeline |
| Answers from the asker's own data (`queries/answer.ts`) | The same answers, returned as a `chatSummary` for the phone |
| Cards with Accept (section 17) | Choice chips with silent values |
| View as (prototype) | The linked Atlas account: Matrix id to DPM person |
| Per-viewer queries and command rights (rule 7, P10) | The API's access control: the same queries, keyed by the caller |
| Notices (D15) and inbox items (M10) | Messages the bot sends to the person (if the SDK allows it; AQ5) |

## 3. Architecture

```
Atlas mobile  ->  DPM bot (long-lived Node service, atlas-bot-sdk ^0.1.2)
                     |  every call carries caller: { atlasUserId: ctx.sender }
                     v
                  DPM API   POST /api/atlas/query   (app key header)
                     |  Matrix id -> atlas_links -> DPM person -> project roles
                     |  /link only:
                     v
                  Company directory (CRM): phone -> email
```

| Piece | Owns |
|---|---|
| DPM bot | The Atlas token, the message stream, `/start`, `/link`, `/unlink`, choice chips, sending DPM's text as given |
| DPM API | The link table, access control on every call, the tools, `chatSummary`, the directory client and its key |
| Company directory | Phone to email. Never DPM roles, never DPM data |
| DPM core | Everything it owns now: captures, items, the BRAID log, rules, statuses, audit |

Rules from the documents that this plan keeps:

- The bot is thin: a tool handler is an HTTP call with the caller, and it never makes up a result.
- The API is the authority. A role filter in the bot is only for what to offer; the API refuses anything the person may not do.
- `ctx.sender` is a Matrix id, not a phone or a DPM id. The phone is used once, at `/link`.
- The directory key lives on the DPM host only, never on the bot. No allowlists of ids.
- Directory errors, HTML pages and stack traces never reach the chat: one short sentence, details in the server log.

## 4. Linking an Atlas account (M19, new)

A person links once. Every later message finds them by Matrix id in DPM's `atlas_links` table; the directory is not called again.

```
unlinked --LINK(phone, proof)--> linked      lookup found, a DPM person has that email, the directory binds, the row is written
unlinked --LINK--> unlinked                  refused: no verified phone, not in the directory, no DPM person, bound to another chat, directory down
linked --LINK--> linked                      the same bind again (alreadyLinked); nothing changes
linked --UNLINK--> unlinked                  DPM deletes its row first, then tells the directory
linked --REVOKE--> unlinked                  the directory says so (offboarding); DPM deletes its row only
```

- `proof` is recorded with the link: `provider_verified` (Atlas gave the phone), `provider_resolved` (a typed number Atlas confirmed), or `unverified` (staging only).
- If writing DPM's row fails after the directory bound it, DPM unbinds it again, so the two never disagree.
- An unlinked chat gets only "Link now" and "How to link" (silent chips) and no DPM data at all.

| # | Case | Expected |
|---|---|---|
| AL1 | Unlinked person sends anything | The link prompt; nothing about any project |
| AL2 | Link with Atlas's verified phone | Linked; Atlas's phone check is not called again |
| AL3 | A typed number that differs from Atlas's verified phone | Refused |
| AL4 | In the directory, but no DPM person with that email | Refused: "No DPM account for that email"; the directory is not bound |
| AL5 | That DPM person is already linked to another Atlas account | Refused (directory 409); DPM's row is not written |
| AL6 | Link again from the same chat | "Already linked"; nothing changes |
| AL7 | The directory is down during `/link` | "Linking isn't available right now"; people already linked keep working |
| AL8 | The directory is down later | Nothing changes for linked people: the directory is only used at `/link` |
| AL9 | Revoked by the directory | DPM's row goes; the next message gets the link prompt |
| AL10 | `/unlink` | DPM's row goes first, then the directory; the chat gets the link prompt |

## 5. The DPM tools

Every call is `{ tool, args, caller: { atlasUserId } }`. The API resolves the caller to a DPM person, then runs the same query or command the web app runs as that person. A self-scoped tool never takes a person id from the model.

**Linking:** `resolve_caller`, `link_atlas_user`, `unlink_atlas_user`.

**Messages:**

| Tool | What it does | Built on |
|---|---|---|
| `send_message(text, chatId, messageId)` | Stores the message in that chat's conversation and reads it: an update, a question or both. Returns what DPM made of it, as `chatSummary` and data | `createCapture`, `readCapture`, section 15 |
| `message_status(captureId)` | The same result, for a read that took longer than the call (AQ8) | the chat query |

**Questions** (also what `send_message` answers): `what_needs_me`, `whats_blocked(project?)`, `project_status(project?)`, `braid_log(project, kind?)` (the topic planned for section 15).

**Narrow changes,** each one the same command the web app uses, so every right and refusal holds:

| Tool | Who | Built on |
|---|---|---|
| `accept_item(itemId)`, `reject_item(itemId)` | The author of the update | `decideExtraction` |
| `save_update(captureId)` | The author, once nothing needs their OK | `saveCapture` |
| `decide_entry(entryId, approve or decline, note)` | A PM or Lead, or a decision's approver | `decideBraidEntry` |

Everything else (renaming conversations, changing kinds, the plan, the table) stays in the web app; the bot links to it.

## 6. A message from Atlas, start to end

1. Kemar sends "Finished #145, and what's blocked on Forager?" to the DPM bot.
2. The bot checks he is linked (`resolve_caller`), then calls `send_message` with the text, the chat id and Atlas's message id. The message id keeps a resend to one capture (D14).
3. DPM stores it in the chat's conversation (section 16) and reads it with the model and checks it uses now. A follow-up is read with the conversation, as in the web chat.
4. DPM returns the `chatSummary`: what it proposes for review, and the answer to the question. The bot sends it as given, then the chips.
5. If the read takes longer than the bot should wait, DPM returns "still reading" and the bot asks again with `message_status` (AQ8).

**Recommended: DPM reads every message.** The documents' default lets the platform model in the bot choose tools. For DPM, updates must go through DPM's own read anyway (the checks, the review, the audit and the evaluation set all live there), so the simplest safe path is that the bot passes every free-text message to `send_message`, and DPM decides whether it is an update, a question or both, exactly as the web chat does. The platform model is then used only if DPM's reply needs no more wording. AQ6 asks whether Atlas wants it the other way.

## 7. Replies on a phone

From the formatting document: no tables, no `#` headings, no space-aligned columns, no long lines joined with dashes; bold labels and plain values; counts in a header must match what is listed. DPM formats once, in the API (`chatSummary`), and the bot sends it nearly as-is.

An update, after DPM read it:

```
Got it. **9 updates for 2 projects.** 4 need your OK.

**Forager 2.0** · 7 updates · 4 need your OK
**Store Insights** · 2 updates

**Needs your OK**
1. **Milestone Trend model:** forecast 23 Oct to 24 Oct (medium confidence)
2. **Handover Runbook:** not done to handed to Jodian (low confidence)
3. **New risk:** Trend model may slip to 24 Oct (medium confidence)
4. **Pipeline risk:** add as evidence (medium confidence)
```

Chips: `Accept 1`, `Accept 2`, `Accept 3`, `Accept 4`, `Open review` (a link to the web review), and `Save 9 updates` once nothing needs an OK. Accept and Save are silent chips, so the tap does not appear as a command in the chat.

A question:

```
**1 thing is blocked** on your projects.

**Store sales feed access** · Forager 2.0
1 report, since 14 Oct
```

Chips: `What needs me today?`, `Open the BRAID log`.

## 8. Edge cases for the bot (AB1 to AB12)

| # | Case | Expected |
|---|---|---|
| AB1 | The same Atlas message delivered twice | One capture (D14); the bot sends the reply once |
| AB2 | Kemar edits or deletes his Atlas message after sending | Nothing changes in DPM: a capture is stored as received (C1). Open: AQ9 |
| AB3 | A chip tapped after the update was saved | "That update was saved already"; nothing changes (MF6) |
| AB4 | A chip tapped by someone else in a group chat | Refused: only the author accepts their items. Open: AQ2 |
| AB5 | A message that asks for another person's data | Answered from the caller's own data only (P10, QA5) |
| AB6 | The DPM API is down | One short sentence ("DPM isn't reachable right now"); the message is not lost if Atlas can redeliver it (AQ8) |
| AB7 | The read fails after its retries | The same words as the web chat (D1), and the message stays in the conversation |
| AB8 | A long answer | At most 8 items, then "N more in DPM" with a link (MF11) |
| AB9 | A message in an unlinked chat | The link prompt only (AL1) |
| AB10 | The person's DPM role changed since the chips were sent | The API checks the role when the chip is tapped (rule 7) |
| AB11 | Prompt injection in a message | Read as data, as now (A9.3); the tools take no person id from the model |
| AB12 | A voice note | If the bot receives audio or a transcript, it goes through the same read (D1). Open: AQ1 |

## 9. Building it

| # | Step | Done when |
|---|---|---|
| A1 | Decide AQ1 to AQ8 with Marlon and Atlas infra | The open questions below are answered or given defaults |
| A2 | DPM API: `POST /api/atlas/query` with the app key, the caller, access control, and the read tools returning `chatSummary` | Contract tests: every tool as linked and unlinked people; nothing reaches an unlinked caller |
| A3 | Linking: `atlas_links`, the directory client, `/link` in four steps, `/unlink`, the revoke route | AL1 to AL10 as tests against a fake directory |
| A4 | `send_message` on the existing pipeline, with `message_status` for long reads | The story's note sent through the API gives the same 11 items as the web chat |
| A5 | The narrow changes: accept, reject, save, decide | The story played through the API: Kemar saves, Alicia approves, Andre approves |
| A6 | The bot service (`services/dpm-atlas-bot`, outside the app's typecheck and tests), with `/start`, `/link`, `/unlink`, messages and chips | Driven by the SDK's sync payloads and a fake DPM client; the smoke list in the documents passes |
| A7 | Deploy: DPM API first, then the bot | A linked tester sends Kemar's note from Atlas on a phone and reviews it there |

The bot needs `ATLAS_BOT_TOKEN`, the DPM API origin and app key, and the link mode settings. The DPM host needs the directory origin and key. Keys are set by whoever holds them, never written into this repository.

## 10. Open questions (AQ1 to AQ10)

| # | Question | Default until answered |
|---|---|---|
| AQ1 | Can the bot receive voice notes: the audio, Atlas's transcript, or neither? | Text only through the bot; voice stays a later step |
| AQ2 | Does the DPM bot sit in project group chats, or only in direct chats? The documents set bots up direct-first; the briefing has group admins assigning roles | Direct chats only |
| AQ3 | Where are project roles set: by the group admin in Atlas, stored in DPM, or read from Atlas? (B9) | DPM keeps project roles; Atlas does not decide them (the documents say the directory never decides product roles) |
| AQ4 | How much can be done in Atlas: accept and save, approve and decline, or only read with links to the web? | Accept, reject, save and decide in Atlas; everything else in the web app |
| AQ5 | Can the bot message a person first (notices, "a risk waits for you"), or only reply? | Notices wait until the person next writes; the web app shows them as now |
| AQ6 | Who reads messages: DPM's model and checks (recommended), or the platform model in the bot choosing tools? | DPM reads every message (section 6) |
| AQ7 | Which company directory instance, and which environment, does DPM link against? | Soft link mode in staging until the directory is set |
| AQ8 | How long may a bot turn wait for DPM, and does Atlas redeliver a message the bot failed to handle? | DPM answers within 20 seconds or says it is still reading; the bot asks again |
| AQ9 | What happens when someone edits or deletes an Atlas message after sending it? | Nothing in DPM: the capture is kept as received |
| AQ10 | Does B8 still stand alongside the bot: Atlas pushing captures from group streams whose owner authorized it (the 26 Oct decision)? | Both may exist; the bot comes first, because the documents describe it |
