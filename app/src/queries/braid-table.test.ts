// Section 13 as the screens read it: the BRAID table rows (L14c), the summary tiles (L14d) and the
// inbox items for kind changes, each read as the viewer.
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import { askKindChange, switchEntryKind } from "../commands/braid";
import { at, seededDb } from "../test/seeded-db";
import { getInbox } from "./inbox";
import { getProject, type ProjectView } from "./project";

let db: Db;
const as = (actorId: string, minutes = 0) => ({ db, now: at(minutes), actorId });
async function view(who: string): Promise<ProjectView> {
  const v = await getProject(db, who, "forager", at(5));
  if (!v.found) throw new Error("not found");
  return v;
}
const row = (v: ProjectView, title: string) => v.braid.entries.find((e) => e.title === title)!;
const tile = (v: ProjectView, kind: string) => v.braid.summary.find((s) => s.kind === kind)!;

beforeEach(async () => {
  db = await seededDb({ kemarNote: false, aliciaSetsStatus: false });
}, 30_000);

describe("the BRAID table", () => {
  it("a PM may switch every live entry; a finished one keeps its kind", async () => {
    const v = await view("alicia");
    expect(row(v, "Only Kemar can run the pipeline").kindControl).toBe("switch");
    expect(row(v, "Google Trends rate limit").kindControl).toBe("fixed");
    expect(row(v, "Only Kemar can run the pipeline").version).toBeGreaterThan(0);
  });

  it("a member asks instead, and sees who asked once someone has", async () => {
    expect(row(await view("kemar"), "Store sales feed access from Sprouts IT").kindControl).toBe("ask");
    await askKindChange(as("kemar"), "br-feed-dependency", "blocker", "Kyle has no date yet");
    const kemar = row(await view("kemar"), "Store sales feed access from Sprouts IT");
    expect(kemar).toMatchObject({ kindControl: "asked", request: { toKind: "blocker", why: "Kyle has no date yet", mine: true, askedBy: { name: "Kemar Brown" } } });
    expect(row(await view("jodian"), "Store sales feed access from Sprouts IT").request?.mine).toBe(false);
    const alicia = await view("alicia");
    expect(row(alicia, "Store sales feed access from Sprouts IT")).toMatchObject({ kindControl: "switch", request: { mine: false } });
    expect(alicia.braid.kindChangesAsked).toBe(1);
  });

  it("a switched entry shows once, as what it became, with the note and the kind it was", async () => {
    await switchEntryKind(as("alicia"), "br-pipeline-risk", "issue", "Kemar is away and nobody else ran it");
    const v = await view("alicia");
    expect(v.braid.entries.filter((e) => e.title === "Only Kemar can run the pipeline")).toHaveLength(1);
    expect(row(v, "Only Kemar can run the pipeline")).toMatchObject({
      kind: "issue",
      stateLabel: "Reported",
      was: "risk",
      switchNote: { by: { name: "Alicia Campbell" }, from: "risk", to: "issue", why: "Kemar is away and nobody else ran it", askedBy: null },
    });
    expect(v.braid.switchedThisWeek).toBe(1);
  });

  it("an approved decision says how it changes instead", async () => {
    await db.update(t.braidEntries).set({ kind: "decision", state: "approved" }).where(eq(t.braidEntries.id, "br-buyers-assumption"));
    expect(row(await view("alicia"), "Buyers available for the pilot week of 26 Oct")).toMatchObject({ kindControl: "fixed", fixedNote: "To change it, add a new decision that replaces this one" });
  });
});

describe("the BRAID summary (L14d)", () => {
  it("six tiles in pairs, each with its live count and the entry that needs someone first", async () => {
    await askKindChange(as("kemar"), "br-feed-dependency", "blocker", "no date");
    await switchEntryKind(as("alicia", 1), "br-pipeline-risk", "issue", "it happened");
    const v = await view("jodian"); // any member reads the summary
    expect(v.braid.summary.map((s) => s.label)).toEqual(["Blockers", "Risks", "Issues", "Assumptions", "Dependencies", "Decisions"]);
    expect(tile(v, "blocker")).toMatchObject({ live: 1, entry: { title: "Store sales feed access", stateLabel: "Reported" }, note: "Since 14 Oct" });
    expect(tile(v, "risk")).toMatchObject({ live: 0, entry: null, note: "1 became an issue this week" });
    expect(tile(v, "issue")).toMatchObject({ live: 1, entry: { title: "Only Kemar can run the pipeline" }, note: "Was a risk · switched 20 Oct" });
    expect(tile(v, "dependency")).toMatchObject({ entry: { stateLabel: "Kind change asked", waiting: true }, note: "Kemar asked to make it a blocker" });
    expect(tile(v, "decision")).toMatchObject({ live: 0, note: "None on the log" });
  });

  it("a kind that lost an entry this week says so", async () => {
    await db.update(t.braidEntries).set({ kind: "risk", state: "open" }).where(eq(t.braidEntries.id, "br-buyers-assumption"));
    await switchEntryKind(as("alicia"), "br-pipeline-risk", "issue", "it happened");
    expect(tile(await view("alicia"), "risk").note).toBe("1 became an issue this week");
  });
});

describe("the inbox", () => {
  it("Alicia is asked to decide Kemar's request", async () => {
    await askKindChange(as("kemar"), "br-feed-dependency", "blocker", "Kyle has no date yet");
    const item = (await getInbox(db, "alicia", at(5))).items.find((i) => i.cause === "kind_change")!;
    expect(item).toMatchObject({
      title: "Kemar asked to make this a blocker: Store sales feed access from Sprouts IT",
      why: '"Kyle has no date yet" Only a PM or Lead changes an entry\'s kind',
      action: "Decide",
      subject: { type: "kind_request", entryId: "br-feed-dependency", projectId: "forager" },
    });
  });

  it("D32 Kemar is asked about #151 when its blocker becomes an issue", async () => {
    await db.update(t.workItems).set({ state: "blocked", blockedLinks: ["br-feed-blocker"] }).where(eq(t.workItems.id, "wi-151"));
    await switchEntryKind(as("alicia"), "br-feed-blocker", "issue", "it no longer stops work");
    const item = (await getInbox(db, "kemar", at(5))).items.find((i) => i.cause === "blocked_without_blocker")!;
    expect(item).toMatchObject({ title: "#151 is still Blocked, but its blocker is now an issue", subject: { type: "work_item", id: "wi-151" } });
  });
});
