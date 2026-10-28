// Phase E: Save on a promise (M4 with M22), pure. The model's recordAtSave: the linked work item and the
// matched commitment are read again when Save runs. A promise about Done work is No change; about cancelled work
// it opens with CM11's question asked; the same promise moves a live commitment (CM5), and one gone since opens a
// new one; "done" ends a live one (CM6), and one dropped or lapsed since is a conflict. Also the typed check-in
// replies DPM reads with no model.
import { describe, expect, it } from "vitest";
import { commitmentKeys, planSave, settleItems } from "./capture-save";
import { readCheckInReply } from "./machines/commitment";
import { startItem } from "./machines/extracted-item";
import type { CommitmentDraft, ExtractedItemDraft } from "./shared";
import { readPromiseDate } from "./atlas-checks/resolve-dates";

const LINK = { type: "work_item" as const, id: "wi-151", projectId: "forager", label: "#151 Store sales feed access" };
function promise(c: Partial<CommitmentDraft> = {}): ExtractedItemDraft {
  return {
    ordinal: 1,
    kind: "commitment",
    scope: "personal",
    projectId: null,
    routing: "routed",
    routingReason: "Only you see your promises",
    spans: [{ start: 0, end: 10 }],
    confidence: "high",
    mark: "pre_accepted",
    rationale: "",
    commitment: { act: "promise", what: "Send Kyle the access request", dueOn: "2026-10-21", dueFrom: "said", dueWords: "tomorrow", link: LINK, commitmentId: null, seenDue: null, ...c },
  };
}
const SAVING = { state: "saving" as const };
const plan = (draft: ExtractedItemDraft, current: Record<string, string | null>) => planSave(SAVING, [startItem("i1", draft)], current);

describe("Save on a promise (M22 SAVE)", () => {
  it("reads the linked work and any matched commitment as current values", () => {
    expect(commitmentKeys(startItem("i1", promise({ commitmentId: "cm-1" })))).toEqual(["work_item:wi-151:state", "commitment:cm-1:state", "commitment:cm-1:due"]);
    expect(commitmentKeys(startItem("i1", promise({ link: null })))).toEqual([]);
  });

  it("opens a commitment, writing nothing to any project", () => {
    const p = plan(promise(), { "work_item:wi-151:state": "in_progress" });
    expect(p).toMatchObject({ outcome: "apply", writes: [], braid: [], asks: [], commitments: [{ itemId: "i1", act: "promise", what: "Send Kyle the access request", dueOn: "2026-10-21", link: LINK, matchId: null, standsAsked: false }] });
    expect(settleItems([startItem("i1", promise())], p)[0].state).toBe("applied");
  });

  it("recordAtSave: Done work since is No change; cancelled saves with CM11's question asked", () => {
    const done = plan(promise(), { "work_item:wi-151:state": "done" });
    expect(done).toMatchObject({ outcome: "apply", commitments: [], noChange: ["i1"] });
    expect(settleItems([startItem("i1", promise())], done)[0].state).toBe("no_change");
    expect(plan(promise(), { "work_item:wi-151:state": "cancelled" })).toMatchObject({ commitments: [{ standsAsked: true }] });
  });

  it("CM5: the same promise moves a live commitment; one ended since opens a new one; the same day is No change", () => {
    const keys = (state: string, due = "2026-10-21") => ({ "work_item:wi-151:state": "in_progress", "commitment:cm-1:state": state, "commitment:cm-1:due": due });
    expect(plan(promise({ commitmentId: "cm-1", dueOn: "2026-10-23" }), keys("checking", "2026-10-19"))).toMatchObject({ commitments: [{ matchId: "cm-1", dueOn: "2026-10-23" }] });
    expect(plan(promise({ commitmentId: "cm-1", dueOn: "2026-10-23" }), keys("dropped"))).toMatchObject({ commitments: [{ matchId: null }] });
    expect(plan(promise({ commitmentId: "cm-1" }), keys("open"))).toMatchObject({ noChange: ["i1"], commitments: [] });
  });

  it("CM6: done ends a live commitment; already done is No change; dropped or lapsed since is a conflict", () => {
    const done = (state: string | null) => plan(promise({ act: "done", dueOn: null, commitmentId: "cm-1", link: null }), { "commitment:cm-1:state": state, "commitment:cm-1:due": "2026-10-21" });
    expect(done("due")).toMatchObject({ outcome: "apply", commitments: [{ act: "done", commitmentId: "cm-1" }] });
    expect(done("done")).toMatchObject({ outcome: "apply", noChange: ["i1"] });
    expect(done("lapsed")).toMatchObject({ outcome: "conflict", conflicts: [{ itemId: "i1", key: "commitment:cm-1:state", current: "lapsed" }] });
    expect(done(null)).toMatchObject({ outcome: "conflict" });
  });
});

describe("a typed answer to a check-in (read by DPM's rule, no model)", () => {
  const at = new Date("2026-10-22T14:00:00Z"); // Thursday
  const reply = (text: string) => readCheckInReply(text, (words) => readPromiseDate(words, at));
  it.each([
    ["Done", { act: "done" }],
    ["yes, sent it", { act: "done" }],
    ["Yep", { act: "done" }],
    ["mi done", { act: "done" }],
    ["Drop it.", { act: "drop" }],
    ["no longer needed", { act: "drop" }],
    ["Keep it", { act: "keep" }],
    ["it still stands", { act: "keep" }],
    ["Friday", { act: "date", dueOn: "2026-10-23" }],
    ["Move it to Monday", { act: "date", dueOn: "2026-10-26" }],
    ["not yet, next week", { act: "date", dueOn: "2026-10-30" }],
  ])("%s", (text, answer) => {
    expect(reply(text)).toEqual(answer);
  });

  it.each(["Sent Kyle the access request this morning and he has it", "Did I send it?", "send it to Kyle Friday", "the sales feed access one", "Undo that", "What did I promise?"])("%s is not an answer", (text) => {
    expect(reply(text)).toBeNull();
  });
});
