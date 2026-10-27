"use client";
// Review my update (Figma L16b): what you said, with each quoted span numbered; what Atlas will
// change, grouped by project; and the selected item's detail with who sees what after Save.
// The words that fed a card are underlined with its number as a footnote; hover them to light up
// their cards and the other way round. Every decision is a Server
// Action that runs the capture commands as the author; nothing is applied until Save (S3). An update
// with one item is decided and saved on its card in one step (section 19).
import { useMemo, useState, useTransition } from "react";
import { decideAndSave, decideItem, discardUpdate, moveItem, rematchItem, saveUpdate, type ActionResult } from "@/app/actions";
import { Card, FieldRow } from "@/components/ui/card";
import { ActionNote, Button, KindChip } from "@/components/ui/controls";
import { Icon } from "@/components/shell/icon";
import type { Review, ReviewItem } from "@/queries/review";

type Props = { review: Review };

const NEEDS_OK = new Set(["needs_ok", "conflict", "proposed"]);
const needsOk = (i: ReviewItem) => NEEDS_OK.has(i.state);

export function ReviewScreen({ review }: Props) {
  const [hover, setHover] = useState<number[]>([]);
  const firstOpen = review.items.find(needsOk) ?? review.items[0];
  const [selected, setSelected] = useState<number | null>(firstOpen?.ordinal ?? null);
  const open = review.capture.state === "reviewing";
  const byOrdinal = useMemo(() => new Map(review.items.map((i) => [i.ordinal, i])), [review.items]);
  const current = selected !== null ? byOrdinal.get(selected) : undefined;

  return (
    <div className="flex items-start gap-4">
      <div className="flex w-[340px] shrink-0 flex-col gap-4">
        <MessageCard review={review} hover={hover} selected={selected} onHover={setHover} onSelect={setSelected} />
        <SetAsideCard review={review} />
      </div>
      <ChangesCard review={review} open={open} hover={hover} selected={selected} onHover={setHover} onSelect={setSelected} />
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        {current && <DetailCard item={current} review={review} />}
        <WhoSeesCard review={review} />
      </div>
    </div>
  );
}

// ---- What you said ----

type Span = { start: number; end: number; ordinals: number[] };

// Overlapping quotes become one highlight carrying every number, as the design shows ("3 7")
function mergeSpans(highlights: Review["highlights"]): Span[] {
  const out: Span[] = [];
  for (const h of [...highlights].sort((a, b) => a.start - b.start)) {
    const last = out.at(-1);
    if (last && h.start < last.end) {
      last.end = Math.max(last.end, h.end);
      last.ordinals = [...new Set([...last.ordinals, ...h.ordinals])].sort((a, b) => a - b);
    } else out.push({ start: h.start, end: h.end, ordinals: [...h.ordinals].sort((a, b) => a - b) });
  }
  return out;
}

