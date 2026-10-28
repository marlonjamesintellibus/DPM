// M25 (conversational plan, section 9): every arrow, its guards, and the model check's three fixes: the model
// timer on requested, the reader check on COPY of a client status and on POST, and DR5's Refresh drawn.
import { describe, expect, it } from "vitest";
import { config } from "../config";
import { draftTemplate, type DraftFacts } from "../drafts";
import { applyDraftEvent, DRAFT_STATES, draftEndText, draftExpired, draftMachine, modelTimedOut, newDraft, tryOfRound, type DraftEvent, type DraftRecord, type DraftState } from "./draft";

const MADE = new Date("2026-10-20T14:10:00Z");
const later = (seconds: number) => new Date(MADE.getTime() + seconds * 1000);

const FACTS: DraftFacts = {
  kind: "standup",
  heading: "Kemar's standup, Tue 20 Oct",
  sections: [
    { title: "Since yesterday", facts: [{ key: "saved:x-1", text: "#145 Google Trends connector: In progress to Done" }], none: "No changes since yesterday." },
    { title: "In progress", facts: [{ key: "work:wi-147", text: "#147 Trend scoring model (Forager 2.0), due Fri 23 Oct", name: "Trend scoring model" }], none: "Nothing in progress." },
  ],
  asOf: MADE.toISOString(),
};
const GOOD = "Yesterday I finished #145 Google Trends connector. Today I'm on #147 Trend scoring model, due Fri 23 Oct.";
const INVENTED = "I finished #145 and #152 is next, due Mon 26 Oct.";

const at = (state: DraftState, fields: Partial<DraftRecord> = {}): DraftRecord => ({
  ...newDraft({ id: "draft-cap-1", ownerId: "kemar", kind: "standup", projectId: null, captureId: "cap-1", facts: FACTS }),
  state,
  attempt: state === "none" ? 0 : 1,
  attemptAt: state === "requested" ? MADE : null,
  text: state === "ready" ? GOOD : null,
  by: state === "ready" ? "atlas" : null,
  readyAt: state === "ready" ? MADE : null,
  ...fields,
});

const base = { actorId: "kemar", now: later(5), right: true, readersOk: true, confirmed: true };

describe("draft arrows", () => {
  const rows: [DraftState, DraftEvent, Partial<DraftRecord>, Partial<typeof base>, DraftState][] = [
    ["none", { type: "REQUEST" }, {}, {}, "requested"],
    ["requested", { type: "DRAFTED", attempt: 1, text: GOOD }, {}, {}, "ready"],
    ["requested", { type: "DRAFTED", attempt: 1, text: INVENTED }, {}, {}, "requested"],
    ["requested", { type: "DRAFTED", attempt: 2, text: INVENTED }, { attempt: 2 }, {}, "ready"],
    ["requested", { type: "DRAFT_FAILED", attempt: 1, why: "model_error" }, {}, {}, "requested"],
    ["requested", { type: "DRAFT_FAILED", attempt: 2, why: "no model connected" }, { attempt: 2 }, {}, "ready"],
    ["ready", { type: "EDIT", text: "My own words about #145." }, {}, {}, "ready"],
    ["ready", { type: "COPY" }, {}, {}, "copied"],
    ["ready", { type: "POST" }, {}, {}, "posted"],
    ["ready", { type: "DISCARD" }, {}, {}, "discarded"],
    ["ready", { type: "EXPIRE" }, {}, { now: later(config.draftExpiryHours * 3600) }, "expired"],
    ["ready", { type: "REFRESH", facts: FACTS }, {}, {}, "requested"],
  ];
  it.each(rows)("%s --%o--> (%o, %o) %s", (from, event, fields, ctx, to) => {
    expect(applyDraftEvent(at(from, fields), event, { ...base, ...ctx }).record.state).toBe(to);
  });

  it("the rows cover every drawn arrow", () => {
    const drawn = new Set(draftMachine.arrows.flatMap((a) => a.from.map((f) => `${f} ${a.on} ${a.to}`)));
    const tested = new Set(rows.map(([f, e, , , t]) => `${f} ${e.type} ${t}`));
    expect([...drawn].filter((a) => !tested.has(a))).toEqual([]);
  });

  it("only drawn arrows: every other event from every state is refused and changes nothing", () => {
    const drawn = new Set(draftMachine.arrows.flatMap((a) => a.from.map((f) => `${f} ${a.on}`)));
    const events: DraftEvent[] = [
      { type: "REQUEST" },
      { type: "DRAFTED", attempt: 1, text: GOOD },
      { type: "DRAFT_FAILED", attempt: 1, why: "model_error" },
      { type: "EDIT", text: "x" },
      { type: "COPY" },
      { type: "POST" },
      { type: "DISCARD" },
      { type: "EXPIRE" },
      { type: "REFRESH", facts: FACTS },
    ];
    for (const state of DRAFT_STATES) {
      for (const event of events.filter((e) => !drawn.has(`${state} ${e.type}`))) {
        const r = applyDraftEvent(at(state), event, { ...base, now: later(config.draftExpiryHours * 3600) });
        expect(r.outcome.ok || r.outcome.reason).toBe(`no arrow from ${state} on ${event.type}`);
        expect(r.record).toEqual(at(state));
      }
    }
    // The finals have no way out: copied, posted, discarded and expired (copyAfterExpiry, noOnceOnly)
    expect(DRAFT_STATES.filter((s) => [...drawn].some((a) => a.startsWith(`${s} `)))).toEqual(["none", "requested", "ready"]);
  });
});

