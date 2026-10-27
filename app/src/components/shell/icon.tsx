import Image from "next/image";

// Icons are the SVGs exported from the Figma file (public/icons). Their colours are
// baked in by the design, so they do not follow dark mode yet.
const SIZES = {
  "alert-warn-14": 14,
  alert: 12,
  "arrow-up-right": 12,
  atlas: 12,
  "check-13": 13,
  "check-14": 14,
  "check-20": 20,
  "check-ok-14": 14,
  check: 12,
  "chevron-down-sm": 12,
  "chevron-down": 14,
  "chevron-right-12": 12,
  "chevron-right": 14,
  "dot-bad": 8,
  "dot-info": 8,
  "dot-neutral": 8,
  "dot-ok": 8,
  "dot-warn": 8,
  eye: 14,
  file: 12,
  "git-commit": 12,
  "grid-13-active": 13,
  "grid-13": 13,
  "grid-20": 20,
  grid: 16,
  link: 11,
  "message-13-active": 13,
  "message-13": 13,
  "message-20": 20,
  message: 12,
  "mic-16": 16,
  "mic-inverse-14": 14,
  mic: 12,
  "more-18": 18,
  more: 16,
  "plus-14": 14,
  plus: 16,
  "sparkles-12": 12,
  "sparkles-14": 14,
  "sparkles-inverse": 14,
  sparkles: 16,
  sun: 16,
  "table-13": 13,
  table: 12,
  target: 16,
  users: 12,
  "x-14": 14,
  x: 12,
} as const;

export type IconName = keyof typeof SIZES;

export function Icon({ name }: { name: IconName }) {
  const size = SIZES[name];
  return (
    <Image
      src={`/icons/${name}.svg`}
      alt=""
      width={size}
      height={size}
      unoptimized
      className="block shrink-0"
    />
  );
}
