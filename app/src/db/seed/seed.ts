// Loads the 20 Oct snapshot. Anything a rule decides is decided by the domain code, not written
// by hand: Alicia's set status goes through the set status machine, her inbox item through
// evaluateCause, and Kemar's 11 items through the server checks and the extracted item machine.
import { runChecks } from "../../domain/atlas-checks/checks";
import { KEMAR_CONTEXT, KEMAR_NOTE, KEMAR_PROPOSALS } from "../../domain/atlas-checks/kemar-note.fixture";
import { captureDedupKey } from "../../domain/machines/capture";
import { startItem, type ExtractedItem } from "../../domain/machines/extracted-item";
import { evaluateCause } from "../../domain/machines/inbox-item";
import { applySetStatus, NO_SET_STATUS, setStatusCause } from "../../domain/machines/set-status";
import { calculatePlan } from "../../domain/status/rules";
import type { Db } from "../client";
import * as t from "../schema";
import {
  ALICIA_SETS,
  BRAID,
  BRAID_LINKS,
  CONTACTS,
  GROUPS,
  HANDOVER,
  KEMAR_CAPTURE,
  LEAVE,
  MEMBERSHIPS,
  MILESTONES,
  ORG,
  PEOPLE,
  PROJECTS,
  SNAPSHOT,
  THREADS,
  WORK_ITEMS,
} from "./snapshot";

export type SeedSummary = { projects: number; extractions: number; inboxItems: number; foragerCalculated: string | null };

export type SeedOptions = {
  /** Kemar's 8:58am note, read by Atlas and waiting for his review (story steps 1 and 2). */
  kemarNote?: boolean;
  /** Alicia's 9:02am Off track with no reason, and the inbox item it raises (story step 3). */
  aliciaSetsStatus?: boolean;
};

