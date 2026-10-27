// @vitest-environment jsdom
// Phase S: the thumbs under a reply, next to Copy. A thumbs down asks what was wrong while "Help improve
// Atlas" is on; while it is off it offers the setting instead (LF1), and turning it on from here gives the
// thumbs down again, without words, so it is logged.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const actions = vi.hoisted(() => ({
  rateAnswer: vi.fn(async () => ({ ok: true as const, message: "Thanks." })),
  setHelpImproveAtlasAction: vi.fn(async () => ({ ok: true as const, message: "On." })),
  acceptFromChat: vi.fn(),
}));
vi.mock("@/app/actions", () => actions);

const { AnswerFeedback } = await import("./reply-tools");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AnswerFeedback", () => {
  it("shows the feedback given, and asks nothing more for a thumbs up", () => {
    render(<AnswerFeedback captureId="cap-1" given={{ rating: "up", wrong: null }} helpOn={false} />);
    expect(screen.getByRole("button", { name: "Good answer" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByLabelText("What was wrong?")).toBeNull();
  });

  it("a thumbs down asks what was wrong, and sends it with the rating", async () => {
    render(<AnswerFeedback captureId="cap-1" given={null} helpOn />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Not right" })));
    expect(actions.rateAnswer).toHaveBeenCalledWith("cap-1", "down", undefined);
    fireEvent.change(screen.getByLabelText("What was wrong?"), { target: { value: "#151 is done" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Send" })));
    expect(actions.rateAnswer).toHaveBeenLastCalledWith("cap-1", "down", "#151 is done");
    expect(screen.queryByRole("button", { name: "Help improve Atlas" })).toBeNull();
  });

  it("LF1: with the setting off there is no box for what was wrong; the setting is offered instead", async () => {
    render(<AnswerFeedback captureId="cap-1" given={null} helpOn={false} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Not right" })));
    expect(actions.rateAnswer).toHaveBeenCalledWith("cap-1", "down", undefined);
    expect(screen.queryByLabelText("What was wrong?")).toBeNull();
    expect(screen.getByRole("button", { name: "Help improve Atlas" })).toBeTruthy();
  });

  it("LF1: turning it on gives the thumbs down again with no words, then asks what was wrong", async () => {
    render(<AnswerFeedback captureId="cap-1" given={{ rating: "down", wrong: null }} helpOn={false} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Help improve Atlas" })));
    expect(actions.setHelpImproveAtlasAction).toHaveBeenCalledWith(true);
    expect(actions.rateAnswer).toHaveBeenCalledTimes(1);
    expect(actions.rateAnswer).toHaveBeenCalledWith("cap-1", "down");
    expect(screen.getByRole("status").textContent).toBe("On.");
    // Words typed now go only when Send is pressed
    fireEvent.change(screen.getByLabelText("What was wrong?"), { target: { value: "#151 is done" } });
    expect(actions.rateAnswer).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Help improve Atlas" })).toBeNull();
  });

  it("the same thumb again changes nothing", async () => {
    render(<AnswerFeedback captureId="cap-1" given={{ rating: "up", wrong: null }} helpOn />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Good answer" })));
    expect(actions.rateAnswer).not.toHaveBeenCalled();
  });
});
