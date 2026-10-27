import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Phase 0: one table to prove migrations run. The use case 1 tables
// (build-plan.md, section 4) arrive in phase 2.
export const appMeta = pgTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
