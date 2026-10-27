// The card used across Variation L (Figma "Card · ..."): an uppercase head label, then a body.
// Radius 14, head pt 12 pb 10 pl 16 pr 14, body pt 14 pb 16 px 16 with 12 between rows.
export function Card({
  label,
  title,
  children,
  className = "",
  emphasis = false,
  headExtra,
  bodyClassName = "gap-3",
}: {
  label: string;
  title?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  /** The card that holds what the person said (L16b): a stronger border. */
  emphasis?: boolean;
  headExtra?: React.ReactNode;
  /** The gap between body rows: 12 by default, 6 for a list card (L6b "Card · Inbox"). */
  bodyClassName?: string;
}) {
  return (
    <section className={`flex flex-col overflow-hidden rounded-lg border bg-panel ${emphasis ? "border-line-strong" : "border-line"} ${className}`}>
      <div className="flex items-center gap-2 border-b border-line pt-3 pr-3.5 pb-2.5 pl-4">
        <h2 className="type-micro text-fg-3 uppercase">{label}</h2>
        <div className="flex-1" />
        {headExtra}
      </div>
      <div className={`flex flex-col px-4 pt-3.5 pb-4 ${bodyClassName}`}>
        {title !== undefined && <h3 className="type-heading text-fg-1">{title}</h3>}
        {children}
      </div>
    </section>
  );
}

/** A label and value line inside a card ("Kind  Risk"). */
export function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="w-[70px] shrink-0 type-caption text-fg-3">{label}</span>
      <span className="min-w-0 flex-1 type-body text-fg-1">{children}</span>
    </div>
  );
}