function MessageCard({
  review,
  hover,
  selected,
  onHover,
  onSelect,
}: {
  review: Review;
  hover: number[];
  selected: number | null;
  onHover: (o: number[]) => void;
  onSelect: (o: number) => void;
}) {
  const { capture } = review;
  const spans = mergeSpans(review.highlights);
  const parts: React.ReactNode[] = [];
  // Section 20, U1: words that fed nothing are underlined in place, so the list below has a home
  const plain = (from: number, to: number) => {
    let at = from;
    for (const u of review.setAside.unused) {
      if (u.end <= from || u.start >= to) continue;
      if (u.start > at) parts.push(<span key={`t${at}`}>{capture.text.slice(at, u.start)}</span>);
      parts.push(
        <span key={`u${u.start}`} title="Not used" className="underline decoration-fg-3 decoration-dotted underline-offset-4">
          {capture.text.slice(Math.max(u.start, from), Math.min(u.end, to))}
        </span>,
      );
      at = Math.min(u.end, to);
    }
    if (at < to) parts.push(<span key={`t${at}`}>{capture.text.slice(at, to)}</span>);
  };
  let at = 0;
  for (const s of spans) {
    if (s.start > at) plain(at, s.start);
    const lit = s.ordinals.some((o) => hover.includes(o) || o === selected);
    parts.push(
      // Footnotes: a plain underline and the card numbers as a superscript, so the message reads as
      // written; whether a card needs an OK is said on the card. Words that fed nothing stay dotted (U1).
      // A span, not a button: a button never flows as text, so a phrase could not wrap mid-line.
      <span
        key={`s${s.start}`}
        role="button"
        tabIndex={0}
        aria-label={`${capture.text.slice(s.start, s.end)}, update ${s.ordinals.join(" and ")}`}
        onMouseEnter={() => onHover(s.ordinals)}
        onMouseLeave={() => onHover([])}
        onFocus={() => onHover(s.ordinals)}
        onBlur={() => onHover([])}
        onClick={() => onSelect(s.ordinals[0])}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(s.ordinals[0]);
          }
        }}
        className={`cursor-pointer rounded-[2px] underline decoration-line-strong underline-offset-4 box-decoration-clone focus-visible:outline-[1.5px] focus-visible:outline-line-strong ${lit ? "bg-accent-soft decoration-fg-2" : ""}`}
      >
        <span>{capture.text.slice(s.start, s.end)}</span>
        <sup className="ml-px text-[11px] text-fg-3">{s.ordinals.join(",")}</sup>
      </span>,
    );
    at = s.end;
  }
  if (at < capture.text.length) plain(at, capture.text.length);

  const time = new Intl.DateTimeFormat("en-US", { timeZone: "America/Jamaica", hour: "numeric", minute: "2-digit" }).format(capture.messageAt).replace(" ", "").toLowerCase();
  const source = capture.channel === "atlas" ? `Atlas ${capture.kind === "voice" ? "voice note" : "message"}` : "DPM chat";
  const projectGroups = review.groups.filter((g) => g.type === "project");
  return (
    <Card label={`Your message · ${source} · ${time}`} title="What you said" emphasis>
      <p className="type-body leading-[26px] text-fg-1">{parts}</p>
      {capture.kind === "voice" && (
        <div className="flex items-center gap-2">
          <Icon name="mic" />
          <span className="type-caption text-fg-3">From a {capture.durationSeconds ?? "short"} second voice note</span>
        </div>
      )}
      {review.items.length > 1 && (
        <p className="type-caption text-fg-3">
          Hover the underlined words to see what they changed.{spans.some((s) => s.ordinals.length > 1) ? " Some words feed two updates, so they carry two numbers." : ""}
        </p>
      )}
      {projectGroups.length > 0 && (
        <p className="type-caption text-fg-3">
          Only you see this whole message.{" "}
          {projectGroups
            .map((g) => (g.type === "project" && g.pm ? `${g.pm.name.split(" ")[0]} sees only the ${g.name} lines` : null))
            .filter(Boolean)
            .join("; ")}
          .
        </p>
      )}
    </Card>
  );
}

// ---- Set aside (section 20, U1) ----

function SetAsideCard({ review }: { review: Review }) {
  const { refused, unused } = review.setAside;
  if (!refused.length && !unused.length) return null;
  return (
    <Card label="Set aside · only you see this" title="Atlas didn't use these">
      {refused.map((r, i) => (
        <div key={`r${i}`} className="flex flex-col gap-0.5">
          <span className="type-body text-fg-1">{r.reason}</span>
          {r.quote && <span className="type-caption text-fg-3">&ldquo;{r.quote}&rdquo;</span>}
        </div>
      ))}
      {unused.map((u) => (
        <div key={`u${u.start}`} className="flex flex-col gap-0.5">
          <span className="type-body text-fg-1">&ldquo;{u.text}&rdquo;</span>
          <span className="type-caption text-fg-3">Not used. Nothing in DPM fits it yet.</span>
        </div>
      ))}
      <p className="type-caption text-fg-3">To add something here, send it again in other words or tell your PM.</p>
    </Card>
  );
}

// ---- What Atlas will change ----

