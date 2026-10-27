// The app's clock. The seed is the 20 Oct 2026 snapshot, so by default the demo starts at 9:10am
// that Tuesday in Jamaica and moves on in real time from when the server started; every command
// and query takes the time as input, so the story plays forward as people act. DPM_CLOCK=real
// uses the real time.
import { connection } from "next/server";

const SNAPSHOT = new Date("2026-10-20T14:10:00Z");
const clock = globalThis as unknown as { dpmClockStarted?: number };

/** The time inside a request, a Server Action or after(): it reads the real clock. */
export function now(): Date {
  if (process.env.DPM_CLOCK === "real") return new Date();
  clock.dpmClockStarted ??= Date.now();
  return new Date(SNAPSHOT.getTime() + (Date.now() - clock.dpmClockStarted));
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
