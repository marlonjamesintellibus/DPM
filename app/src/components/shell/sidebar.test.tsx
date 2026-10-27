// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Sidebar } from "./sidebar";
import { kemarSidebar } from "@/app/shell-placeholder";

afterEach(cleanup);

describe("Sidebar", () => {
  it("marks only the active page as current", () => {
    render(<Sidebar {...kemarSidebar} activeHref="/" />);
    const current = screen.getAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page");
    expect(current.map((a) => a.textContent)).toEqual(["Today"]);
  });

  it("shows the viewer and the counts from its props", () => {
    render(<Sidebar {...kemarSidebar} activeHref="/projects" />);
    expect(screen.getByText("Kemar Brown")).toBeTruthy();
    expect(screen.getByText("Data engineer")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Projects/ }).textContent).toContain("17");
    expect(screen.getByRole("link", { name: /Sprouts/ }).textContent).toContain("5");
  });
});