function ChangesCard({
  review,
  open,
  hover,
  selected,
  onHover,
  onSelect,
}: {
  review: Review;
  open: boolean;
  hover: number[];
  selected: number | null;
  onHover: (o: number[]) => void;
  onSelect: (o: number) => void;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const { counts } = review;
  const saved = review.capture.state === "saved";
  // Section 19: one item is saved from its card, so the foot has nothing to add until it is saved
  const single = review.items.length === 1;
  const run = (fn: () => Promise<ActionResult>) => start(async () => setResult(await fn()));
  return (
    <Card label="What Atlas will change" title={`${counts.changes} ${counts.changes === 1 ? "update" : "updates"} for ${counts.projects} ${counts.projects === 1 ? "project" : "projects"}`} className="w-[480px] shrink-0">
      {review.groups.map((g) => (
        <div key={g.type === "project" ? g.projectId : g.type} className="flex flex-col gap-3">
          <div className="flex items-center gap-2 pt-1.5">
            <span className="type-body-medium text-fg-1">{g.label}</span>
            <span className="type-micro text-fg-3">{groupLine(g)}</span>
          </div>
          {g.items.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              review={review}
              open={open}
              single={single}
              lit={hover.includes(item.ordinal) || selected === item.ordinal}
              onHover={onHover}
              onSelect={onSelect}
            />
          ))}
        </div>
      ))}
      <div className={`flex items-center gap-2 pt-2 ${single && !saved ? "hidden" : ""}`}>
        <p className={`flex-1 type-caption ${counts.needsOk || counts.needsProject ? "text-warn" : "text-fg-3"}`}>
          {saved
            ? "Saved. Each project now shows its own lines."
            : counts.needsOk || counts.needsProject
              ? review.footer.split(". ").slice(1).join(". ").replace(/\.$/, "") + " before this is saved"
              : "Nothing changes until you save."}
        </p>
        {open && !single && (
          <>
            <Button variant="link" disabled={pending} onClick={() => run(() => discardUpdate(review.capture.id))}>
              Discard
            </Button>
            <Button variant={review.canSave ? "primary" : "secondary"} disabled={pending || !review.canSave} onClick={() => run(() => saveUpdate(review.capture.id))}>
              {pending ? "Saving…" : `Save ${counts.changes} ${counts.changes === 1 ? "update" : "updates"}`}
            </Button>
          </>
        )}
      </div>
      <ActionNote result={result} />
    </Card>
  );
}

function groupLine(g: Review["groups"][number]): string {
  const n = g.items.length;
  if (g.type === "project") return `${n} ${n === 1 ? "update" : "updates"}${g.pm ? ` · ${g.pm.name} is PM` : ""}`;
  if (g.type === "you") return "Personal · only you and HR see leave";
  if (g.type === "choose") return "Pick a project for each, or keep it private";
  return "Private to you · in no project";
}

const CONFIDENCE_LABEL = { high: "High", medium: "Medium", low: "Low" } as const;

// Settled with nothing to write: Save has nothing to apply for these
const NOTHING_TO_SAVE = new Set<ReviewItem["state"]>(["no_change", "rejected", "withdrawn"]);

