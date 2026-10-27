"use client";
// The controls on an inbox item's detail (L6, L6b, L6c). Each one is a Server Action that runs the
// command as the viewer; the command checks the right, so a button shown here can still be refused.
import { useState, useTransition } from "react";
import {
  acknowledgeEntry,
  addEntry,
  approveEntry,
  askForMore,
  atlasReason,
  confirmDraft,
  declineEntry,
  decideLeave,
  dropDraft,
  endEntry,
  giveReason,
  keepEntryOpen,
  keepStatus,
  linkWorkChange,
  newExpectedDate,
  resolveEntry,
  showCalculatedStatus,
  type ActionResult,
} from "@/app/actions";
import { Icon } from "@/components/shell/icon";
import { ActionNote, Button, LinkChip } from "@/components/ui/controls";
import type { ResolveOutcome } from "@/domain/machines/braid-entry";
import type { BraidKind } from "@/domain/rights";

function useRun() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const run = (fn: () => Promise<ActionResult>) => start(async () => setResult(await fn()));
  return { pending, result, run };
}

/**
 * Approve with an optional note to the reporter, decline with a reason, or ask for more (M15, L6b,
 * L6c). The note box is the decline reason or the question when one of those is chosen.
 */
export function DecideControls({ entryId, reporter, related }: { entryId: string; reporter: string; related: string[] }) {
  const { pending, result, run } = useRun();
  const [mode, setMode] = useState<"approve" | "decline" | "ask">("approve");
  const [text, setText] = useState("");
  const label = mode === "approve" ? `Note to ${reporter} (optional)` : mode === "decline" ? `Why you decline, for ${reporter}` : `What you need to know from ${reporter}`;
  const submit = () =>
    run(() => (mode === "approve" ? approveEntry(entryId, text) : mode === "decline" ? declineEntry(entryId, text) : askForMore(entryId, text)));
  return (
    <div className="flex flex-col gap-3.5">
      <label className="flex flex-col gap-1.5">
        <span className="type-label text-fg-2">{label}</span>
        <textarea
          value={text}
          rows={2}
          onChange={(e) => setText(e.target.value)}
          className="w-full resize-none rounded-control border border-line-strong bg-panel p-3 type-body text-fg-1"
        />
      </label>
      {related.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="type-caption text-fg-3">Related</span>
          {related.map((r) => (
            <LinkChip key={r}>{r}</LinkChip>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Button disabled={pending || (mode !== "approve" && !text.trim())} onClick={mode === "approve" ? submit : () => setMode("approve")}>
          Approve
        </Button>
        <Button variant="secondary" disabled={pending || (mode === "decline" && !text.trim())} onClick={mode === "decline" ? submit : () => setMode("decline")}>
          Decline
        </Button>
        <Button variant="secondary" disabled={pending || (mode === "ask" && !text.trim())} onClick={mode === "ask" ? submit : () => setMode("ask")}>
          Ask for more
        </Button>
      </div>
      {mode !== "approve" && <p className="type-caption text-fg-3">Write it above, then press {mode === "decline" ? "Decline" : "Ask for more"} again to send.</p>}
      <ActionNote result={result} />
    </div>
  );
}

/** "It's cleared" (S13) and the rule's "is it resolved?" (E93): resolve, or say it is still blocking. */
export function ClearControls({ entryId, canKeepOpen }: { entryId: string; canKeepOpen: boolean }) {
  const { pending, result, run } = useRun();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Button disabled={pending} onClick={() => run(() => resolveEntry(entryId))}>
          Resolve
        </Button>
        {canKeepOpen && (
          <Button variant="secondary" disabled={pending} onClick={() => run(() => keepEntryOpen(entryId))}>
            Still blocked
          </Button>
        )}
      </div>
      <ActionNote result={result} />
    </div>
  );
}

/** Section 20, U2: a due dependency is met, late, or expected on a new date. Nothing ends it but these. */
export function DependencyDueControls({ entryId }: { entryId: string }) {
  const { pending, result, run } = useRun();
  const [date, setDate] = useState("");
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={pending} onClick={() => run(() => endEntry(entryId, "met"))}>
          Met
        </Button>
        <Button variant="secondary" disabled={pending} onClick={() => run(() => endEntry(entryId, "late"))}>
          Late
        </Button>
        <input
          aria-label="New expected date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-control border border-line-strong bg-panel px-2 py-1 type-body"
        />
        <Button variant="secondary" disabled={pending || !date} onClick={() => run(() => newExpectedDate(entryId, date))}>
          New date
        </Button>
      </div>
      <ActionNote result={result} />
    </div>
  );
}

/** Section 20, U3: a member said it ended; a PM or Lead ends it one way or the other, or keeps it open (OC2). */
export function OutcomeControls({ entryId, choices }: { entryId: string; choices: { outcome: ResolveOutcome; label: string }[] }) {
  const { pending, result, run } = useRun();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {choices.map((c, i) => (
          <Button key={c.outcome} variant={i === 0 ? "primary" : "secondary"} disabled={pending} onClick={() => run(() => endEntry(entryId, c.outcome))}>
            {c.label}
          </Button>
        ))}
        <Button variant="link" disabled={pending} onClick={() => run(() => keepEntryOpen(entryId))}>
          Keep open
        </Button>
      </div>
      <ActionNote result={result} />
    </div>
  );
}

export function AcknowledgeControl({ entryId }: { entryId: string }) {
  const { pending, result, run } = useRun();
  return (
    <div className="flex flex-col gap-2">
      <Button disabled={pending} onClick={() => run(() => acknowledgeEntry(entryId))}>
        Acknowledge
      </Button>
      <ActionNote result={result} />
    </div>
  );
}

export function FollowUpControls({ entryId }: { entryId: string }) {
  const { pending, result, run } = useRun();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Button disabled={pending} onClick={() => run(() => confirmDraft(entryId))}>
          Add to the log
        </Button>
        <Button variant="secondary" disabled={pending} onClick={() => run(() => dropDraft(entryId))}>
          Drop it
        </Button>
      </div>
      <ActionNote result={result} />
    </div>
  );
}

