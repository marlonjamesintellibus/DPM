// Section 15: how a project stands, or how all of the asker's projects stand.
import type { Topic } from "./topic";

export const projectStatus = {
  id: "project_status",
  rule: /\b(on track|at risk|off track|status|how is|how's|how are)\b/,
  prompt: "how a project stands",
  suggest: ["What's blocked?"],
} as const satisfies Topic;
