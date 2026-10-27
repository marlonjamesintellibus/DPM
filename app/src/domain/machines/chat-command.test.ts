// M20 (conversational plan, section 4): every arrow, its guards, and the model check's two fixes: the
// referent is checked against the asker's lines now (lines_now), and the right before the version.
import { describe, expect, it } from "vitest";
import {
  applyChatCommandEvent,
  CHAT_COMMAND_STATES,
  chatCommandMachine,
  commandButton,
  commandExpired,
  commandOutcomeText,
  commandQuestion,
  draftCommand,
  rightLostText,
  runProblem,
  type ChatCommandEvent,
  type ChatCommandRecord,
  type ChatCommandState,
  type Standing,
} from "./chat-command";

const MADE = new Date("2026-10-20T14:10:00Z");
const later = (minutes: number) => new Date(MADE.getTime() + minutes * 60_000);

const at = (state: ChatCommandState, fields: Partial<ChatCommandRecord> = {}): ChatCommandRecord => ({
  ...draftCommand({
    id: "cmd-1",
    askerId: "alicia",
    via: "words",
    captureId: "cap-reply",
    answerCaptureId: "cap-answer",
    line: 1,
    act: "approve",
    subject: { type: "braid_entry", id: "br-risk", projectId: "forager" },
    proposal: "entry",
    about: { kind: "risk", name: "Trend model may slip to 24 Oct", project: "Forager 2.0" },
    seenVersion: 3,
    createdAt: MADE,
  }),
  state,
  ...fields,
});

const HOLDS: Standing = { right: true, version: 3 };
const base = { actorId: "alicia", now: later(5), readable: true, standing: HOLDS };

describe("chat command arrows", () => {
  const rows: [ChatCommandState, ChatCommandEvent, Partial<typeof base>, ChatCommandState][] = [
    ["none", { type: "PROPOSE" }, {}, "proposed"],
    ["none", { type: "TAP" }, {}, "done"],
    ["none", { type: "TAP" }, { standing: { right: false, version: 3 } }, "refused"],
    ["proposed", { type: "CONFIRM" }, {}, "done"],
    ["proposed", { type: "CONFIRM" }, { standing: { right: true, version: 4 } }, "refused"],
    ["proposed", { type: "CANCEL" }, {}, "cancelled"],
    ["proposed", { type: "EXPIRE" }, { now: later(30) }, "expired"],
  ];
  it.each(rows)("%s --%o--> (%o) %s", (from, event, ctx, to) => {
    expect(applyChatCommandEvent(at(from), event, { ...base, ...ctx }).record.state).toBe(to);
  });

  it("the rows cover every drawn arrow", () => {
    const drawn = new Set(chatCommandMachine.arrows.flatMap((a) => a.from.map((f) => `${f} ${a.on} ${a.to}`)));
    const tested = new Set(rows.map(([f, e, , t]) => `${f} ${e.type} ${t}`));
    expect([...drawn].filter((a) => !tested.has(a))).toEqual([]);
  });

  it("only drawn arrows: every other event from every state is refused and changes nothing (once only, AC4)", () => {
    const drawn = new Set(chatCommandMachine.arrows.flatMap((a) => a.from.map((f) => `${f} ${a.on}`)));
    const events: ChatCommandEvent[] = [{ type: "PROPOSE" }, { type: "TAP" }, { type: "CONFIRM" }, { type: "CANCEL" }, { type: "EXPIRE" }];
    for (const state of CHAT_COMMAND_STATES) {
      for (const event of events.filter((e) => !drawn.has(`${state} ${e.type}`))) {
        const r = applyChatCommandEvent(at(state), event, { ...base, now: later(60) });
        expect(r.outcome.ok || r.outcome.reason).toBe(`no arrow from ${state} on ${event.type}`);
        expect(r.record).toEqual(at(state));
      }
    }
    // A second CONFIRM on a done card, or a tap on an expired one, finds no arrow (AC4, AC10, the planted
    // bugs rerun and reviveExpired)
    expect(CHAT_COMMAND_STATES.filter((s) => [...drawn].some((a) => a.startsWith(`${s} `)))).toEqual(["none", "proposed"]);
  });
});

