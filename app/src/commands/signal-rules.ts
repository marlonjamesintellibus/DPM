// Phase K, M29: the signal rules run over one project. evaluate() runs them after every change (so a
// condition that went is CONDITION_GONE at once, SG1, and one that got worse is REFRESHed); a saved update
// and the nightly run also DETECT new trouble. Atlas only raises signals: nothing here changes a record.
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { Tx } from "../db/conn";
import * as t from "../db/schema";
import { applySignalEvent, draftSignal, LIVE_SIGNAL, signalKey, type SignalEvent, type SignalRecord } from "../domain/machines/signal";
import { signalConditions } from "../domain/signals";
import { loadSignalWorld, memoryOf, signalOf, type SignalRow } from "../queries/signals";
import { audit, expectOne, nextVersion, todayOf } from "./core";

export type SignalRun = { raised: string[]; refreshed: string[]; cleared: string[] };

/** Writes a signal's move with its version, and audits it. */
export async function persistSignal(tx: Tx, now: Date, before: SignalRow, record: SignalRecord, outcome: { event: string; from: string; to: string }, by: { actorType: "rule" | "person"; actorId?: string }, detail: Record<string, unknown> = {}): Promise<void> {
  const rows = await tx
    .update(t.signals)
    .set({
      state: record.state,
      stage: record.stage,
      level: record.level,
      facts: record.facts,
      stageOn: record.stageOn,
      decidedBy: record.decidedBy,
      decidedOn: record.decidedOn,
      dismissReason: record.dismissReason,
      riskEntryId: record.riskEntryId,
      version: nextVersion(t.signals.version),
      updatedAt: now,
    })
    .where(and(eq(t.signals.id, before.id), eq(t.signals.version, before.version)))
    .returning({ id: t.signals.id });
  expectOne(rows, `signal ${before.id}`);
  await audit(tx, now, {
    actorType: by.actorType,
    actorId: by.actorId ?? null,
    action: outcome.event,
    machine: "signal",
    subjectType: "signal",
    subjectId: before.id,
    fromState: outcome.from,
    toState: outcome.to,
    detail: { projectId: before.projectId, rule: before.rule, subjectId: before.subjectId, level: record.level, stage: record.stage, ...detail },
  });
}

/** The model's remember: ACCEPT, DISMISS and expiry keep the level and the episode, one memory per subject. */
export async function rememberSignal(tx: Tx, now: Date, record: SignalRecord): Promise<void> {
  if (record.state !== "accepted" && record.state !== "dismissed" && record.state !== "expired") return;
  const memory = {
    episode: record.episode,
    level: record.level,
    answer: record.state,
    by: record.decidedBy,
    on: record.decidedOn ?? todayOf(now),
    reason: record.dismissReason,
    seenGone: false,
    updatedAt: now,
  };
  await tx
    .insert(t.signalMemory)
    .values({ projectId: record.projectId, rule: record.rule, subjectId: record.subjectId, ...memory })
    .onConflictDoUpdate({ target: [t.signalMemory.projectId, t.signalMemory.rule, t.signalMemory.subjectId], set: memory });
}

/**
 * Runs the rules over one project. Every run: a raised signal whose condition went is cleared (SG1), one that
 * got worse is refreshed, and a memory whose condition went is marked so (a new episode next time). With
 * `detect`: each condition with no live signal is DETECTED, raised only when M29's guard lets it (SG3, SG4).
 * Without it, a project with nothing live and nothing remembered is not even read.
 */
export async function runSignalRules(tx: Tx, projectId: string, now: Date, opts: { detect: boolean }): Promise<SignalRun> {
  const run: SignalRun = { raised: [], refreshed: [], cleared: [] };
  const [live, memories] = await Promise.all([
    tx.select().from(t.signals).where(and(eq(t.signals.projectId, projectId), inArray(t.signals.state, [...LIVE_SIGNAL]))),
    tx.select().from(t.signalMemory).where(eq(t.signalMemory.projectId, projectId)),
  ]);
  if (!opts.detect && !live.some((s) => s.state === "raised") && !memories.some((m) => !m.seenGone)) return run;
  const today = todayOf(now);
  const loaded = await loadSignalWorld(tx, projectId, today);
  if (!loaded) return run;
  const held = new Map(signalConditions(loaded.world).map((c) => [signalKey({ projectId, ...c }), c]));

  for (const m of memories) {
    if (m.seenGone || held.has(signalKey(m))) continue;
    await tx
      .update(t.signalMemory)
      .set({ seenGone: true, updatedAt: now })
      .where(and(eq(t.signalMemory.projectId, m.projectId), eq(t.signalMemory.rule, m.rule), eq(t.signalMemory.subjectId, m.subjectId)));
  }

  for (const row of live.filter((s) => s.state === "raised").sort((a, b) => a.id.localeCompare(b.id))) {
    const condition = held.get(signalKey(row));
    const event: SignalEvent | null = !condition ? { type: "CONDITION_GONE" } : condition.level > row.level ? { type: "REFRESH", condition } : null;
    if (!event) continue;
    const r = applySignalEvent(signalOf(row), event, { actor: null, today });
    if (!r.outcome.ok) continue;
    await persistSignal(tx, now, row, r.record, r.outcome, { actorType: "rule" });
    (event.type === "CONDITION_GONE" ? run.cleared : run.refreshed).push(row.id);
  }

  if (!opts.detect) return run;
  const liveKeys = new Set(live.map(signalKey));
  const memoryByKey = new Map(memories.map((m) => [signalKey(m), memoryOf(m)]));
  for (const [key, condition] of [...held].sort(([a], [b]) => a.localeCompare(b))) {
    if (liveKeys.has(key)) continue; // One live signal per (project, rule, subject)
    const memory = memoryByKey.get(key) ?? null;
    const away = condition.facts.rule === "stale_work" && loaded.away.has(condition.facts.ownerId);
    const draft = draftSignal(`sig-${randomUUID().slice(0, 8)}`, projectId, condition, today);
    const r = applySignalEvent(draft, { type: "DETECTED", condition, memory, away }, { actor: null, today });
    if (!r.outcome.ok) continue;
    const { id, ...fields } = r.record;
    // One live signal per (project, rule, subject), kept by the index too: a run at the same moment (the
    // nightly one and a save) that raised it first wins, and this one raises nothing rather than fail the save
    const inserted = await tx.insert(t.signals).values({ id, ...fields, createdAt: now, updatedAt: now }).onConflictDoNothing().returning({ id: t.signals.id });
    if (!inserted.length) continue;
    await audit(tx, now, {
      actorType: "rule",
      action: "DETECTED",
      machine: "signal",
      subjectType: "signal",
      subjectId: id,
      fromState: "none",
      toState: "raised",
      detail: { projectId, rule: condition.rule, subjectId: condition.subjectId, level: condition.level, episode: condition.episode, stage: r.record.stage },
    });
    run.raised.push(id);
  }
  return run;
}
