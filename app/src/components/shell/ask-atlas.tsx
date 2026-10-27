"use client";
// Ask Atlas (header, sidebar and ⌘K): the Today chat with the message box ready to type (section 15).
// Already there, it only moves the cursor to the box.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

/** Like Claude or ChatGPT: Ask Atlas opens a new conversation (section 16). */
export const ASK_ATLAS_HREF = "/?view=chat&c=new&ask=1";
export const ASK_ATLAS_INPUT = "ask-atlas";

function useOpenAtlas() {
  const router = useRouter();
  const path = usePathname();
  return () => {
    const box = document.getElementById(ASK_ATLAS_INPUT);
    if (path === "/" && box) box.focus();
    else router.push(ASK_ATLAS_HREF);
  };
}

/** ⌘K or Ctrl+K anywhere opens Ask Atlas. */
export function AskAtlasShortcut() {
  const open = useOpenAtlas();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        open();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });
  return null;
}

export function AskAtlasLink({ className, children }: { className: string; children: React.ReactNode }) {
  const open = useOpenAtlas();
  return (
    <Link
      href={ASK_ATLAS_HREF}
      className={className}
      onClick={(e) => {
        if (document.getElementById(ASK_ATLAS_INPUT)) {
          e.preventDefault();
          open();
        }
      }}
    >
      {children}
    </Link>
  );
}