export function LeaveControls({ leaveId }: { leaveId: string }) {
  const { pending, result, run } = useRun();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Button disabled={pending} onClick={() => run(() => decideLeave(leaveId, true))}>
          Approve leave
        </Button>
        <Button variant="secondary" disabled={pending} onClick={() => run(() => decideLeave(leaveId, false))}>
          Decline
        </Button>
      </div>
      <ActionNote result={result} />
    </div>
  );
}

export function LinkChangeForm({ workItemId }: { workItemId: string }) {
  const { pending, result, run } = useRun();
  const [url, setUrl] = useState("");
  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => [e.preventDefault(), run(() => linkWorkChange(workItemId, url))]}>
      <div className="flex items-center gap-2">
        <input
          aria-label="Link to the PR or document"
          placeholder="https://github.com/…/pull/145"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="min-w-0 flex-1 rounded-control border border-line-strong bg-panel px-2 py-1 type-body"
        />
        <Button type="submit" disabled={pending || !url.trim()}>
          Add link
        </Button>
      </div>
      <ActionNote result={result} />
    </form>
  );
}

export type ReasonEntry = { id: string; kind: BraidKind; kindLabel: string; title: string; stateLabel: string; onLog: boolean };

/**
 * The reason for a set status (M9, L6b): the rules draft to start, reworded by Atlas on request,
 * linked to entries on the log by their chips. D17: an entry that is missing can be added here.
 */
