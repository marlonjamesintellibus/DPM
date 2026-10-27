// Small pieces from the D/ library: buttons (D/Button), the BRAID kind chip, the numbered badge that
// ties a highlight in the message to its cards, and the status pill.
import { Icon } from "@/components/shell/icon";
import type { Status } from "@/domain/status/status";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "link" };

export function Button({ variant = "primary", className = "", ...rest }: ButtonProps) {
  const look =
    variant === "primary"
      ? "bg-inverse text-on-inverse hover:opacity-90"
      : variant === "secondary"
        ? "border border-line-strong bg-panel text-fg-1 hover:bg-hover"
        : "text-accent hover:underline";
  const shape = variant === "link" ? "" : "rounded-control px-2.5 py-1";
  return <button type="button" className={`inline-flex shrink-0 items-center gap-1.5 type-label whitespace-nowrap disabled:opacity-50 ${shape} ${look} ${className}`} {...rest} />;
}

/** "BRAID · Risk": a neutral label, never coloured (A4.1). */
export function KindChip({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex self-start rounded-sm border border-line bg-panel-2 px-1.5 type-micro text-fg-2">{children}</span>;
}

/** The item number on a highlight and its card: warn while it needs the author's OK. */
export function NumberBadge({ n, tone = "accent", size = "sm" }: { n: number; tone?: "accent" | "warn"; size?: "sm" | "md" }) {
  return (
    <span className={`inline-flex shrink-0 rounded-full type-micro text-on-inverse ${size === "md" ? "px-1.5" : "px-1"} ${tone === "warn" ? "bg-warn" : "bg-accent"}`}>
      {n}
    </span>
  );
}

const STATUS_TONE: Record<Status, string> = {
  on_track: "bg-ok-soft text-ok",
  at_risk: "bg-warn-soft text-warn",
  off_track: "bg-bad-soft text-bad",
  done: "bg-panel-2 text-fg-2",
  not_started: "bg-panel-2 text-fg-2",
};

/** A status, in the colour it carries (A4.1). Lifecycle states use KindChip, not this. */
export function StatusPill({ status, label }: { status: Status | null; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 type-micro whitespace-nowrap ${status ? STATUS_TONE[status] : "bg-panel-2 text-fg-2"}`}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {label}
    </span>
  );
}

/** Words that show a command's answer under the controls that caused it. */
export function ActionNote({ result }: { result: { ok: boolean; message?: string } | null }) {
  if (!result?.message) return null;
  return (
    <p role={result.ok ? "status" : "alert"} className={`type-caption ${result.ok ? "text-ok" : "text-bad"}`}>
      {result.message}
    </p>
  );
}

const DOT: Record<Status, "dot-ok" | "dot-warn" | "dot-bad" | "dot-neutral"> = {
  on_track: "dot-ok",
  at_risk: "dot-warn",
  off_track: "dot-bad",
  done: "dot-neutral",
  not_started: "dot-neutral",
};

/** D/Status: a dot and a label, as the cards show a status (L6b "Set by you · ● Off track"). */
export function StatusMark({ status, label }: { status: Status | null; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon name={status ? DOT[status] : "dot-neutral"} />
      <span className="type-label text-fg-1">{label}</span>
    </span>
  );
}

/** A state on the BRAID log ("● Waiting for PM or Lead"): blue while it waits on someone, grey otherwise. */
export function StateMark({ waiting, label }: { waiting: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon name={waiting ? "dot-info" : "dot-neutral"} />
      <span className="type-label text-fg-1">{label}</span>
    </span>
  );
}

/** "🔗 Blocker · Store feed access (2 reports)" (L6b "Linked to" and "Related"). */
export function LinkChip({ children, onClick, active = true }: { children: React.ReactNode; onClick?: () => void; active?: boolean }) {
  const body = (
    <>
      <Icon name={active ? "link" : "plus-14"} />
      <span className="type-caption text-fg-2">{children}</span>
    </>
  );
  const look = `inline-flex items-center gap-1 rounded-full border px-2 py-[3px] ${active ? "border-line" : "border-dashed border-line-strong"}`;
  return onClick ? (
    <button type="button" onClick={onClick} aria-pressed={active} className={`${look} hover:bg-hover`}>
      {body}
    </button>
  ) : (
    <span className={look}>{body}</span>
  );
}
