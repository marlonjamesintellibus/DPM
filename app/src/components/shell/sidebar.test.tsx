// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Sidebar, type SidebarProps } from "./sidebar";

// Kemar's sidebar as L16 draws it
const kemarSidebar: Omit<SidebarProps, "activeHref"> = {
  workspace: "Intellibus",
  nav: [
    { label: "Today", href: "/", icon: "sun" },
    { label: "Projects", href: "/projects", icon: "grid", count: 17 },
  ],
  clients: [{ label: "Sprouts", href: "/clients/sprouts", count: 5 }],
  internal: [{ label: "GQ & Academy", href: "/internal/gq-academy", icon: "target" }],
  viewer: { name: "Kemar Brown", title: "Data engineer", initials: "KB" },
};

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

  it("leaves out a section with nothing in it", () => {
    render(<Sidebar {...kemarSidebar} internal={[]} activeHref="/" />);
    expect(screen.queryByText("Internal")).toBeNull();
    expect(screen.getByText("Clients")).toBeTruthy();
  });
});
