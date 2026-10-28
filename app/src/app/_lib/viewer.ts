// Who is looking (View as, L0). There is no sign-in in this slice: the prototype switches between
// the seeded people, and every query and command runs as that person, so what each sees and may
// do comes from their own memberships and rights, never from the screen.
import { cookies } from "next/headers";

export const VIEWER_COOKIE = "dpm-viewer";

/** The people of use case 1, in the order the menu lists them. */
export const VIEWERS = [
  { id: "kemar", name: "Kemar Brown", initials: "KB", title: "Data engineer", lens: "Employee view", menuLine: "Employee · own work, Forager 2.0 and Store Insights" },
  { id: "alicia", name: "Alicia Campbell", initials: "AC", title: "Delivery lead", lens: "Delivery lead view", menuLine: "Delivery lead · Forager 2.0, GQ & Academy" },
  { id: "andre", name: "Andre Mitchell", initials: "AM", title: "Project manager", lens: "Delivery lead view", menuLine: "PM · Store Insights" },
  // Phase P: the teammate a cover is asked of, so her side of it (the ask in her inbox and chat) can be seen
  { id: "jodian", name: "Jodian Taylor", initials: "JT", title: "Intern", lens: "Employee view", menuLine: "Intern · Forager 2.0" },
] as const;

export type ViewerId = (typeof VIEWERS)[number]["id"];
export type ViewerInfo = (typeof VIEWERS)[number];

export function viewerInfo(id: string): ViewerInfo {
  return VIEWERS.find((v) => v.id === id) ?? VIEWERS[0];
}

export async function currentViewer(): Promise<ViewerInfo> {
  return viewerInfo((await cookies()).get(VIEWER_COOKIE)?.value ?? "kemar");
}