describe("draft guards and effects", () => {
  it("DR3: a client status or weekly summary needs the right, read now; a standup is the owner's own", () => {
    const client = at("none", { kind: "client", projectId: "forager" });
    const refused = applyDraftEvent(client, { type: "REQUEST" }, { ...base, actorId: "kemar", right: false });
    expect(refused.outcome.ok).toBe(false);
    expect(!refused.outcome.ok && refused.outcome.reason).toBe("only a PM or Lead of the project can draft a client status");
    // Someone else can never ask for, or act on, another person's draft (rule 10)
    expect(applyDraftEvent(at("none"), { type: "REQUEST" }, { ...base, actorId: "alicia" }).outcome.ok).toBe(false);
    for (const e of [{ type: "EDIT", text: "x" }, { type: "COPY" }, { type: "DISCARD" }, { type: "REFRESH", facts: FACTS }] as DraftEvent[]) {
      expect(applyDraftEvent(at("ready"), e, { ...base, actorId: "alicia" }).outcome.ok, e.type).toBe(false);
    }
  });

  it("REQUEST starts the first try, and the model timer counts from it", () => {
    const r = applyDraftEvent(at("none"), { type: "REQUEST" }, base).record;
    expect([r.attempt, r.attemptAt]).toEqual([1, base.now]);
    expect(modelTimedOut(r, new Date(base.now.getTime() + config.draftModelSeconds * 1000 - 1))).toBe(false);
    expect(modelTimedOut(r, new Date(base.now.getTime() + config.draftModelSeconds * 1000))).toBe(true);
  });

  it("DR2: a draft that adds a record or a date is refused and tried again; after the tries it is the plain template", () => {
    const first = applyDraftEvent(at("requested"), { type: "DRAFTED", attempt: 1, text: INVENTED }, base).record;
    expect([first.state, first.attempt, first.text]).toEqual(["requested", 2, null]);
    const second = applyDraftEvent(first, { type: "DRAFTED", attempt: 2, text: INVENTED }, base).record;
    expect([second.state, second.by, second.text]).toEqual(["ready", "plain", draftTemplate(FACTS)]);
  });

  it("a draft that passes is Atlas's, as written", () => {
    const r = applyDraftEvent(at("requested"), { type: "DRAFTED", attempt: 1, text: GOOD }, base).record;
    expect([r.state, r.by, r.text, r.readyAt]).toEqual(["ready", "atlas", GOOD, base.now]);
  });

  it("DR2, DR4: a name DPM knows for the asker that the draft was not given is refused", () => {
    // Every word of it is in the facts ("Trend scoring model"), but the milestone Trend model was not given
    const named = `${GOOD} The Trend model is next.`;
    expect(applyDraftEvent(at("requested"), { type: "DRAFTED", attempt: 1, text: named }, { ...base, known: { records: ["Trend model"], people: [] } }).record.state).toBe("requested");
  });

  it("DR6: no model connected fails each try, and the draft is the plain template", () => {
    let r = at("requested");
    r = applyDraftEvent(r, { type: "DRAFT_FAILED", attempt: 1, why: "no model connected" }, base).record;
    r = applyDraftEvent(r, { type: "DRAFT_FAILED", attempt: 2, why: "no model connected" }, base).record;
    expect([r.state, r.by, r.text]).toEqual(["ready", "plain", draftTemplate(FACTS)]);
  });

  it("the model check's fix: the timer is a DRAFT_FAILED, only once the try has had its time", () => {
    const early = applyDraftEvent(at("requested"), { type: "DRAFT_FAILED", attempt: 1, why: "timer" }, { ...base, now: later(config.draftModelSeconds - 1) });
    expect(early.outcome.ok).toBe(false);
    const due = applyDraftEvent(at("requested"), { type: "DRAFT_FAILED", attempt: 1, why: "timer" }, { ...base, now: later(config.draftModelSeconds) });
    expect([due.record.state, due.record.attempt]).toEqual(["requested", 2]);
  });

  it("rule 6: a late reply to an earlier try changes nothing (the planted bug noAttemptCheck)", () => {
    const onTwo = at("requested", { attempt: 2 });
    for (const e of [{ type: "DRAFTED", attempt: 1, text: GOOD }, { type: "DRAFT_FAILED", attempt: 1, why: "timer" }] as DraftEvent[]) {
      const r = applyDraftEvent(onTwo, e, { ...base, now: later(3600) });
      expect(r.outcome.ok).toBe(false);
      expect(r.record).toEqual(onTwo);
    }
  });

  it("EDIT keeps their words and marks it edited; an empty draft is refused", () => {
    const r = applyDraftEvent(at("ready"), { type: "EDIT", text: "  Finished #145.  " }, base).record;
    expect([r.text, r.edited]).toEqual(["Finished #145.", true]);
    expect(applyDraftEvent(at("ready"), { type: "EDIT", text: "  " }, base).outcome.ok).toBe(false);
    // The same text again is not an edit
    expect(applyDraftEvent(at("ready"), { type: "EDIT", text: GOOD }, base).record.edited).toBe(false);
  });

  it("ReaderCheck: COPY of a client status needs every fact in the client view now; the others are the owner's", () => {
    const client = at("ready", { kind: "client", projectId: "forager" });
    expect(applyDraftEvent(client, { type: "COPY" }, { ...base, readersOk: false }).outcome.ok).toBe(false);
    expect(applyDraftEvent(client, { type: "COPY" }, { ...base, readersOk: true }).record.state).toBe("copied");
    expect(applyDraftEvent(at("ready"), { type: "COPY" }, { ...base, readersOk: undefined }).record.state).toBe("copied");
  });

  it("rule 4, DR3: COPY checks the right again, as Refresh does: a PM made a member since cannot copy her client status", () => {
    for (const kind of ["client", "weekly"] as const) {
      const r = applyDraftEvent(at("ready", { kind, projectId: "forager" }), { type: "COPY" }, { ...base, actorId: "kemar", right: false });
      expect(r.outcome.ok || r.outcome.reason, kind).toBe(`only a PM or Lead of the project can draft a ${kind === "client" ? "client status" : "weekly summary"}`);
      expect(r.record.state).toBe("ready");
    }
  });

  it("POST waits for the confirm, the right now and every reader (rules 4, 8 and 9)", () => {
    for (const ctx of [{ confirmed: false }, { right: false }, { readersOk: false }]) expect(applyDraftEvent(at("ready"), { type: "POST" }, { ...base, ...ctx }).outcome.ok).toBe(false);
  });

  it("DR5: Refresh starts again from the facts now, with the right checked again, and keeps their edits aside", () => {
    const edited = applyDraftEvent(at("ready"), { type: "EDIT", text: "My words." }, base).record;
    const facts = { ...FACTS, asOf: later(60).toISOString() };
    const r = applyDraftEvent(edited, { type: "REFRESH", facts }, { ...base, now: later(60) }).record;
    // Rule 6: the try's number only rises, so the new round starts at try 3, its own first
    expect([r.state, r.attempt, tryOfRound(r.attempt), r.text, r.aside, r.edited, r.facts.asOf]).toEqual(["requested", 3, 1, null, "My words.", false, facts.asOf]);
    // An unedited refresh keeps what was aside before
    const again = applyDraftEvent({ ...r, state: "ready", text: GOOD }, { type: "REFRESH", facts }, base).record;
    expect(again.aside).toBe("My words.");
    // A Lead who lost the role cannot refresh a weekly summary (rule 4)
    expect(applyDraftEvent(at("ready", { kind: "weekly", projectId: "forager" }), { type: "REFRESH", facts }, { ...base, right: false }).outcome.ok).toBe(false);
  });

  it("rule 6, DR5: a reply to a try from before the Refresh changes nothing; the new round has its own two tries", () => {
    // Try 1 was still with the model when they refreshed: its reply, good or not, is a reply to an earlier try
    const refreshed = applyDraftEvent(at("ready", { attempt: 1 }), { type: "REFRESH", facts: FACTS }, base).record;
    for (const e of [{ type: "DRAFTED", attempt: 1, text: GOOD }, { type: "DRAFT_FAILED", attempt: 1, why: "model_error" }] as DraftEvent[]) {
      const r = applyDraftEvent(refreshed, e, base);
      expect(r.outcome.ok || r.outcome.reason).toBe("a reply to an earlier try");
      expect(r.record).toEqual(refreshed);
    }
    // The round's two tries, then the plain template; a Refresh from try 4 starts the next round at 5
    const second = applyDraftEvent(refreshed, { type: "DRAFTED", attempt: 3, text: INVENTED }, base).record;
    expect([second.state, second.attempt]).toEqual(["requested", 4]);
    const plain = applyDraftEvent(second, { type: "DRAFT_FAILED", attempt: 4, why: "model_error" }, base).record;
    expect([plain.state, plain.by]).toEqual(["ready", "plain"]);
    expect(applyDraftEvent(plain, { type: "REFRESH", facts: FACTS }, base).record.attempt).toBe(5);
  });

  it("the expiry timer counts from ready", () => {
    expect(draftExpired(at("ready"), later(config.draftExpiryHours * 3600 - 1))).toBe(false);
    expect(draftExpired(at("ready"), later(config.draftExpiryHours * 3600))).toBe(true);
    expect(applyDraftEvent(at("ready"), { type: "EXPIRE" }, base).outcome.ok).toBe(false);
  });

  it("each end says what happened in plain words", () => {
    expect(draftEndText(at("copied"))).toBe("Copied. Paste it where you need it.");
    expect(draftEndText(at("discarded"))).toBe("Discarded. Nothing was sent.");
    expect(draftEndText(at("expired", { kind: "weekly" }))).toBe("This draft expired. Ask me again for a fresh weekly summary.");
    expect(draftEndText(at("ready"))).toBeNull();
  });
});
