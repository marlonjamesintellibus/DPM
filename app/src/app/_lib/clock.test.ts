// The demo clock after a restart: it carries on from the latest saved time, and never goes back.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { at } from "../../test/seeded-db";
import { now, resumeClock } from "./clock";

const clock = globalThis as unknown as { dpmClock?: unknown };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.stubEnv("DPM_CLOCK", "");
  delete clock.dpmClock;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  delete clock.dpmClock;
});

describe("the demo clock", () => {
  it("starts at 9:10am on 20 Oct and runs in real time", () => {
    expect(now()).toEqual(at(0));
    vi.advanceTimersByTime(5 * 60_000);
    expect(now()).toEqual(at(5));
  });

  it("carries on from the latest saved time when that is later, then runs on from there", () => {
    resumeClock(at(119)); // a notice from the last run, at 11:09am
    expect(now()).toEqual(at(119));
    vi.advanceTimersByTime(60_000);
    expect(now()).toEqual(at(120));
  });

  it("does not go back to an earlier saved time, or move without one", () => {
    now(); // the clock starts on its first read
    vi.advanceTimersByTime(30 * 60_000);
    resumeClock(at(10));
    expect(now()).toEqual(at(30));
    resumeClock(null);
    expect(now()).toEqual(at(30));
  });

  it("leaves the real time alone", () => {
    vi.stubEnv("DPM_CLOCK", "real");
    resumeClock(new Date(Date.now() + 3_600_000));
    expect(now().getTime()).toBe(Date.now());
  });
});
