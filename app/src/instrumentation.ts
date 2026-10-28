// Runs once when the server starts: the demo clock carries on from the latest saved time
// (src/app/_lib/clock.ts), then the rules' timers start ticking (src/timers.ts).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const [{ resumeClock }, { getDb }, { latestSavedAt }] = await Promise.all([import("./app/_lib/clock"), import("./db/client"), import("./queries/latest-saved")]);
  try {
    resumeClock(await latestSavedAt(await getDb()));
  } catch (error) {
    // The clock then starts at 9:10am, as before; a request opens the database again
    console.error("could not read the latest saved time", error);
  }
  if (process.env.DPM_TIMERS === "off") return;
  const { startTimers } = await import("./timers");
  startTimers();
}
