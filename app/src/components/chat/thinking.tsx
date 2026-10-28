// "Thinking…" under a message while Atlas works on it (section 17), as ClickUp Brain, Voicenotes and
// Square show it: the Atlas mark and three dots that pulse. It never says "update": a message may be
// a question. After a few seconds it says it is still working, as Perplexity does. Phase G: "Drafting your
// standup" while Atlas writes a draft.
import { Icon } from "@/components/shell/icon";

export function ThinkingLine({ label }: { label: "Thinking" | "Still working on it" | `Drafting your ${string}` }) {
  return (
    <div className="flex items-center gap-2.5" role="status">
      <Icon name="sparkles" />
      <span className="type-body text-fg-2">{label}</span>
      <span className="flex gap-1" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span key={i} className="size-1.5 animate-pulse rounded-full bg-fg-3" style={{ animationDelay: `${i * 200}ms` }} />
        ))}
      </span>
    </div>
  );
}