function ItemCard({
  item,
  review,
  open,
  single,
  lit,
  onHover,
  onSelect,
}: {
  item: ReviewItem;
  review: Review;
  open: boolean;
  /** Section 19: the update's only item, decided and saved here in one step. */
  single: boolean;
  lit: boolean;
  onHover: (o: number[]) => void;
  onSelect: (o: number) => void;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(item.edit?.value ?? "");
  const needsProject = item.routing.state === "choose_project";
  const [panel, setPanel] = useState<"move" | "pick" | null>(single && needsProject ? "move" : null);
  const warn = needsOk(item);
  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      const r = await fn();
      setResult(r);
      if (r.ok) {
        setEditing(false);
        setPanel(null);
      }
    });
  const confidenceTone = item.confidence === "medium" ? "text-warn" : "text-bad";
  const markTone = item.state === "edited" || item.state === "accepted" ? "text-accent" : item.state === "withdrawn" || item.state === "rejected" ? "text-fg-3 line-through" : "text-fg-3";
  const decided = item.state === "accepted" || item.state === "edited" || item.state === "rejected";
  const changeable = !!item.edit && (warn || item.state === "pre_accepted");
  // RS6, RS7, RS9: Save only when there is something to apply and somewhere to file it
  const savable = !NOTHING_TO_SAVE.has(item.state) && !needsProject;
  const captureId = review.capture.id;
  // Why it went there; the group heading already names the project
  const where = item.match && item.match.state !== "new" ? item.match.label : item.routing.reason;

  return (
    <article
      onMouseEnter={() => onHover([item.ordinal])}
      onMouseLeave={() => onHover([])}
      onClick={() => onSelect(item.ordinal)}
      className={`flex cursor-pointer flex-col gap-2 rounded-md border px-3 py-2.5 ${lit ? "border-line-strong bg-panel-2" : "border-line"}`}
    >
      <div className="flex items-start gap-2.5">
        {/* The footnote number, quiet: it only says which words this card came from */}
        <span className="w-3 shrink-0 pt-0.5 text-right type-micro text-fg-3">{item.ordinal}</span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {item.braidKind && <KindChip>{item.kindLabel}</KindChip>}
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="type-body-medium text-fg-1">{item.title}</span>
            {warn && <span className="rounded-sm bg-warn-soft px-1.5 type-micro text-warn">Needs your OK</span>}
          </span>
          <span className="flex flex-wrap items-center gap-x-2 type-body text-fg-2">
            <span>{item.change}</span>
            {item.confidence !== "high" && <span className={`type-micro ${confidenceTone}`}>{CONFIDENCE_LABEL[item.confidence]} confidence</span>}
            {/* "Needs your OK" is said beside the title; every other mark is said here */}
            {!warn && <span className={`type-micro ${markTone}`}>{item.markLabel}</span>}
          </span>
          {item.conflict?.reason && <span className="type-caption text-bad">{item.conflict.reason}</span>}
          {item.withdrawnNote && <span className="type-caption text-fg-3">{item.withdrawnNote}</span>}
          <span className="flex flex-wrap items-start gap-x-2 gap-y-1 type-micro">
            {where && <span className="text-fg-3">{where}</span>}
            {open && item.canMove && (
              <Button variant="link" className="type-micro" onClick={(e) => [e.stopPropagation(), setPanel(panel === "move" ? null : "move")]}>
                {needsProject ? "Pick a project" : "Move"}
              </Button>
            )}
            {open && item.match?.state === "same_as" && item.kind !== "braid_resolve" && (
              <>
                <Button variant="link" className="type-micro" disabled={pending} onClick={(e) => [e.stopPropagation(), run(() => rematchItem(item.id, { type: "different" }))]}>
                  Not the same
                </Button>
                {item.matchOptions.length > 0 && (
                  <Button variant="link" className="type-micro" onClick={(e) => [e.stopPropagation(), setPanel(panel === "pick" ? null : "pick")]}>
                    Pick an entry
                  </Button>
                )}
              </>
            )}
            {open && item.match?.state === "new" && item.matchOptions.length > 0 && (
              <Button variant="link" className="type-micro" onClick={(e) => [e.stopPropagation(), setPanel(panel === "pick" ? null : "pick")]}>
                Already in the log?
              </Button>
            )}
          </span>
          {open && single && needsProject && <span className="type-caption text-warn">Pick a project first</span>}
        </div>
        {open && single ? (
          <div className="flex flex-col items-stretch gap-1.5" onClick={(e) => e.stopPropagation()}>
            {savable && (
              <Button disabled={pending} onClick={() => run(() => decideAndSave(captureId, item.id, warn ? { type: "accept" } : null))}>
                {pending ? "Saving…" : "Save"}
              </Button>
            )}
            {changeable && (
              <Button variant="secondary" disabled={pending} onClick={() => setEditing(!editing)}>
                Change
              </Button>
            )}
            {decided && (
              <Button variant="link" disabled={pending} onClick={() => run(() => decideItem(item.id, { type: "undo" }))}>
                Undo
              </Button>
            )}
            <Button variant="link" disabled={pending} onClick={() => run(() => discardUpdate(captureId))}>
              Discard
            </Button>
          </div>
        ) : open && (warn || decided) ? (
          <div className="flex flex-col items-stretch gap-1.5" onClick={(e) => e.stopPropagation()}>
            {warn && (
              <>
                <Button disabled={pending} onClick={() => run(() => decideItem(item.id, { type: "accept" }))}>
                  Accept
                </Button>
                {item.edit && (
                  <Button variant="secondary" disabled={pending} onClick={() => setEditing(!editing)}>
                    Change
                  </Button>
                )}
                <Button variant="link" disabled={pending} onClick={() => run(() => decideItem(item.id, { type: "reject" }))}>
                  Reject
                </Button>
              </>
            )}
            {decided && (
              <Button variant="link" disabled={pending} onClick={() => run(() => decideItem(item.id, { type: "undo" }))}>
                Undo
              </Button>
            )}
          </div>
        ) : (
          <Icon name="arrow-up-right" />
        )}
      </div>

      {editing && item.edit && (
        <form
          className="flex items-center gap-2 pl-7"
          onClick={(e) => e.stopPropagation()}
          onSubmit={(e) => [
            e.preventDefault(),
            run(() => (single && !needsProject ? decideAndSave(captureId, item.id, { type: "edit", value }) : decideItem(item.id, { type: "edit", value }))),
          ]}
        >
          {item.edit.input === "choice" ? (
            <select aria-label="New value" value={value} onChange={(e) => setValue(e.target.value)} className="rounded-control border border-line-strong bg-panel px-2 py-1 type-body">
              {item.edit.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              aria-label="New value"
              type={item.edit.input === "date" ? "date" : "text"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="min-w-0 flex-1 rounded-control border border-line-strong bg-panel px-2 py-1 type-body"
            />
          )}
          <Button type="submit" disabled={pending}>
            {single && !needsProject ? "Save" : "Save change"}
          </Button>
        </form>
      )}

      {panel && (
        <div className="flex flex-wrap gap-1.5 pl-7" onClick={(e) => e.stopPropagation()}>
          {panel === "move"
            ? [
                ...review.projects
                  .filter((p) => p.id !== item.routing.projectId)
                  .map((p) => (
                    <Button key={p.id} variant="secondary" disabled={pending} onClick={() => run(() => moveItem(item.id, { projectId: p.id }))}>
                      {p.name}
                    </Button>
                  )),
                <Button key="private" variant="secondary" disabled={pending} onClick={() => run(() => moveItem(item.id, "keep_private"))}>
                  Keep private
                </Button>,
              ]
            : item.matchOptions.map((o) => (
                <Button key={o.id} variant="secondary" disabled={pending} onClick={() => run(() => rematchItem(item.id, { type: "pick", entryId: o.id }))}>
                  {o.title} · {o.stateLabel}
                </Button>
              ))}
        </div>
      )}
      {result && !result.ok && (
        <div className="pl-7">
          <ActionNote result={result} />
        </div>
      )}
    </article>
  );
}

// ---- The selected item ----

// The label and the item's card already say its kind and where it stands (section 19)
function DetailCard({ item, review }: { item: ReviewItem; review: Review }) {
  const label = `${item.kindLabel} · from update ${item.ordinal}`;
  const project = item.routing.projectId ? review.projects.find((p) => p.id === item.routing.projectId)?.name : null;
  return (
    <Card label={label} title={item.title}>
      <div className="flex flex-col gap-2 rounded-md bg-panel-2 px-3 py-2.5">
        <span className="type-caption text-fg-3">{item.braidKind ? "Where it goes" : "What changes"}</span>
        <span className="type-body-medium text-fg-1">{item.change}</span>
      </div>
      <p className="type-caption text-fg-2">
        {item.quotes.length ? `You said: "${item.quotes.join('" and "')}." ` : ""}
        {item.rationale}
      </p>
      <FieldRow label="Project">{project ?? (item.routing.state === "choose_project" ? "Choose a project" : "Only you")}</FieldRow>
      <FieldRow label="Why here">{item.routing.reason}</FieldRow>
    </Card>
  );
}

function WhoSeesCard({ review }: { review: Review }) {
  const projects = review.groups.filter((g): g is Extract<Review["groups"][number], { type: "project" }> => g.type === "project");
  return (
    <Card label="Who sees what after you save" title="Each project sees only its own lines">
      <p className="type-caption text-fg-2">Your groups that are not connected to DPM, and projects you are not in, get nothing.</p>
      <FieldRow label="You">The whole message</FieldRow>
      {projects.map((g) => (
        <FieldRow key={g.projectId} label={g.pm ? g.pm.name.split(" ")[0] : g.name}>
          {g.name} lines ({g.items.map((i) => i.ordinal).join(", ")})
        </FieldRow>
      ))}
    </Card>
  );
}
