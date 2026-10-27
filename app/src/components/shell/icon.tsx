import Image from "next/image";

// Icons are the SVGs exported from the Figma file (public/icons). Their colours are
// baked in by the design, so they do not follow dark mode yet.
const SIZES = {
  "chevron-down": 14,
  "chevron-down-sm": 12,
  "chevron-right": 14,
  eye: 14,
  grid: 16,
  more: 16,
  sparkles: 16,
  "sparkles-inverse": 14,
  sun: 16,
  target: 16,
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
