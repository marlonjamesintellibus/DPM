// @vitest-environment jsdom
// Phase S: the thumbs under a reply, next to Copy. A thumbs down asks what was wrong and, while
// "Help improve Atlas" is off, offers it; turning it on from here gives the thumbs down again so it is logged.
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

  it("LF1: with the setting off it is offered; turning it on gives the thumbs down again", async () => {
    render(<AnswerFeedback captureId="cap-1" given={{ rating: "down", wrong: "#151 is done" }} helpOn={false} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Help improve Atlas" })));
    expect(actions.setHelpImproveAtlasAction).toHaveBeenCalledWith(true);
    expect(actions.rateAnswer).toHaveBeenCalledWith("cap-1", "down", "#151 is done");
    expect(screen.getByRole("status").textContent).toBe("On.");
  });

  it("the same thumb again changes nothing", async () => {
    render(<AnswerFeedback captureId="cap-1" given={{ rating: "up", wrong: null }} helpOn />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Good answer" })));
    expect(actions.rateAnswer).not.toHaveBeenCalled();
  });
});
