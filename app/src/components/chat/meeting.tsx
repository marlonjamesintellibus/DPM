"use client";
// Meetings in the chat, the review and the inbox (conversational plan, phase O). Under a meeting note, its recorder
// says who was there and that they knew it was recorded (M33 ATTENDEES_CONFIRMED), or that they were not told, so
// it is read as their own notes (MT4, CD17); a second note of the same meeting is offered to merge (MT7). In the
// review, the recorder says who said an item Atlas was unsure of (MT2). In the inbox, the person a note says
// something about confirms it, changes it first, or says it's not right (M34). The server checks each one when it
// runs, so a button shown here can still be refused.
import { useState, useTransition } from "react";
import { changeMeetingItem, confirmMeetingAttendees, confirmMeetingItem, declineMeetingItem, fixMeetingSpeaker, readMeetingAsOwnNotes, type ActionResult } from "@/app/actions";
import { ActionNote, Button } from "@/components/ui/controls";

function useRun() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const run = (fn: () => Promise<ActionResult>) => start(async () => setResult(await fn()));
  return { pending, result, run };
}

const Done = ({ message }: { message?: string }) => (
  <span role="status" className="type-caption text-ok">
    {message}
  </span>
);

/** M33 received: who was there, and whether they knew it was recorded. */
export function MeetingAttendees({
  id,
  project,
  candidates,
  chosen,
  merge,
}: {
  id: string;
  project: string;
  candidates: { id: string; name: string; tie: string }[];
  chosen: string[];
  merge: { recorder: string; time: string } | null;
}) {
  const { pending, result, run } = useRun();
  const [there, setThere] = useState<string[]>(chosen);
  const [told, setTold] = useState(false);
  const [merging, setMerging] = useState(true);
  if (result?.ok) return <Done message={result.message} />;
  const toggle = (p: string) => setThere(there.includes(p) ? there.filter((x) => x !== p) : [...there, p]);
  return (
    <div role="group" aria-label="Who was there" className="flex flex-col gap-2 rounded-panel border border-line px-3 py-2.5">
      <span className="type-body text-fg-1">Meeting note for {project}. Who was there?</span>
      <span className="flex flex-wrap gap-x-4 gap-y-1.5">
        {candidates.map((c) => (
          <label key={c.id} className="flex items-center gap-1.5 type-body text-fg-2">
            <input type="checkbox" checked={there.includes(c.id)} onChange={() => toggle(c.id)} />
            {c.name} <span className="type-caption text-fg-3">· {c.tie}</span>
          </label>
        ))}
      </span>
      <label className="flex items-center gap-1.5 type-body text-fg-2">
        <input type="checkbox" checked={told} onChange={(e) => setTold(e.target.checked)} />
        Everyone there knew it was recorded
      </label>
      {merge && (
        <label className="flex items-center gap-1.5 type-body text-fg-2">
          <input type="checkbox" checked={merging} onChange={(e) => setMerging(e.target.checked)} />
          Merge with {merge.recorder}&rsquo;s note of this meeting ({merge.time}): what it already asked is not asked again
        </label>
      )}
      <span className="flex flex-wrap items-center gap-2">
        <Button disabled={pending || !told || !there.length} onClick={() => run(() => confirmMeetingAttendees(id, there, !!merge && merging))}>
          Read it for everyone there
        </Button>
        <Button variant="secondary" disabled={pending} onClick={() => run(() => readMeetingAsOwnNotes(id))}>
          They weren&rsquo;t told: my notes only
        </Button>
      </span>
      <span className="type-caption text-fg-3">Nothing is read until you choose. What it says about someone else is saved only when they confirm it.</span>
      <ActionNote result={result} />
    </div>
  );
}

/** MT2: who said an item Atlas was unsure of; nothing of it goes anywhere until the recorder says. */
export function HeldSpeaker({ id, choices }: { id: string; choices: { id: string; name: string }[] }) {
  const { pending, result, run } = useRun();
  const [who, setWho] = useState("");
  if (result?.ok) return <Done message={result.message} />;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <select aria-label="Who said it" value={who} onChange={(e) => setWho(e.target.value)} className="rounded-control border border-line-strong bg-panel px-2 py-1 type-body">
        <option value="">Who said it?</option>
        {choices.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <Button disabled={pending || !who} onClick={() => run(() => fixMeetingSpeaker(id, who))}>
        That&rsquo;s who
      </Button>
      <ActionNote result={result} />
    </span>
  );
}

/** M34: confirm it as yours, change it first (a promise's words and day), or say it's not right. */
export function MeetingItemControls({ id, promise, words, dueOn, today }: { id: string; promise: boolean; words: string; dueOn: string | null; today: string }) {
  const { pending, result, run } = useRun();
  const [changing, setChanging] = useState(false);
  const [text, setText] = useState(words);
  const [day, setDay] = useState(dueOn && dueOn >= today ? dueOn : "");
  const [why, setWhy] = useState("");
  return (
    <div role="group" aria-label="Is this right?" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={pending} onClick={() => run(() => confirmMeetingItem(id))}>
          Confirm
        </Button>
        {promise && (
          <Button variant="secondary" disabled={pending} onClick={() => setChanging(!changing)}>
            Change
          </Button>
        )}
        <input aria-label="What's not right" placeholder="What's not right? (optional)" value={why} onChange={(e) => setWhy(e.target.value)} className="min-w-0 flex-1 rounded-control border border-line-strong bg-panel px-2 py-1 type-body" />
        <Button variant="secondary" disabled={pending} onClick={() => run(() => declineMeetingItem(id, why))}>
          That&rsquo;s not right
        </Button>
      </div>
      {changing && (
        <div className="flex flex-wrap items-center gap-2">
          <input aria-label="In your words" value={text} onChange={(e) => setText(e.target.value)} className="min-w-0 flex-1 rounded-control border border-line-strong bg-panel px-2 py-1 type-body" />
          <input type="date" aria-label="By" min={today} value={day} onChange={(e) => setDay(e.target.value)} className="rounded-control border border-line-strong bg-panel px-2 py-1 type-body" />
          <Button variant="secondary" disabled={pending || !text.trim()} onClick={() => run(() => changeMeetingItem(id, text, day || null))}>
            Save changes
          </Button>
        </div>
      )}
      <ActionNote result={result} />
    </div>
  );
}