describe("the guards", () => {
  it("the model check's fix lines_now: a line the asker can no longer read is not a command (AC9)", () => {
    const r = applyChatCommandEvent(at("none"), { type: "PROPOSE" }, { ...base, readable: false });
    expect(r.outcome.ok || r.outcome.reason).toBe("that answer is out of date");
    expect(r.record.state).toBe("none");
  });

  it("rule 10: only the asker proposes, confirms or cancels (YourWordOnly)", () => {
    for (const [state, event] of [
      ["none", { type: "PROPOSE" }],
      ["none", { type: "TAP" }],
      ["proposed", { type: "CONFIRM" }],
      ["proposed", { type: "CANCEL" }],
    ] as [ChatCommandState, ChatCommandEvent][]) {
      const r = applyChatCommandEvent(at(state), event, { ...base, actorId: "kemar" });
      expect(r.outcome.ok || r.outcome.reason).toBe("only the person who asked can confirm or cancel it");
    }
  });

  it("the model check's fix: the right is checked before the version (AC1 before AC2 and AC3)", () => {
    expect(runProblem({ seenVersion: 3 }, { right: false, version: 4 })).toBe("right_lost");
    expect(runProblem({ seenVersion: 3 }, { right: true, version: 4 })).toBe("changed");
    expect(runProblem({ seenVersion: 3 }, { right: true, version: null })).toBe("changed");
    expect(runProblem({ seenVersion: 3 }, { right: true, version: 3, refusedBy: "a decline needs a reason" })).toBe("refused");
    expect(runProblem({ seenVersion: 3 }, HOLDS)).toBeNull();
    const lost = applyChatCommandEvent(at("proposed"), { type: "CONFIRM" }, { ...base, standing: { right: false, version: 4 } });
    expect(lost.record).toMatchObject({ state: "refused", refusedWhy: "right_lost", decidedAt: later(5) });
  });

  it("AC3, AC5: a version moved since the answer is refused, however old the answer; the same version runs", () => {
    const old = at("none", { via: "tap", createdAt: later(3 * 24 * 60) });
    expect(applyChatCommandEvent(old, { type: "TAP" }, { ...base, standing: { right: true, version: 5 } }).record.refusedWhy).toBe("changed");
    expect(applyChatCommandEvent(old, { type: "TAP" }, base).record.state).toBe("done");
  });

  it("the screen command's own refusal makes it refused, with nothing changed", () => {
    const r = applyChatCommandEvent(at("proposed"), { type: "CONFIRM" }, { ...base, standing: { ...HOLDS, refusedBy: "the project needs a second approver" } });
    expect(r.record).toMatchObject({ state: "refused", refusedWhy: "refused" });
  });

  it("a decline says why, and a reason has words: without them the card stays open", () => {
    const decline = at("proposed", { act: "decline" });
    const r = applyChatCommandEvent(decline, { type: "CONFIRM" }, base);
    expect(r.outcome.ok || r.outcome.reason).toBe("say why you decline");
    expect(r.record.state).toBe("proposed");
    expect(applyChatCommandEvent(decline, { type: "CONFIRM", input: { reason: "We track this slip already" } }, base).record).toMatchObject({ state: "done", input: { reason: "We track this slip already" } });
    // Said in the reply already ("Decline it, we track that"): no box to fill
    expect(applyChatCommandEvent(at("proposed", { act: "decline", input: { reason: "covered" } }), { type: "CONFIRM" }, base).record.state).toBe("done");
    // Keep open needs no words; a status reason does
    expect(applyChatCommandEvent(at("proposed", { act: "decline", proposal: "outcome" }), { type: "CONFIRM" }, base).record.state).toBe("done");
    const reason = at("none", { act: "give_reason", subject: { type: "project", id: "forager", projectId: "forager" }, proposal: null });
    expect(applyChatCommandEvent(reason, { type: "TAP", input: { reason: " " } }, base).outcome.ok).toBe(false);
    // M9, D17: a reason links an entry on the log; without one it is words still missing, never a refusal
    // that spends the line's button (rule 5)
    const unlinked = applyChatCommandEvent(reason, { type: "TAP", input: { reason: "Waiting on Kyle", entryIds: [] } }, base);
    expect(unlinked.outcome.ok || unlinked.outcome.reason).toBe("link at least one BRAID entry on the log, or add one to the log first");
    expect(unlinked.record.state).toBe("none");
    expect(applyChatCommandEvent(reason, { type: "TAP", input: { reason: "Waiting on Kyle", entryIds: ["br-feed-blocker"] } }, base).record.state).toBe("done");
    // A card from words carries what DPM's draft links; confirming adds only the words
    const card = at("proposed", { act: "give_reason", subject: { type: "project", id: "forager", projectId: "forager" }, proposal: null, input: { entryIds: ["br-feed-blocker"] } });
    expect(applyChatCommandEvent(card, { type: "CONFIRM", input: { reason: "Waiting on Kyle" } }, base).record).toMatchObject({ state: "done", input: { reason: "Waiting on Kyle", entryIds: ["br-feed-blocker"] } });
    // ...but a refusal is final whatever words came with it
    expect(applyChatCommandEvent(decline, { type: "CONFIRM" }, { ...base, standing: { right: false, version: 3 } }).record.state).toBe("refused");
  });

  it("AC10, CD2: a card expires after config.commandExpiryMinutes, not before", () => {
    expect(commandExpired(at("proposed"), later(29))).toBe(false);
    expect(commandExpired(at("proposed"), later(30))).toBe(true);
    expect(commandExpired(at("done"), later(60))).toBe(false);
    const early = applyChatCommandEvent(at("proposed"), { type: "EXPIRE" }, { ...base, now: later(29) });
    expect(early.outcome.ok || early.outcome.reason).toBe("a card stays open 30 minutes");
  });
});

