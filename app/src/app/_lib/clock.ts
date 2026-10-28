// The app's clock. The seed is the 20 Oct 2026 snapshot, so by default the demo starts at 9:10am
// that Tuesday in Jamaica and moves on in real time from when the server started; every command
// and query takes the time as input, so the story plays forward as people act. After a restart the
// clock carries on from the latest time the database saved (resumeClock), so nothing already said
// shows a time later than now. DPM_CLOCK=real uses the real time.
import { connection } from "next/server";

const SNAPSHOT = new Date("2026-10-20T14:10:00Z");

/** The demo time at realStart; it runs on from there in real time. */
type DemoClock = { realStart: number; demoStart: number };
const clock = globalThis as unknown as { dpmClock?: DemoClock };

/** The time inside a request, a Server Action or after(): it reads the real clock. */
export function now(): Date {
  if (process.env.DPM_CLOCK === "real") return new Date();
  clock.dpmClock ??= { realStart: Date.now(), demoStart: SNAPSHOT.getTime() };
  return new Date(clock.dpmClock.demoStart + (Date.now() - clock.dpmClock.realStart));
}

/** Moves the demo clock on to the latest saved time when that is later than now; it never goes back. */
export function resumeClock(latest: Date | null): void {
  if (process.env.DPM_CLOCK === "real" || !latest || latest.getTime() <= now().getTime()) return;
  clock.dpmClock = { realStart: Date.now(), demoStart: latest.getTime() };
}

/** The time while rendering a page: marks the render as per request first (Cache Components). */
export async function requestNow(): Promise<Date> {
  await connection();
  return now();
}

/** "Tue 20 Oct · 9:10am", as the header shows it. */
export function asOfLabel(at: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Jamaica", weekday: "short", day: "numeric", month: "short" }).format(at);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: "America/Jamaica", hour: "numeric", minute: "2-digit" }).format(at).replace(" ", "").toLowerCase();
  return `${parts.replace(",", "")} · ${time}`;
}