/** The snapshot at 9:10am. Turn the options off for the world only, so a test can run those steps through the commands. */
export async function seedSnapshot(db: Db, options: SeedOptions = {}): Promise<SeedSummary> {
  const { kemarNote = true, aliciaSetsStatus = true } = options;
  // Rules first, outside the transaction: they are pure
  const foragerPlan = calculatePlan(
    {
      threads: THREADS.filter((th) => th.projectId === "forager"),
      milestones: MILESTONES.filter((m) => m.projectId === "forager"),
      workItems: WORK_ITEMS.filter((w) => w.projectId === "forager"),
    },
    SNAPSHOT.today,
  );
  const setStatus = applySetStatus(NO_SET_STATUS, foragerPlan.project, { type: "OWNER_SETS", status: ALICIA_SETS.status });
  const moved = setStatus.outcome;
  if (!moved.ok) throw new Error(`seed: Alicia's set status was refused: ${moved.reason}`);
  const cause = setStatusCause(setStatus.record);
  if (!cause) throw new Error("seed: a set status that differs from the plan must raise a cause");
  const causeKey = `${cause}:${ALICIA_SETS.projectId}`;
  const inboxPlan = evaluateCause(causeKey, [], true);
  if (!inboxPlan.create) throw new Error("seed: expected an inbox item for Alicia");

  const checked = runChecks(KEMAR_PROPOSALS, KEMAR_CONTEXT);
  if (checked.dropped.length) throw new Error(`seed: checks dropped ${checked.dropped.length} of Kemar's proposals`);
  const items: ExtractedItem[] = checked.items.map((draft) => startItem(`${KEMAR_CAPTURE.id}-${draft.ordinal}`, draft));

  await db.transaction(async (tx) => {
    await tx.insert(t.orgs).values(ORG);
    await tx.insert(t.people).values(PEOPLE);
    await tx.insert(t.groups).values(GROUPS.map(({ members: _members, ...g }) => ({ ...g, orgId: ORG.id })));
    await tx.insert(t.groupMembers).values(GROUPS.flatMap((g) => g.members.map((personId) => ({ groupId: g.id, personId }))));

    await tx.insert(t.projects).values(
      PROJECTS.map((p) =>
        aliciaSetsStatus && p.id === ALICIA_SETS.projectId
          ? {
              ...p,
              setOverride: setStatus.record.override,
              setStatus: setStatus.record.setStatus,
              setBy: ALICIA_SETS.by,
              setAt: new Date(ALICIA_SETS.at),
            }
          : p,
      ),
    );
    await tx.insert(t.projectMemberships).values(MEMBERSHIPS.map((m) => ({ ...m, state: "member" as const })));
    await tx.insert(t.projectContacts).values(CONTACTS);
    await tx.insert(t.threads).values(THREADS);
    await tx.insert(t.milestones).values(MILESTONES);
    await tx.insert(t.workItems).values(WORK_ITEMS);
    const { steps, ...handover } = HANDOVER;
    await tx.insert(t.handovers).values(handover);
    await tx.insert(t.handoverSteps).values(steps.map((s, i) => ({ ...s, handoverId: HANDOVER.id, position: i + 1 })));
    await tx.insert(t.leave).values(LEAVE);

    const { messageId, ...kemarCapture } = KEMAR_CAPTURE;
    const capture = {
      ...kemarCapture,
      text: KEMAR_NOTE,
      messageAt: new Date(KEMAR_CAPTURE.messageAt),
      receivedAt: new Date(KEMAR_CAPTURE.receivedAt),
      dedupKey: captureDedupKey({ channel: KEMAR_CAPTURE.channel, author: KEMAR_CAPTURE.authorId, text: KEMAR_NOTE, sentAt: new Date(KEMAR_CAPTURE.messageAt), messageId }),
      // Atlas has read it and proposed; Kemar has not opened the review yet (story step 2)
      state: "proposed" as const,
      tries: 1,
      proposals: items.length,
    };
    // Section 16: an Atlas app message goes into its author's Atlas conversation
    if (kemarNote) {
      await tx.insert(t.conversations).values({ id: "conv-atlas-kemar", ownerId: "kemar", state: "active", title: "Atlas", channel: "atlas", atlasChatId: "dm", lastMessageAt: capture.messageAt });
      await tx.insert(t.captures).values({ ...capture, conversationId: "conv-atlas-kemar" });
    }

    await tx.insert(t.braidEntries).values(
      BRAID.map(({ sources: _sources, ...e }) => ({
        ...e,
        proposedOn: null,
        decidedOn: "decidedOn" in e ? e.decidedOn : null,
        resolvedOn: "resolvedOn" in e ? e.resolvedOn : null,
      })),
    );
    await tx.insert(t.braidSources).values(
      BRAID.flatMap((e) => e.sources.map((s) => ({ ...s, entryId: e.id, originEntryId: e.id, at: new Date(s.at) }))),
    );
    await tx.insert(t.braidLinks).values(BRAID_LINKS);

    if (kemarNote) await tx.insert(t.extractions).values(
      items.map((item) => ({
        id: item.id,
        captureId: capture.id,
        ordinal: item.draft.ordinal,
        kind: item.draft.kind,
        scope: item.draft.scope,
        projectId: item.draft.projectId,
        routing: item.draft.routing,
        draft: item.draft,
        state: item.state,
        confidence: item.confidence,
        value: item.value,
        saw: item.saw,
        conflict: item.conflict,
        withdrawn: item.withdrawn,
        touched: item.touched,
      })),
    );

    if (aliciaSetsStatus) await tx.insert(t.inboxItems).values({
      id: `inbox-alicia-${causeKey}-${inboxPlan.create!.episode}`,
      ownerId: ALICIA_SETS.by,
      causeKey,
      episode: inboxPlan.create!.episode,
      state: "open",
      createdAt: new Date(ALICIA_SETS.at),
    });

    const captureAudit: (typeof t.auditEntries.$inferInsert)[] = [
      { at: capture.receivedAt, actorType: "system", action: "RECEIVED", machine: "capture", subjectType: "capture", subjectId: capture.id, toState: "received", captureId: capture.id, detail: { channel: capture.channel } },
      { at: new Date("2026-10-20T13:59:00Z"), actorType: "atlas", action: "PROPOSALS_READY", machine: "capture", subjectType: "capture", subjectId: capture.id, fromState: "reading", toState: "proposed", captureId: capture.id, detail: { items: items.length } },
    ];
    const statusAudit: (typeof t.auditEntries.$inferInsert)[] = [
      { at: new Date(ALICIA_SETS.at), actorType: "person", actorId: ALICIA_SETS.by, action: "OWNER_SETS", machine: "set_status", subjectType: "project", subjectId: ALICIA_SETS.projectId, fromState: moved.from, toState: moved.to, detail: { status: ALICIA_SETS.status, calculated: foragerPlan.project } },
      { at: new Date(ALICIA_SETS.at), actorType: "rule", action: "INBOX_ITEM_CREATED", machine: "inbox_item", subjectType: "inbox_item", subjectId: causeKey, toState: "open", detail: { owner: ALICIA_SETS.by, episode: inboxPlan.create!.episode } },
    ];
    const auditRows = [...(kemarNote ? captureAudit : []), ...(aliciaSetsStatus ? statusAudit : [])];
    if (auditRows.length) await tx.insert(t.auditEntries).values(auditRows);

    await tx.insert(t.appMeta).values({ key: "seed", value: `snapshot ${SNAPSHOT.today}` });
  });

  return { projects: PROJECTS.length, extractions: kemarNote ? items.length : 0, inboxItems: aliciaSetsStatus ? 1 : 0, foragerCalculated: foragerPlan.project };
}