describe("what the chat says", () => {
  const about = { kind: "risk", name: "Store sales feed access", project: "Forager 2.0" };
  it.each([
    [{ act: "approve", proposal: "entry", outcome: null }, 'Approve risk "Store sales feed access" on Forager 2.0?', "Approve", "Approved."],
    [{ act: "approve", proposal: "outcome", outcome: "closed" }, 'Mark risk "Store sales feed access" on Forager 2.0 closed?', "Mark closed", "Marked closed."],
    [{ act: "approve", proposal: "clear", outcome: null }, 'Resolve risk "Store sales feed access" on Forager 2.0?', "Resolve", "Resolved."],
    [{ act: "decline", proposal: "entry", outcome: null }, 'Decline risk "Store sales feed access" on Forager 2.0?', "Decline", "Declined."],
    [{ act: "decline", proposal: "outcome", outcome: null }, 'Keep risk "Store sales feed access" on Forager 2.0 open?', "Keep open", "Kept open."],
    [{ act: "resolve", proposal: null, outcome: null }, 'Resolve risk "Store sales feed access" on Forager 2.0?', "Resolve", "Resolved."],
    [{ act: "give_reason", proposal: null, outcome: null }, "Give this reason for Forager 2.0's status?", "Save reason", "Reason saved."],
  ] as const)("%o", (r, question, button, done) => {
    expect(commandQuestion({ ...r, about })).toBe(question);
    expect(commandButton(r)).toBe(button);
    expect(commandOutcomeText({ ...r, state: "done", refusal: null })).toBe(done);
  });

  it("AC1: names nothing; cancelled and expired say nothing changed", () => {
    expect(rightLostText("approve")).toBe("You can no longer approve this.");
    expect(rightLostText("mark_done")).toBe("You can no longer mark this done.");
    expect(rightLostText("give_reason")).toBe("You can no longer give a reason for this.");
    const r = { act: "approve", proposal: "entry", outcome: null, refusal: "Alicia approved this at 9:52am." } as const;
    expect(commandOutcomeText({ ...r, state: "refused" })).toBe("Alicia approved this at 9:52am.");
    expect(commandOutcomeText({ ...r, state: "cancelled" })).toBe("Cancelled. Nothing changed.");
    expect(commandOutcomeText({ ...r, state: "expired" })).toBe("This expired. Nothing changed.");
    expect(commandOutcomeText({ ...r, state: "proposed" })).toBeNull();
  });
});
