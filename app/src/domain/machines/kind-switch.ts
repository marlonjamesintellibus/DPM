// Changing a BRAID entry's kind on the log (machines doc, section 13). Port of
// research/state-machines/js/models/braidKindSwitch.mjs (model checked 27 Oct).
// A PM or Lead switches: the old entry ends (realised, broken, late or switched, by switchEnd) and a
// new entry of the new kind takes its reports, owner and related links, so the log shows one row.
// Switching back to the kind it came from reopens the original instead, with every report.
import type { BraidKind } from "../rights";
import { applyBraidEvent, draftEntry, refused, switchedTo, type BraidCtx, type BraidEntryState, type BraidLog } from "./braid-entry";
import type { Outcome } from "../machine";

export type SwitchResult = { outcome: Outcome<BraidEntryState>; log: BraidLog; targetId: string | null };

/** Related links follow the entry to where it lives now, both ways; conflicts and supersedes stay (they only mean something between decisions). */
function moveRelated(log: BraidLog, fromId: string, toId: string): BraidLog {
  const isRelatedTo = (id: string) => (l: { relation: string; entryId: string }) => l.relation === "related" && l.entryId === id;
  const dedupe = <L extends { relation: string; entryId: string }>(links: L[]) => links.filter((x, i) => links.findIndex((y) => y.relation === x.relation && y.entryId === x.entryId) === i);
  const next = { ...log };
  const own = next[fromId].links.filter((l) => l.relation === "related" && l.entryId !== toId);
  next[fromId] = { ...next[fromId], links: next[fromId].links.filter((l) => l.relation !== "related") };
  next[toId] = { ...next[toId], links: dedupe([...next[toId].links, ...own]) };
  for (const other of Object.values(next)) {
    if (other.id === fromId || other.id === toId || !other.links.some(isRelatedTo(fromId))) continue;
    next[other.id] = { ...other, links: dedupe(other.links.map((x) => (isRelatedTo(fromId)(x) ? { ...x, entryId: toId } : x))) };
  }
  return next;
}

/**
 * SWITCH_KIND on one entry, with the entry it becomes. newId names the new entry when one is made;
 * switching back reuses the original. A refused switch returns the log unchanged.
 */
export function switchKind(log: BraidLog, entryId: string, to: BraidKind, why: string, ctx: BraidCtx, newId: string): SwitchResult {
  const entry = log[entryId];
  if (!entry) return { outcome: refused("SWITCH_KIND", "missing", `no entry ${entryId} on this log`), log, targetId: null };
  const r = applyBraidEvent(entry, { type: "SWITCH_KIND", to, why }, ctx);
  if (!r.outcome.ok) return { outcome: r.outcome, log, targetId: null };

  const originId = entry.links.find((l) => l.relation === "switched_from")?.entryId;
  const origin = originId ? log[originId] : undefined;
  if (origin && origin.kind === to && switchedTo(origin) === entryId) {
    const o = applyBraidEvent(origin, { type: "RESTORE", from: entry }, ctx);
    if (!o.outcome.ok) return { outcome: o.outcome, log, targetId: null };
    const old = { ...r.record, links: [...r.record.links, { relation: "switched_to" as const, entryId: origin.id }] };
    return { outcome: r.outcome, log: moveRelated({ ...log, [entryId]: old, [origin.id]: o.record }, entryId, origin.id), targetId: origin.id };
  }

  if (log[newId]) return { outcome: refused("SWITCH_KIND", entry.state, `entry ${newId} exists already`), log, targetId: null };
  const draft = { ...draftEntry({ id: newId, projectId: entry.projectId, kind: to, title: entry.title }), links: [{ relation: "switched_from" as const, entryId }] };
  const n = applyBraidEvent(draft, { type: "SWITCH_IN", from: entry }, ctx);
  if (!n.outcome.ok) return { outcome: n.outcome, log, targetId: null };
  const old = { ...r.record, links: [...r.record.links, { relation: "switched_to" as const, entryId: newId }] };
  return { outcome: r.outcome, log: moveRelated({ ...log, [entryId]: old, [newId]: n.record }, entryId, newId), targetId: newId };
}

/** The entry an entry lives on now, following switched_to to the end of the chain. */
export function liveEntryOf(log: BraidLog, entryId: string): string {
  let id = entryId;
  for (let i = 0; i < 20; i++) {
    const next = log[id] ? switchedTo(log[id]) : null;
    if (!next) return id;
    id = next;
  }
  return id;
}
