import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CLIENT_VIEW_STATES, clientViewMachine, clientViewState, contactSubject, switchClientView, type ClientViewEvent, type ClientViewRecord, type ClientViewState } from "./client-view";

const kyle = (state: ClientViewState): ClientViewRecord => ({ projectId: "forager", personId: "kyle", state });
const PM = { byPm: true, outside: true };

describe("client view arrows (CD49)", () => {
  it("draws exactly two arrows: off -> on and on -> off", () => {
    expect(clientViewMachine.arrows.map((a) => [a.from, a.on, a.to])).toEqual([
      [["off"], "TURN_ON", "on"],
      [["on"], "TURN_OFF", "off"],
    ]);
  });

  it("off -> on by the PM, for an outside contact, audited", () => {
    const r = switchClientView(kyle("off"), { type: "TURN_ON" }, "alicia", PM);
    expect(r.outcome).toMatchObject({ ok: true, from: "off", to: "on" });
    expect(r.record).toEqual(kyle("on"));
    expect(r.audit).toEqual({ action: "TURN_ON", projectId: "forager", personId: "kyle", by: "alicia", from: "off", to: "on" });
  });

  it("on -> off by the PM, audited", () => {
    const r = switchClientView(kyle("on"), { type: "TURN_OFF" }, "alicia", PM);
    expect(r.outcome).toMatchObject({ ok: true, from: "on", to: "off" });
    expect(r.audit).toMatchObject({ action: "TURN_OFF", from: "on", to: "off" });
  });

  it("anyone who is not the project's PM is refused both ways, and nothing changes", () => {
    for (const [state, type] of [["off", "TURN_ON"], ["on", "TURN_OFF"]] as const) {
      const record = kyle(state);
      const r = switchClientView(record, { type }, "kemar", { byPm: false, outside: true });
      expect(r).toMatchObject({ outcome: { ok: false, reason: "only the project's PM turns a contact's client view on or off" }, audit: null });
      expect(r.record).toBe(record);
    }
  });

  it("someone in the org has no client view to turn on; one left on by mistake can still be turned off", () => {
    expect(switchClientView(kyle("off"), { type: "TURN_ON" }, "alicia", { byPm: true, outside: false }).outcome).toMatchObject({
      ok: false,
      reason: "only an outside contact has a client view; someone in the org reads the project as a member",
    });
    expect(switchClientView(kyle("on"), { type: "TURN_OFF" }, "alicia", { byPm: true, outside: false }).record.state).toBe("off");
  });

  it("rule 6: a repeat changes nothing and says so; someone without the right hears that first", () => {
    // A refusal of this machine, from the state it was in, in its own words (not the engine's "no arrow")
    expect(switchClientView(kyle("on"), { type: "TURN_ON" }, "alicia", PM).outcome).toEqual({ ok: false, machine: "client_view", event: "TURN_ON", from: "on", reason: "it is already on" });
    expect(switchClientView(kyle("off"), { type: "TURN_OFF" }, "alicia", PM).outcome).toMatchObject({ ok: false, reason: "it is already off" });
    expect(switchClientView(kyle("on"), { type: "TURN_ON" }, "kemar", { byPm: false, outside: true }).outcome).toMatchObject({ ok: false, reason: "only the project's PM turns a contact's client view on or off" });
  });

  it("the stored flag reads as the state; its subject on the trail is the contact on the project", () => {
    expect([clientViewState(true), clientViewState(false)]).toEqual(["on", "off"]);
    expect(contactSubject("forager", "kyle")).toBe("forager@kyle");
  });
});

describe("the switch keeps its rules", () => {
  it("only the PM moves it; every move is audited; a refusal changes nothing; on needs an outside contact", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CLIENT_VIEW_STATES),
        fc.array(fc.record({ type: fc.constantFrom<ClientViewEvent["type"]>("TURN_ON", "TURN_OFF"), byPm: fc.boolean(), outside: fc.boolean() }), { maxLength: 20 }),
        (start, events) => {
          let record = kyle(start);
          for (const { type, ...ctx } of events) {
            const r = switchClientView(record, { type }, "someone", ctx);
            expect(r.audit !== null).toBe(r.outcome.ok);
            if (!r.outcome.ok) expect(r.record).toBe(record);
            if (r.outcome.ok) {
              expect(ctx.byPm).toBe(true);
              expect(r.record.state).toBe(type === "TURN_ON" ? "on" : "off");
              if (type === "TURN_ON") expect(ctx.outside).toBe(true);
            }
            record = r.record;
          }
        },
      ),
      { numRuns: 2000 },
    );
  });
});
