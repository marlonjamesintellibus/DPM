// Small talk (section 18, CQ12): no data, only a reply. A greeting says what Atlas can do; thanks or ok
// gets "Any time." DPM's words stand: there are no facts for Atlas to word.
import { eq } from "drizzle-orm";
import * as t from "../../db/schema";
import { GREETING } from "../../domain/topics/small-talk";
import { firstName } from "../project";
import type { AnswerBuilder } from "./shared";

export const smallTalk: AnswerBuilder = async (conn, viewerId, { asked }) => {
  if (!GREETING.test(asked.trim().toLowerCase())) return { text: "Any time.", cards: [], more: null };
  const [me] = await conn.select({ name: t.people.name }).from(t.people).where(eq(t.people.id, viewerId));
  return {
    text: `Hi ${firstName(me?.name ?? "there")}. Send me an update, or ask what you're working on, what needs you, any updates or who mentioned you.`,
    cards: [],
    more: null,
  };
};
