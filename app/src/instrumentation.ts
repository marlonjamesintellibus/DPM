// Runs once when the server starts: the rules' timers start ticking (src/timers.ts).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.DPM_TIMERS === "off") return;
  const { startTimers } = await import("./timers");
  startTimers();
}