export function ReasonEditor({
  projectId,
  calculatedLabel,
  setLabel,
  draft,
  entries,
  stale,
}: {
  projectId: string;
  calculatedLabel: string;
  setLabel: string;
  draft: { text: string; entryIds: string[] };
  entries: ReasonEntry[];
  stale: boolean;
}) {
  const { pending, result, run } = useRun();
  const [text, setText] = useState(draft.text);
  const [by, setBy] = useState<"rules" | "atlas">("rules");
  const [edited, setEdited] = useState(false);
  const [linked, setLinked] = useState<string[]>(draft.entryIds);
  const [extra, setExtra] = useState<ReasonEntry[]>([]);
  const [adding, setAdding] = useState(false);
  const [newKind, setNewKind] = useState<BraidKind>("issue");
  const [newTitle, setNewTitle] = useState("");
  const all = [...entries, ...extra];
  const onLog = all.filter((e) => e.onLog);
  const waiting = all.filter((e) => !e.onLog && e.stateLabel.toLowerCase().includes("proposed"));
  const toggle = (id: string) => setLinked(linked.includes(id) ? linked.filter((x) => x !== id) : [...linked, id]);
  const chip = (e: ReasonEntry) => `${e.kindLabel} · ${e.title}`;

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-1.5">
        <span className="type-label text-fg-2">Reason</span>
        <div className="flex flex-col gap-2 rounded-control border border-line-strong p-3">
          <textarea
            aria-label="Reason"
            value={text}
            rows={3}
            onChange={(e) => [setText(e.target.value), setEdited(true)]}
            placeholder={`Why ${setLabel}, when the plan says ${calculatedLabel}?`}
            className="w-full resize-none bg-transparent type-body text-fg-1 outline-none"
          />
          <div className="flex items-center gap-1.5">
            <Icon name="sparkles-12" />
            <span className="flex-1 type-caption text-fg-3">
              {by === "atlas" ? "Drafted by Atlas from the BRAID log. Edit before saving." : "Drafted from the BRAID log and the plan. Edit before saving."}
            </span>
            <Button
              variant="link"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  const d = await atlasReason(projectId);
                  setText(d.text);
                  setBy(d.by);
                  setEdited(false);
                  return { ok: true, message: d.by === "atlas" ? "Reworded by Atlas." : "Atlas could not reword it; this is the rules draft." };
                })
              }
            >
              Reword with Atlas
            </Button>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="type-caption text-fg-3">Linked to</span>
        {onLog.map((e) => (
          <LinkChip key={e.id} active={linked.includes(e.id)} onClick={() => toggle(e.id)}>
            {chip(e)}
          </LinkChip>
        ))}
        {waiting.map((e) => (
          <LinkChip key={e.id} active={false}>
            {chip(e)} (approve first)
          </LinkChip>
        ))}
        {!adding && (
          <Button variant="link" onClick={() => setAdding(true)}>
            Add to the BRAID log
          </Button>
        )}
      </div>
      {adding && (
        <div className="flex items-center gap-2">
          <select aria-label="Kind" value={newKind} onChange={(e) => setNewKind(e.target.value as BraidKind)} className="rounded-control border border-line-strong bg-panel px-2 py-1 type-body">
            {(["blocker", "issue", "risk", "assumption", "dependency", "decision"] as const).map((k) => (
              <option key={k} value={k}>
                {k.charAt(0).toUpperCase() + k.slice(1)}
              </option>
            ))}
          </select>
          <input aria-label="Title" placeholder="What is it?" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} className="min-w-0 flex-1 rounded-control border border-line-strong bg-panel px-2 py-1 type-body" />
          <Button
            disabled={pending || !newTitle.trim()}
            onClick={() =>
              run(async () => {
                const r = await addEntry(projectId, newKind, newTitle);
                if (r.ok && "entryId" in r && r.entryId) {
                  const label = newKind.charAt(0).toUpperCase() + newKind.slice(1);
                  setExtra([...extra, { id: r.entryId, kind: newKind, kindLabel: label, title: newTitle.trim(), stateLabel: r.onLog ? "On the log" : "Proposed", onLog: !!r.onLog }]);
                  if (r.onLog) setLinked([...linked, r.entryId]);
                  setNewTitle("");
                  setAdding(false);
                }
                return r;
              })
            }
          >
            Add
          </Button>
          <Button variant="link" onClick={() => setAdding(false)}>
            Cancel
          </Button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button disabled={pending || !text.trim() || !linked.length} onClick={() => run(() => giveReason(projectId, { text, entryIds: linked, draftedByAtlas: by === "atlas", edited }))}>
          Save reason
        </Button>
        <Button variant="secondary" disabled={pending} onClick={() => run(() => showCalculatedStatus(projectId))}>
          Use {calculatedLabel} instead
        </Button>
        {stale && (
          <Button variant="secondary" disabled={pending} onClick={() => run(() => keepStatus(projectId))}>
            Keep {setLabel}
          </Button>
        )}
      </div>
      {!linked.length && <p className="type-caption text-fg-3">Link at least one entry on the log; a reason explains the status with them.</p>}
      <ActionNote result={result} />
    </div>
  );
}
