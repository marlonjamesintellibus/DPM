"use client";
// While Atlas is reading an update (the read runs after the reply, with retries), the chat asks
// the server again every couple of seconds until the capture lands in review, nothing, or failed.
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function RefreshWhile({ active, everyMs = 2000 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(id);
  }, [active, everyMs, router]);
  return null;
}
