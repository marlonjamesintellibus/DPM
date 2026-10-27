// Icons are the SVGs exported from the Figma file (public/icons), drawn as a mask in currentColor so
// they follow the theme. Each one's default tone is the token for the colour Figma gave it (grey
// is text-fg-3, black text-fg-1, white text-on-inverse, the status colours their own tokens); a
// caller can pass another tone. Only the shape is read from the file, never its colour.
const ICONS = {
  "alert-warn-14": [14, "text-warn"],
  alert: [12, "text-fg-3"],
  "arrow-up-right": [12, "text-fg-3"],
  atlas: [12, "text-fg-3"],
  "check-13": [13, "text-fg-3"],
  "check-14": [14, "text-fg-1"],
  "check-20": [20, "text-fg-3"],
  "check-ok-14": [14, "text-ok"],
  check: [12, "text-fg-3"],
  "chevron-down-sm": [12, "text-fg-3"],
  "chevron-down": [14, "text-fg-3"],
  "chevron-right-12": [12, "text-fg-3"],
  "chevron-right": [14, "text-fg-3"],
  "dot-bad": [8, "text-bad"],
  "dot-info": [8, "text-accent"],
  "dot-neutral": [8, "text-neutral"],
  "dot-ok": [8, "text-ok"],
  "dot-warn": [8, "text-warn"],
  eye: [14, "text-fg-2"],
  file: [12, "text-fg-3"],
  "git-commit": [12, "text-fg-3"],
  "grid-13-active": [13, "text-fg-1"],
  "grid-13": [13, "text-fg-3"],
  "grid-20": [20, "text-fg-3"],
  grid: [16, "text-fg-2"],
  link: [11, "text-fg-2"],
  "message-13-active": [13, "text-fg-1"],
  "message-13": [13, "text-fg-3"],
  "message-20": [20, "text-fg-1"],
  message: [12, "text-fg-3"],
  "mic-16": [16, "text-fg-2"],
  "mic-inverse-14": [14, "text-on-inverse"],
  mic: [12, "text-fg-3"],
  "more-18": [18, "text-fg-2"],
  more: [16, "text-fg-3"],
  "plus-14": [14, "text-fg-2"],
  plus: [16, "text-fg-2"],
  "sparkles-12": [12, "text-ai"],
  "sparkles-14": [14, "text-ai"],
  "sparkles-inverse": [14, "text-on-inverse"],
  sparkles: [16, "text-ai"],
  sun: [16, "text-fg-1"],
  "table-13": [13, "text-fg-3"],
  table: [12, "text-fg-3"],
  target: [16, "text-fg-2"],
  // Phase S feedback under a reply; not in the Figma file yet, drawn in its 12px stroke style
  "thumb-down": [12, "text-fg-3"],
  "thumb-up": [12, "text-fg-3"],
  users: [12, "text-fg-3"],
  "x-14": [14, "text-fg-3"],
  x: [12, "text-fg-3"],
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, tone, label }: { name: IconName; tone?: string; label?: string }) {
  const [size, defaultTone] = ICONS[name];
  const url = `url(/icons/${name}.svg)`;
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={`inline-block shrink-0 bg-current ${tone ?? defaultTone}`}
      style={{ width: size, height: size, maskImage: url, WebkitMaskImage: url, maskSize: "100% 100%", WebkitMaskSize: "100% 100%", maskRepeat: "no-repeat", WebkitMaskRepeat: "no-repeat" }}
    />
  );
}
