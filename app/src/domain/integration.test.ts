// Tests for the pieces that join the four domain parts: the fields the server checks hand to the
// capture machine, routing by an explicit target, and the shared helpers (phase 1b integration).
import { describe, expect, it } from "vitest";
import { runChecks } from "./atlas-checks/checks";
import { KEMAR_CONTEXT, KEMAR_PROPOSALS } from "./atlas-checks/kemar-note.fixture";
import type { RawProposal } from "./atlas-checks/types";
import { planSave } from "./capture-save";
import { isWorkingDay, workingDaysBetween } from "./dates";
import { applyItemEvent, startItem } from "./machines/extracted-item";
import { mayMerge } from "./rights";

const kemar = () => runChecks(KEMAR_PROPOSALS, KEMAR_CONTEXT);

describe("what the server checks hand to the capture machine", () => {
  it("item 3 carries what #151 waits on", () => {
    const item3 = kemar().items.find((i) => i.target?.id === "wi-151");
    expect(item3?.target).toMatchObject({ field: "state", newValue: "blocked", note: "waiting on Kyle (Sprouts IT)" });
  });

  it("a same-as BRAID item records the state of the entry Atlas matched", () => {
    const same = kemar().items.filter((i) => i.kind === "braid_same");
    expect(same.map((i) => [i.braid?.matchEntryId, i.braid?.seenState])).toEqual([
      ["br-feed-blocker", "reported"],
      ["br-pipeline-risk", "mitigating"],
    ]);
  });

  it("E83: the seen state reaches save, so a blocker resolved meanwhile is a conflict", () => {
    const draft = kemar().items.find((i) => i.braid?.matchEntryId === "br-feed-blocker")!;
    let item = startItem("i7", draft);
    item = applyItemEvent(item, { type: "ACCEPT" }).item;
    const plan = planSave({ state: "saving" }, [item], { "braid_entry:br-feed-blocker:state": "resolved" });
    expect(plan).toMatchObject({ outcome: "conflict", conflicts: [{ itemId: "i7", saw: "reported", current: "resolved" }] });
  });
});

describe("routing by an explicit target (check 14 with M14)", () => {
  const item3: RawProposal = KEMAR_PROPOSALS.find((p) => p.targetId === "wi-151")!;

  it("an issue number pins the project even when Atlas's stated reason does not hold", () => {
    const wrongReason: RawProposal = { ...item3, routingReason: { basis: "tied_person", evidence: "Andre", label: "Andre is on it" } };
    const [only] = runChecks([wrongReason], KEMAR_CONTEXT).items;
    expect(only).toMatchObject({ routing: "routed", projectId: "forager", routingReason: "#151" });
  });

  it("check 10: an update aimed at a record cannot be ambiguous; it is dropped unless filed where the record lives", () => {
    const ambiguous: RawProposal = { ...item3, projectId: null, routingReason: { basis: "ambiguous", evidence: "", label: "" } };
    const result = runChecks([ambiguous], KEMAR_CONTEXT);
    expect(result.items).toEqual([]);
    expect(result.dropped[0]).toMatchObject({ check: 10 });
  });

  it("E71: an ambiguous BRAID item offers the author's candidate projects", () => {
    const ambiguous: RawProposal = {
      kind: "braid_new",
      projectId: null,
      routingReason: { basis: "ambiguous", evidence: "", label: "" },
      options: ["forager", "insights", "sante"],
      braidKind: "issue",
      braidTitle: "Store feed is late",
      quote: "Still waiting on Kyle for the store feed",
      confidence: "high",
      rationale: "Could be Forager's feed or the Store Insights feed",
    };
    const [only] = runChecks([ambiguous], KEMAR_CONTEXT).items;
    expect(only.routing).toBe("choose_project");
    expect(only.options).toEqual(["forager", "insights"]); // Sante Group is not one of Kemar's projects
  });
});

describe("shared helpers", () => {
  it("counts working days, Monday to Friday", () => {
    expect(isWorkingDay("2026-10-24")).toBe(false); // Saturday
    expect(workingDaysBetween("2026-10-20", "2026-10-22")).toBe(2); // Tue to Thu
    expect(workingDaysBetween("2026-10-23", "2026-10-26")).toBe(1); // Fri to Mon
  });

  it("only a PM merges duplicate entries", () => {
    expect(mayMerge("pm")).toBe(true);
    expect(mayMerge("lead")).toBe(false);
    expect(mayMerge("member")).toBe(false);
  });
});
