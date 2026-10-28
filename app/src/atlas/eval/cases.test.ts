// The evaluation cases name only records and entries their author can actually reach (D22).
import { describe, expect, it } from "vitest";
import { seededDb } from "../../test/seeded-db";
import { ruleQuestion } from "../../domain/question";
import { EVAL_CASES } from "./cases";
import { caseContext, evalContexts } from "./contexts";
import { scoreCase } from "./score";
import { DRAFT_EVAL_CASES, draftCaseFacts, scoreDraft } from "./drafts";
import { draftTemplate } from "../../domain/drafts";

describe("evaluation cases", () => {
  it("every id an expected item names is in its author's candidate data", async () => {
    const contexts = await evalContexts(await seededDb({ kemarNote: false, aliciaSetsStatus: false }));
    for (const c of EVAL_CASES) {
      const ctx = caseContext(c, contexts);
      const records = new Set(ctx.projects.flatMap((p) => p.records.map((r) => r.id)).concat(ctx.leave.targetId));
      const entries = new Set(ctx.projects.flatMap((p) => p.braid.map((e) => e.id)));
      const projects = new Set(ctx.projects.map((p) => p.id).concat("none"));
      for (const key of c.expect.flat()) {
        const [type, rest] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
        if (type === "upd" || type === "ask") expect(records, `${c.id}: ${key}`).toContain(rest.slice(0, rest.indexOf(".")));
        if (type === "track") expect(projects, `${c.id}: ${key}`).toContain(rest);
        if (type === "same" || type === "resolve" || type === "supersede") expect(entries, `${c.id}: ${key}`).toContain(rest);
        if (type === "outcome") expect(entries, `${c.id}: ${key}`).toContain(rest.split("=")[0]);
        if (type === "new") expect(projects, `${c.id}: ${key}`).toContain(rest.split(":")[1].split("@")[0]);
      }
    }
  });

  it("phase C: every subject a why case names is in its author's lists, and the rule (no model) reads each one as it should", async () => {
    const contexts = await evalContexts(await seededDb({ kemarNote: false, aliciaSetsStatus: false }));
    const why = EVAL_CASES.filter((c) => c.ask?.topic === "why");
    expect(why.length).toBeGreaterThanOrEqual(8);
    for (const c of why) {
      const ctx = caseContext(c, contexts);
      const ids = new Set([...ctx.projects.map((p) => p.id), ...ctx.projects.flatMap((p) => [...p.records.map((r) => r.id), ...p.braid.map((e) => e.id)])]);
      for (const s of [c.ask!.subject ?? null].flat()) if (s) expect(ids, `${c.id}: ${s}`).toContain(s);
      const asked = ruleQuestion(ctx);
      const score = scoreCase(c, [], ctx, asked && { ...asked, subjectId: asked.subject?.id ?? null });
      expect(score.missing, c.id).toEqual([]);
    }
  });

  it("phase J: a standup case is quoted only from its answers, as the app reads one, and 'Start my standup' is the rule's", async () => {
    const contexts = await evalContexts(await seededDb({ kemarNote: false, aliciaSetsStatus: false }));
    const notThat = EVAL_CASES.find((c) => c.id === "j-not-that")!;
    const ctx = caseContext(notThat, contexts);
    expect(ctx.standup?.quoteIn.map((sp) => notThat.text.slice(sp.start, sp.end))).toEqual(["Not that one, but #152 is done"]);
    const said = (quote: string, targetId: string) => ({ kind: "update" as const, projectId: "forager", routingReason: { basis: "target" as const, evidence: quote, label: quote }, targetId, field: "state", newValue: "done", quote, confidence: "high" as const, rationale: "" });
    expect(scoreCase(notThat, [said("#152 is done", "wi-152")], ctx, null).pass).toBe(true);
    // The model check's questionAsQuote: DPM's question is never the quote, so its #145 never passes
    expect(scoreCase(notThat, [said("#152 is done", "wi-152"), said("#145 Google Trends connector", "wi-145")], ctx, null).forbidden).toEqual([]);
    const start = EVAL_CASES.find((c) => c.id === "j-start")!;
    const startCtx = caseContext(start, contexts);
    expect(scoreCase(start, [], startCtx, ruleQuestion(startCtx)).pass).toBe(true);
  });

  it("phase H: the rule (no model) reads each people case as it should, PP4 included", async () => {
    const contexts = await evalContexts(await seededDb({ kemarNote: false, aliciaSetsStatus: false }));
    const people = EVAL_CASES.filter((c) => c.id.startsWith("h-"));
    expect(people.length).toBeGreaterThanOrEqual(9);
    for (const c of people) {
      const ctx = caseContext(c, contexts);
      const score = scoreCase(c, [], ctx, ruleQuestion(ctx));
      expect([score.missing, score.forbidden], c.id).toEqual([[], []]);
    }
  });

  it("phase N: the rule (no model) reads each lead question as it should, LD10's follow-up included", async () => {
    const contexts = await evalContexts(await seededDb({ kemarNote: false, aliciaSetsStatus: false }));
    const leads = EVAL_CASES.filter((c) => c.id.startsWith("n-"));
    expect(leads.length).toBeGreaterThanOrEqual(9);
    for (const c of leads) {
      const ctx = caseContext(c, contexts);
      const score = scoreCase(c, [], ctx, ruleQuestion(ctx));
      expect([score.missing, score.forbidden], c.id).toEqual([[], []]);
    }
  });

  it("phase G: the rule (no model) reads each draft request, and each drafting case's plain template passes its own scoring", async () => {
    const db = await seededDb({ kemarNote: false, aliciaSetsStatus: false });
    const contexts = await evalContexts(db);
    for (const c of EVAL_CASES.filter((x) => x.id.startsWith("g-draft-"))) {
      const ctx = caseContext(c, contexts);
      expect(scoreCase(c, [], ctx, ruleQuestion(ctx)).missing, c.id).toEqual([]);
    }
    expect(DRAFT_EVAL_CASES.length).toBeGreaterThanOrEqual(4);
    for (const c of DRAFT_EVAL_CASES) {
      const { facts, known } = await draftCaseFacts(db, c);
      expect(scoreDraft(c, facts, known, draftTemplate(facts)), c.id).toEqual({ pass: true, problem: null, forbidden: [] });
      // A made-up date fails, as the machine would refuse it (DR2)
      expect(scoreDraft(c, facts, known, `${draftTemplate(facts)}\nNext update on Monday 9 Nov.`).pass, c.id).toBe(false);
    }
  });

  it("Andre's data has nothing of Forager's, and Alicia's has her two projects", async () => {
    const contexts = await evalContexts(await seededDb({ kemarNote: false, aliciaSetsStatus: false }));
    expect(contexts.andre.projects.map((p) => p.id)).toEqual(["insights"]);
    expect(contexts.alicia.projects.map((p) => p.id).sort()).toEqual(["forager", "gq"]);
  });
});
